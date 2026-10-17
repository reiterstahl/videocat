import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAction } from "../lib/action-audit.js";
import { isProtectedFolderUnlocked, requireAgentAuth, requireWebAuth } from "../lib/auth.js";
import { finalizeDeletion } from "../lib/deletion-history.js";
import { disksByAgentIdentifiers } from "../lib/disk-identifiers.js";
import { buildFolderGroups, normalizeFolderName } from "../lib/folder-groups.js";
import { prisma } from "../lib/prisma.js";
import { companionStagingKey, stagingBytes, transferNeeds } from "../lib/transfer-summary.js";
import { bestNameMatch, matchKey, minSearchKeyLength, searchKeys, type NameMatch } from "../lib/name-match.js";
import { canCompanionTransition, isTransferState, unfinishedStates, type TransferState } from "../lib/transfer-states.js";
import { folderGroupExclusions, visibleFilesWhere } from "./catalog.js";

const sha256Pattern = /^[a-f0-9]{64}$/;
const workLimit = 50;

const destinationSchema = z.object({
  diskId: z.string().uuid(),
  path: z.string().trim().min(1).max(2000)
});
const createTransferSchema = z.object({
  kind: z.enum(["consolidate", "group"]),
  destinationId: z.string().uuid(),
  fileIds: z.array(z.string().uuid()).min(1).max(5000),
  label: z.string().trim().min(1).max(200).optional()
});
const transitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  sha256: z.string().regex(sha256Pattern).optional(),
  targetRelativePath: z.string().trim().min(1).max(4000).optional(),
  absolutePath: z.string().trim().min(1).max(4000).optional(),
  error: z.string().trim().max(1000).optional()
});

function companionIdOf(request: FastifyRequest): string | null {
  const header = request.headers["x-videocat-companion-id"];
  return typeof header === "string" && z.string().uuid().safeParse(header).success ? header : null;
}

function cleanFolder(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function insideFolder(relativePath: string, folder: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.toLowerCase().startsWith(`${cleanFolder(folder).toLowerCase()}/`);
}

// Destination drives keep at least 1 % (minimum 1 GB) free after every planned transfer.
export function destinationReserveBytes(totalBytes: number): number {
  return Math.max(1_000_000_000, Math.round(totalBytes * 0.01));
}

const companionOnlineMs = 45_000;
const groupCandidateLimit = 2000;
const groupKeywordLimit = 20;
const tagRuleBatch = 1000;

const tagRuleSchema = z.object({
  categoryKey: z.string().trim().min(1).max(100),
  destinationId: z.string().uuid()
});

const favoriteLocationsSchema = z.object({
  locations: z.array(z.object({ d: z.string().uuid(), p: z.string().trim().min(1).max(2000) })).min(1).max(50)
});

const groupDecisionSchema = z.object({
  destinationId: z.string().uuid(),
  fileId: z.string().uuid(),
  decision: z.enum(["group", "ignore"])
});

const groupSkipMessages: Record<string, string> = {
  already_there: "That file is already in this folder",
  in_transfer: "That file is already in another transfer",
  duplicate_at_destination: "An identical file is already in this folder; it stays for review in Duplicates",
  favorite: "That file is in a favorite folder and never moves",
  nothing_to_move: "Nothing to move"
};

const consolidateSchema = z.object({
  destinationId: z.string().uuid(),
  sources: z.array(z.object({ d: z.string().uuid(), p: z.string().trim().min(1).max(2000) })).min(1).max(100)
});

const plannedFileSelect = { id: true, diskId: true, relativePath: true, filename: true, sizeBytes: true, modifiedAt: true } satisfies Prisma.VideoFileSelect;
type PlannedFile = Prisma.VideoFileGetPayload<{ select: typeof plannedFileSelect }>;
type DestinationWithDisk = Prisma.TransferDestinationGetPayload<{ include: { disk: true } }>;
type SkipReason = "already_there" | "in_transfer" | "duplicate_at_destination" | "favorite";

type FavoriteFolder = { diskId: string; path: string };

async function favoriteFolders(): Promise<FavoriteFolder[]> {
  return prisma.folderFavorite.findMany({ select: { diskId: true, path: true } });
}

// A favourite folder protects everything under it, subfolders included.
function inFavorite(file: { diskId: string; relativePath: string }, favorites: readonly FavoriteFolder[]): boolean {
  return favorites.some((favorite) => favorite.diskId === file.diskId && insideFolder(file.relativePath, favorite.path));
}

type TransferPlan = {
  movable: PlannedFile[];
  skipped: Array<{ fileId: string; reason: SkipReason }>;
  neededBytes: number;
  freeBytes: number | null;
  pendingBytes: number;
  reserveBytes: number;
  fits: boolean;
  // Not a refusal: the files still leave their drives and wait in staging until the destination has room.
  spaceWarning: { message: string; reason: "unknown_space" | "no_space"; freeBytes: number | null; pendingBytes: number; neededBytes: number; reserveBytes: number; shortBytes: number };
};

async function appSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

// Drives that a Companion seen in the last 45 seconds reports as connected.
async function connectedDiskIds(): Promise<Set<string>> {
  const companions = await prisma.companionAgent.findMany({
    where: { revokedAt: null, lastSeenAt: { gte: new Date(Date.now() - companionOnlineMs) } },
    select: { mountedDiskIds: true }
  });
  const identifiers = [...new Set(companions.flatMap((companion) => Array.isArray(companion.mountedDiskIds) ? companion.mountedDiskIds.filter((value): value is string => typeof value === "string") : []))];
  if (identifiers.length === 0) return new Set();
  const disks = await prisma.disk.findMany({ where: disksByAgentIdentifiers(identifiers), select: { id: true } });
  return new Set(disks.map((disk) => disk.id));
}

// Decides which files can move to the destination and whether they fit there.
async function planTransfer(destination: DestinationWithDisk, files: PlannedFile[]): Promise<TransferPlan> {
  const busyIds = new Set((await prisma.transferItem.findMany({
    where: { videoFileId: { in: files.map((file) => file.id) }, state: { in: unfinishedStates } },
    select: { videoFileId: true }
  })).map((item) => item.videoFileId));
  const destinationFiles = await prisma.videoFile.findMany({
    where: { diskId: destination.diskId, OR: [{ relativePath: { startsWith: `${destination.path}/` } }, { relativePath: { startsWith: `${destination.path}\\` } }] },
    select: { filename: true, sizeBytes: true }
  });
  const destinationKeys = new Set(destinationFiles.map((file) => `${file.filename.toLowerCase()}|${file.sizeBytes}`));
  const favorites = await favoriteFolders();

  const skipped: TransferPlan["skipped"] = [];
  const movable = files.filter((file) => {
    if (file.diskId === destination.diskId && insideFolder(file.relativePath, destination.path)) {
      skipped.push({ fileId: file.id, reason: "already_there" });
      return false;
    }
    if (inFavorite(file, favorites)) {
      skipped.push({ fileId: file.id, reason: "favorite" });
      return false;
    }
    if (busyIds.has(file.id)) {
      skipped.push({ fileId: file.id, reason: "in_transfer" });
      return false;
    }
    // Same name and size already in the destination: left in place for review in Duplicates.
    if (destinationKeys.has(`${file.filename.toLowerCase()}|${file.sizeBytes}`)) {
      skipped.push({ fileId: file.id, reason: "duplicate_at_destination" });
      return false;
    }
    return true;
  });

  const neededBytes = movable.reduce((sum, file) => sum + Number(file.sizeBytes), 0);
  const inFlight = await prisma.transferItem.aggregate({
    where: { targetDiskId: destination.diskId, state: { in: ["pending", "staging", "staged", "source_removed", "blocked_space", "delivering"] } },
    _sum: { sizeBytes: true }
  });
  const pendingBytes = Number(inFlight._sum.sizeBytes ?? 0n);
  const known = destination.disk.freeBytes != null && destination.disk.totalBytes != null;
  const freeBytes = known ? Number(destination.disk.freeBytes) : null;
  const reserveBytes = known ? destinationReserveBytes(Number(destination.disk.totalBytes)) : 0;
  const fits = freeBytes !== null && freeBytes - pendingBytes - neededBytes >= reserveBytes;
  const spaceWarning = {
    message: freeBytes === null ? "The destination drive has not been scanned yet" : "Not enough free space on the destination drive yet",
    reason: freeBytes === null ? "unknown_space" as const : "no_space" as const,
    freeBytes,
    pendingBytes,
    neededBytes,
    reserveBytes,
    shortBytes: freeBytes === null ? 0 : Math.max(0, reserveBytes + pendingBytes + neededBytes - freeBytes)
  };
  return { movable, skipped, neededBytes, freeBytes, pendingBytes, reserveBytes, fits, spaceWarning };
}

// Creates a transfer, or adds the files to an open one (a grouping session adds one file at a time).
async function createJob(reply: FastifyReply, kind: "consolidate" | "group" | "tag", destination: DestinationWithDisk, plan: TransferPlan, label?: string, existingJobId?: string) {
  try {
    const job = await prisma.$transaction(async (tx) => {
      const created = existingJobId
        ? await tx.transferJob.findUniqueOrThrow({ where: { id: existingJobId } })
        : await tx.transferJob.create({
            data: { kind, destinationId: destination.id, label: label ?? destination.path.split("/").pop() ?? destination.path }
          });
      await tx.transferItem.createMany({
        data: plan.movable.map((file) => ({
          jobId: created.id,
          videoFileId: file.id,
          filename: file.filename,
          sourceDiskId: file.diskId,
          sourceRelativePath: file.relativePath,
          targetDiskId: destination.diskId,
          targetFolder: destination.path,
          sizeBytes: file.sizeBytes,
          expectedModifiedAt: file.modifiedAt
        }))
      });
      return created;
    });
    await recordAction({ action: "transfer.create", actorType: "web", actorId: "admin", target: destination.path, result: { jobId: job.id, kind, files: plan.movable.length, bytes: plan.neededBytes } });
    return { job, items: plan.movable.length, neededBytes: plan.neededBytes, skipped: plan.skipped, spaceWarning: plan.fits ? null : plan.spaceWarning };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reply.code(409).send({ message: "Some files were added to another transfer at the same time" });
    }
    throw error;
  }
}

async function diskIdentifiers(diskIds: string[]) {
  const disks = await prisma.disk.findMany({ where: { id: { in: diskIds } }, select: { id: true, volumeId: true, name: true, driveLetter: true } });
  return new Map(disks.map((disk) => [disk.id, disk]));
}

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- Companion
  app.get("/api/agent/transfers/work", { preHandler: requireAgentAuth }, async (request, reply) => {
    const companionId = companionIdOf(request);
    if (!companionId) return reply.code(400).send({ message: "Transfers need a paired Companion identity" });
    const query = z.object({ mounted: z.string().max(8000).optional() }).parse(request.query);
    const identifiers = (query.mounted ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 100);
    const mountedDisks = identifiers.length > 0
      ? await prisma.disk.findMany({ where: disksByAgentIdentifiers(identifiers), select: { id: true } })
      : [];
    const mounted = mountedDisks.map((disk) => disk.id);
    // Tagged videos on the drives that just connected join their "Mover por etiqueta" transfer.
    if (mounted.length > 0) await syncTagRules({ diskIds: mounted });

    const items = await prisma.transferItem.findMany({
      where: {
        OR: [
          // Free staging space first: deliveries and clean-ups held by this Companion.
          { claimedBy: companionId, state: "delivered" },
          { claimedBy: companionId, state: { in: ["source_removed", "blocked_space", "delivering"] }, targetDiskId: { in: mounted } },
          { claimedBy: companionId, state: { in: ["staging", "staged"] }, sourceDiskId: { in: mounted } },
          { state: "pending", sourceDiskId: { in: mounted }, job: { status: "active" } }
        ]
      },
      include: { videoFile: { select: { modifiedAt: true, visualFingerprint: true } } },
      orderBy: [{ updatedAt: "asc" }],
      take: workLimit * 2
    });
    const rank: Record<string, number> = { delivered: 0, delivering: 1, blocked_space: 2, source_removed: 2, staged: 3, staging: 3, pending: 4 };
    const ordered = items.sort((left, right) => (rank[left.state] ?? 9) - (rank[right.state] ?? 9)).slice(0, workLimit);
    const disks = await diskIdentifiers([...new Set(ordered.flatMap((item) => [item.sourceDiskId, item.targetDiskId]))]);
    const identity = (diskId: string) => {
      const disk = disks.get(diskId);
      return { diskId, identifiers: [disk?.volumeId, diskId].filter((value): value is string => Boolean(value)), name: disk?.name ?? "" };
    };

    return {
      items: ordered.map((item) => ({
        id: item.id,
        jobId: item.jobId,
        state: item.state,
        filename: item.filename,
        sizeBytes: Number(item.sizeBytes),
        sha256: item.sha256,
        source: { ...identity(item.sourceDiskId), relativePath: item.sourceRelativePath, modifiedAt: item.expectedModifiedAt?.toISOString() ?? item.videoFile?.modifiedAt?.toISOString() ?? null },
        target: { ...identity(item.targetDiskId), folder: item.targetFolder, relativePath: item.targetRelativePath }
      }))
    };
  });

  app.post("/api/agent/transfers/items/:id/transition", { preHandler: requireAgentAuth }, async (request, reply) => {
    const companionId = companionIdOf(request);
    if (!companionId) return reply.code(400).send({ message: "Transfers need a paired Companion identity" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = transitionSchema.parse(request.body);
    if (!isTransferState(body.from) || !isTransferState(body.to) || !canCompanionTransition(body.from, body.to)) {
      return reply.code(400).send({ message: `Transition ${body.from} -> ${body.to} is not allowed` });
    }
    const from: TransferState = body.from;
    const to: TransferState = body.to;

    const item = await prisma.transferItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Transfer item not found" });
    if (item.state !== from) return reply.code(409).send({ message: "Transfer item changed", state: item.state });
    const claiming = from === "pending" && to === "staging";
    if (!claiming && item.claimedBy !== companionId) return reply.code(409).send({ message: "Another Companion holds this transfer", state: item.state });
    if (claiming && item.claimedBy && item.claimedBy !== companionId) return reply.code(409).send({ message: "Another Companion holds this transfer", state: item.state });

    const data: Prisma.TransferItemUpdateManyMutationInput = { state: to, error: body.error ?? null };
    // Every write re-checks the state and the holder it was decided on, atomically, so a cancel
    // from the web or another Companion acting at the same moment can never be overwritten.
    const guard: Prisma.TransferItemWhereInput = {
      id,
      state: from,
      ...(claiming ? { OR: [{ claimedBy: null }, { claimedBy: companionId }], job: { status: "active" } } : { claimedBy: companionId })
    };
    const changedMeanwhile = async () => {
      const current = await prisma.transferItem.findUnique({ where: { id }, select: { state: true } });
      return reply.code(409).send({ message: "Transfer item changed", state: current?.state ?? null });
    };
    if (claiming) {
      const job = await prisma.transferJob.findUnique({ where: { id: item.jobId }, select: { status: true } });
      if (job?.status !== "active") return reply.code(409).send({ message: "Transfer is not active", state: item.state });
      data.claimedBy = companionId;
    }
    if (to === "pending") {
      // Nothing was removed yet: release the item so it can be retried later.
      data.claimedBy = null;
      data.attempts = { increment: 1 };
      data.sha256 = null;
    }
    if (to === "staged") {
      if (!body.sha256) return reply.code(400).send({ message: "A verified SHA-256 is required" });
      data.sha256 = body.sha256;
      data.stagedAt = new Date();
    }

    if (to === "delivering") {
      const target = body.targetRelativePath?.replace(/\\/g, "/");
      if (!target || !insideFolder(target, item.targetFolder) || target.split("/").some((part) => part === ".." || part === "")) {
        return reply.code(400).send({ message: "The destination path must stay inside the destination folder" });
      }
      const taken = await prisma.videoFile.findFirst({
        where: { diskId: item.targetDiskId, relativePath: { equals: target, mode: "insensitive" }, NOT: item.videoFileId ? { id: item.videoFileId } : undefined },
        select: { id: true }
      });
      if (taken) return reply.code(409).send({ message: "Another catalogued file uses that path", reason: "path_taken", state: item.state });
      data.targetRelativePath = target;
    }

    if (to === "delivered") {
      if (!body.sha256 || body.sha256 !== item.sha256) return reply.code(400).send({ message: "The destination copy does not match the staged SHA-256" });
      if (!item.targetRelativePath) return reply.code(409).send({ message: "Destination path missing", state: item.state });
      const targetRelativePath = item.targetRelativePath;
      const applied = await prisma.$transaction(async (tx) => {
        const updated = await tx.transferItem.updateMany({ where: guard, data: { ...data, deliveredAt: new Date() } });
        if (updated.count === 0) return false;
        if (item.videoFileId) {
          await tx.videoFile.update({
            where: { id: item.videoFileId },
            data: {
              diskId: item.targetDiskId,
              relativePath: targetRelativePath,
              absolutePath: body.absolutePath ?? targetRelativePath,
              isPresent: true,
              missingSince: null
            }
          });
        }
        return true;
      });
      if (!applied) return changedMeanwhile();
      await recordAction({ action: "transfer.delivered", actorType: "companion", actorId: companionId, target: targetRelativePath, result: { itemId: id, bytes: Number(item.sizeBytes) } });
      return { ok: true, state: to };
    }

    if (to === "duplicate") {
      if ((await prisma.transferItem.updateMany({ where: guard, data })).count === 0) return changedMeanwhile();
      if (item.videoFileId) await finalizeDeletion(item.videoFileId, "deleted", { companionId });
      await recordAction({ action: "transfer.duplicate", actorType: "companion", actorId: companionId, target: item.filename, result: { itemId: id } });
      await closeFinishedJob(item.jobId);
      return { ok: true, state: to };
    }

    if ((await prisma.transferItem.updateMany({ where: guard, data })).count === 0) return changedMeanwhile();
    if (to === "done") await closeFinishedJob(item.jobId);
    return { ok: true, state: to };
  });

  // Lets the Companion clear staging copies of transfers that already finished
  // (for example when it stopped right after reporting the last step).
  app.post("/api/agent/transfers/lookup", { preHandler: requireAgentAuth }, async (request) => {
    const body = z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(request.body);
    const items = await prisma.transferItem.findMany({ where: { id: { in: body.ids } }, select: { id: true, state: true } });
    return { items };
  });

  // ---------------------------------------------------------------- Web
  // Starred folders with their size and their namesakes on other drives (what "Consolidar" would bring in).
  app.get("/api/transfers/destinations", { preHandler: requireWebAuth }, async (request) => {
    const destinations = await prisma.transferDestination.findMany({ include: { disk: { select: { name: true, freeBytes: true, totalBytes: true } } }, orderBy: { createdAt: "asc" } });
    const [files, excludedNames] = destinations.length > 0
      ? await Promise.all([
          prisma.videoFile.findMany({
            where: visibleFilesWhere(isProtectedFolderUnlocked(request), { isPresent: true }),
            select: { diskId: true, relativePath: true, sizeBytes: true, disk: { select: { name: true } } }
          }),
          folderGroupExclusions()
        ])
      : [[], []];
    const groups = buildFolderGroups(
      files.map((file) => ({ diskId: file.diskId, diskName: file.disk.name, relativePath: file.relativePath, sizeBytes: Number(file.sizeBytes) })),
      { excludedNames, maxDepth: 1, maxChildren: 1 }
    );
    const samePlace = (diskId: string, path: string, other: { diskId: string; path: string }) =>
      other.diskId === diskId && cleanFolder(other.path).toLowerCase() === path.toLowerCase();
    return {
      destinations: destinations.map((destination) => {
        const inside = files.filter((file) => file.diskId === destination.diskId && insideFolder(file.relativePath, destination.path));
        const sizeBytes = inside.reduce((sum, file) => sum + Number(file.sizeBytes), 0);
        const group = groups.repeated.find((entry) => !entry.excluded && entry.locations.some((location) => samePlace(destination.diskId, destination.path, location)));
        const namesakes = (group?.locations ?? [])
          .filter((location) => !samePlace(destination.diskId, destination.path, location))
          .map((location) => ({ diskId: location.diskId, diskName: location.diskName, path: cleanFolder(location.path), sizeBytes: location.sizeBytes }));
        return {
          id: destination.id,
          diskId: destination.diskId,
          diskName: destination.disk.name,
          path: destination.path,
          nameKey: destination.nameKey,
          groupKeywords: destination.groupKeywords,
          freeBytes: destination.disk.freeBytes == null ? null : Number(destination.disk.freeBytes),
          totalBytes: destination.disk.totalBytes == null ? null : Number(destination.disk.totalBytes),
          sizeBytes,
          fileCount: inside.length,
          namesakes,
          largest: namesakes.every((namesake) => namesake.sizeBytes <= sizeBytes)
        };
      })
    };
  });

  app.post("/api/transfers/destinations", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = destinationSchema.parse(request.body);
    const path = cleanFolder(body.path);
    const disk = await prisma.disk.findUnique({ where: { id: body.diskId }, select: { id: true } });
    if (!disk) return reply.code(404).send({ message: "Disk not found" });
    // Only folders the person can see: a locked protected folder never becomes a destination.
    const sample = await prisma.videoFile.findFirst({
      where: visibleFilesWhere(isProtectedFolderUnlocked(request), { diskId: body.diskId, OR: [{ relativePath: { startsWith: `${path}/` } }, { relativePath: { startsWith: `${path}\\` } }] }),
      select: { id: true }
    });
    if (!sample) return reply.code(404).send({ message: "That folder has no catalogued videos on this disk" });
    const name = path.split("/").pop() ?? path;
    const destination = await prisma.transferDestination.upsert({
      where: { diskId_path: { diskId: body.diskId, path } },
      create: { diskId: body.diskId, path, nameKey: normalizeFolderName(name) },
      update: {}
    });
    await recordAction({ action: "transfer.destination.add", actorType: "web", actorId: "admin", target: path });
    return { destination };
  });

  app.delete("/api/transfers/destinations/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const busy = await prisma.transferItem.count({ where: { job: { destinationId: id }, state: { in: unfinishedStates } } });
    if (busy > 0) return reply.code(409).send({ message: "This destination still has files on their way" });
    await prisma.transferJob.deleteMany({ where: { destinationId: id } });
    await prisma.transferDestination.deleteMany({ where: { id } });
    await recordAction({ action: "transfer.destination.remove", actorType: "web", actorId: "admin", target: id });
    return { ok: true };
  });

  // ------------------------------------------------------------ Favourite folders
  app.get("/api/folder-favorites", { preHandler: requireWebAuth }, async () => {
    const favorites = await prisma.folderFavorite.findMany({ include: { disk: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    return { favorites: favorites.map((favorite) => ({ id: favorite.id, diskId: favorite.diskId, diskName: favorite.disk.name, path: favorite.path })) };
  });

  // Marking a favourite also takes its files out of transfers that have not started for them yet;
  // files already in staging finish their way (nothing is undone half way).
  app.post("/api/folder-favorites", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = favoriteLocationsSchema.parse(request.body);
    const locations = body.locations.map((location) => ({ diskId: location.d, path: cleanFolder(location.p) })).filter((location) => location.path);
    const disks = await prisma.disk.findMany({ where: { id: { in: [...new Set(locations.map((location) => location.diskId))] } }, select: { id: true } });
    if (disks.length !== new Set(locations.map((location) => location.diskId)).size) return reply.code(404).send({ message: "Disk not found" });
    let cancelledPending = 0;
    const touchedJobs = new Set<string>();
    for (const location of locations) {
      await prisma.folderFavorite.upsert({
        where: { diskId_path: { diskId: location.diskId, path: location.path } },
        create: { diskId: location.diskId, path: location.path },
        update: {}
      });
      const pendingInside = {
        state: "pending",
        sourceDiskId: location.diskId,
        OR: [{ sourceRelativePath: { startsWith: `${location.path}/`, mode: "insensitive" as const } }, { sourceRelativePath: { startsWith: `${location.path}\\`, mode: "insensitive" as const } }]
      };
      const jobs = await prisma.transferItem.findMany({ where: pendingInside, select: { jobId: true }, distinct: ["jobId"] });
      jobs.forEach((job) => touchedJobs.add(job.jobId));
      cancelledPending += (await prisma.transferItem.updateMany({ where: pendingInside, data: { state: "cancelled", error: "Carpeta favorita: no se mueve." } })).count;
    }
    for (const jobId of touchedJobs) await closeFinishedJob(jobId);
    await recordAction({ action: "folder.favorite.add", actorType: "web", actorId: "admin", target: locations.map((location) => location.path).join(", ").slice(0, 500), result: { locations: locations.length, cancelledPending } });
    return { ok: true, cancelledPending };
  });

  app.post("/api/folder-favorites/remove", { preHandler: requireWebAuth }, async (request) => {
    const body = favoriteLocationsSchema.parse(request.body);
    const removed = await prisma.folderFavorite.deleteMany({
      where: { OR: body.locations.map((location) => ({ diskId: location.d, path: cleanFolder(location.p) })) }
    });
    await recordAction({ action: "folder.favorite.remove", actorType: "web", actorId: "admin", result: { removed: removed.count } });
    return { ok: true, removed: removed.count };
  });

  // ------------------------------------------------------------ Mover por etiqueta
  app.get("/api/transfers/tag-rules", { preHandler: requireWebAuth }, async () => {
    const rules = await prisma.transferTagRule.findMany({
      include: { category: true, destination: { include: { disk: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" }
    });
    const result = [];
    for (const rule of rules) {
      const [tagged, items] = await Promise.all([
        prisma.videoFile.aggregate({ where: visibleFilesWhere(false, withTag(rule.categoryKey)), _count: { _all: true }, _sum: { sizeBytes: true } }),
        prisma.transferItem.groupBy({ by: ["state"], where: { job: { tagRuleId: rule.id } }, _count: { _all: true } })
      ]);
      const count = (states: string[]) => items.filter((item) => states.includes(item.state)).reduce((sum, item) => sum + item._count._all, 0);
      result.push({
        id: rule.id,
        category: { key: rule.category.key, label: rule.category.label, color: rule.category.color },
        destination: { id: rule.destination.id, diskId: rule.destination.diskId, diskName: rule.destination.disk.name, path: rule.destination.path },
        taggedFiles: tagged._count._all,
        taggedBytes: Number(tagged._sum.sizeBytes ?? 0n),
        onTheirWay: count(unfinishedStates),
        moved: count(["done"]),
        createdAt: rule.createdAt
      });
    }
    return { rules: result };
  });

  app.post("/api/transfers/tag-rules", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = tagRuleSchema.parse(request.body);
    if (body.categoryKey === "delete") return reply.code(400).send({ message: "Videos marked for deletion are not moved", reason: "delete_tag" });
    const [category, destination] = await Promise.all([
      prisma.curationCategory.findUnique({ where: { key: body.categoryKey } }),
      prisma.transferDestination.findUnique({ where: { id: body.destinationId } })
    ]);
    if (!category) return reply.code(404).send({ message: "Tag not found" });
    if (!destination) return reply.code(404).send({ message: "Destination not found" });
    try {
      const rule = await prisma.transferTagRule.create({ data: { categoryKey: body.categoryKey, destinationId: body.destinationId } });
      await recordAction({ action: "transfer.tag.rule.add", actorType: "web", actorId: "admin", target: category.label, result: { destination: destination.path } });
      const sync = await syncTagRules({ force: true });
      return { rule, added: sync.added };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "That tag already moves videos to a folder", reason: "tag_taken" });
      }
      throw error;
    }
  });

  // Removing a rule stops new moves; files that already left their drive finish their way.
  app.delete("/api/transfers/tag-rules/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rule = await prisma.transferTagRule.findUnique({ where: { id }, include: { category: true } });
    if (!rule) return reply.code(404).send({ message: "Rule not found" });
    const pending = await prisma.transferItem.findMany({ where: { state: "pending", job: { tagRuleId: id } }, select: { jobId: true } });
    const withdrawn = (await prisma.transferItem.updateMany({
      where: { state: "pending", job: { tagRuleId: id } },
      data: { state: "cancelled", error: `Se quitó la regla de la etiqueta ${rule.category.label}.` }
    })).count;
    for (const jobId of new Set(pending.map((item) => item.jobId))) await closeFinishedJob(jobId);
    await prisma.transferTagRule.delete({ where: { id } });
    await recordAction({ action: "transfer.tag.rule.remove", actorType: "web", actorId: "admin", target: rule.category.label, result: { withdrawn } });
    return { ok: true, withdrawn };
  });

  // Optional extra words for "Agrupar archivos"; the folder name is always searched.
  app.put("/api/transfers/destinations/:id/keywords", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ keywords: z.array(z.string().trim().min(1).max(100)).max(groupKeywordLimit) }).parse(request.body);
    const destination = await prisma.transferDestination.findUnique({ where: { id }, select: { path: true } });
    if (!destination) return reply.code(404).send({ message: "Destination not found" });
    const folderKey = matchKey(destination.path.split("/").pop() ?? destination.path);
    const seen = new Set<string>([folderKey]);
    const keywords: string[] = [];
    for (const keyword of body.keywords) {
      const key = matchKey(keyword);
      if (key.length < minSearchKeyLength) return reply.code(400).send({ message: `Keywords need at least ${minSearchKeyLength} letters or numbers`, keyword });
      if (seen.has(key)) continue;
      seen.add(key);
      keywords.push(keyword.replace(/\s+/g, " "));
    }
    await prisma.transferDestination.update({ where: { id }, data: { groupKeywords: keywords } });
    await recordAction({ action: "transfer.destination.keywords", actorType: "web", actorId: "admin", target: destination.path, result: { count: keywords.length } });
    return { keywords };
  });

  app.post("/api/transfers", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = createTransferSchema.parse(request.body);
    const destination = await prisma.transferDestination.findUnique({ where: { id: body.destinationId }, include: { disk: true } });
    if (!destination) return reply.code(404).send({ message: "Destination not found" });
    const files = await prisma.videoFile.findMany({
      where: visibleFilesWhere(isProtectedFolderUnlocked(request), { id: { in: [...new Set(body.fileIds)] } }),
      select: plannedFileSelect
    });
    const plan = await planTransfer(destination, files);
    if (plan.movable.length === 0) return reply.code(409).send({ message: "Nothing to move", reason: "nothing_to_move", skipped: plan.skipped });
    return createJob(reply, body.kind, destination, plan, body.label);
  });

  // Consolidation works on folder locations: every catalogued video under each source folder.
  for (const mode of ["preview", "create"] as const) {
    app.post(mode === "preview" ? "/api/transfers/consolidate/preview" : "/api/transfers/consolidate", { preHandler: requireWebAuth }, async (request, reply) => {
      const body = consolidateSchema.parse(request.body);
      const destination = await prisma.transferDestination.findUnique({ where: { id: body.destinationId }, include: { disk: true } });
      if (!destination) return reply.code(404).send({ message: "Destination not found" });
      const sources = body.sources
        .map((source) => ({ diskId: source.d, path: cleanFolder(source.p) }))
        .filter((source) => !(source.diskId === destination.diskId && source.path.toLowerCase() === destination.path.toLowerCase()));
      if (sources.length === 0) return reply.code(400).send({ message: "Choose at least one folder other than the destination" });
      const files = await prisma.videoFile.findMany({
        where: visibleFilesWhere(isProtectedFolderUnlocked(request), {
          OR: sources.map((source) => ({
            diskId: source.diskId,
            OR: [{ relativePath: { startsWith: `${source.path}/` } }, { relativePath: { startsWith: `${source.path}\\` } }]
          }))
        }),
        select: plannedFileSelect
      });
      const plan = await planTransfer(destination, files);
      const diskNames = await diskIdentifiers([...new Set(sources.map((source) => source.diskId))]);
      const breakdown = sources.map((source) => {
        const inSource = plan.movable.filter((file) => file.diskId === source.diskId && insideFolder(file.relativePath, source.path));
        return {
          diskId: source.diskId,
          diskName: diskNames.get(source.diskId)?.name ?? "",
          path: source.path,
          files: inSource.length,
          bytes: inSource.reduce((sum, file) => sum + Number(file.sizeBytes), 0)
        };
      });
      const summary = {
        destination: { id: destination.id, diskId: destination.diskId, diskName: destination.disk.name, path: destination.path },
        sources: breakdown,
        files: plan.movable.length,
        neededBytes: plan.neededBytes,
        freeBytes: plan.freeBytes,
        pendingBytes: plan.pendingBytes,
        reserveBytes: plan.reserveBytes,
        fits: plan.fits,
        spaceWarning: plan.fits ? null : plan.spaceWarning,
        skipped: {
          duplicates: plan.skipped.filter((entry) => entry.reason === "duplicate_at_destination").length,
          inTransfer: plan.skipped.filter((entry) => entry.reason === "in_transfer").length,
          favorites: plan.skipped.filter((entry) => entry.reason === "favorite").length
        }
      };
      if (mode === "preview") return summary;
      if (plan.movable.length === 0) return reply.code(409).send({ message: "Nothing to move", reason: "nothing_to_move", ...summary });
      return createJob(reply, "consolidate", destination, plan, destination.path.split("/").pop());
    });
  }

  // ------------------------------------------------------------ Group files
  // Folders whose name contains the search, to start grouping files into one of them.
  app.get("/api/transfers/folders", { preHandler: requireWebAuth }, async (request) => {
    const query = z.object({ q: z.string().trim().min(1).max(200) }).parse(request.query);
    const key = matchKey(query.q);
    if (key.length < minSearchKeyLength) return { folders: [] };
    const files = await prisma.videoFile.findMany({
      where: visibleFilesWhere(isProtectedFolderUnlocked(request), { isPresent: true }),
      select: { diskId: true, relativePath: true, sizeBytes: true }
    });
    const folders = new Map<string, { diskId: string; path: string; files: number; bytes: number }>();
    for (const file of files) {
      if (!matchKey(file.relativePath).includes(key)) continue;
      const segments = file.relativePath.split(/[\\/]+/).filter(Boolean).slice(0, -1);
      let prefix = "";
      for (const segment of segments) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        if (!matchKey(segment).includes(key)) continue;
        const id = `${file.diskId}|${prefix}`;
        const entry = folders.get(id) ?? { diskId: file.diskId, path: prefix, files: 0, bytes: 0 };
        entry.files += 1;
        entry.bytes += Number(file.sizeBytes);
        folders.set(id, entry);
      }
    }
    const top = [...folders.values()].sort((left, right) => right.bytes - left.bytes).slice(0, 30);
    const [names, starred] = await Promise.all([
      diskIdentifiers([...new Set(top.map((folder) => folder.diskId))]),
      prisma.transferDestination.findMany({ where: { diskId: { in: top.map((folder) => folder.diskId) } }, select: { id: true, diskId: true, path: true } })
    ]);
    return {
      folders: top.map((folder) => ({
        ...folder,
        diskName: names.get(folder.diskId)?.name ?? "",
        destinationId: starred.find((destination) => destination.diskId === folder.diskId && destination.path.toLowerCase() === folder.path.toLowerCase())?.id ?? null
      }))
    };
  });

  // Files on any drive whose name looks like the starred folder's name, for a Review-like session.
  app.post("/api/transfers/group/candidates", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = z.object({ destinationId: z.string().uuid() }).parse(request.body);
    const destination = await prisma.transferDestination.findUnique({ where: { id: body.destinationId }, include: { disk: true } });
    if (!destination) return reply.code(404).send({ message: "Destination not found" });
    const name = destination.path.split("/").pop() ?? destination.path;
    const keys = searchKeys(name, destination.groupKeywords);
    if (keys.length === 0) return reply.code(400).send({ message: "The folder name is too short to search for similar files" });
    const key = keys[0].key;

    const [files, busy, ignored, destinationFiles, favorites] = await Promise.all([
      prisma.videoFile.findMany({
        where: visibleFilesWhere(isProtectedFolderUnlocked(request), { isPresent: true }),
        select: { id: true, diskId: true, relativePath: true, filename: true, sizeBytes: true }
      }),
      prisma.transferItem.findMany({ where: { state: { in: unfinishedStates } }, select: { videoFileId: true } }),
      prisma.transferGroupIgnore.findMany({ where: { destinationId: destination.id }, select: { videoFileId: true } }),
      prisma.videoFile.findMany({
        where: { diskId: destination.diskId, OR: [{ relativePath: { startsWith: `${destination.path}/` } }, { relativePath: { startsWith: `${destination.path}\\` } }] },
        select: { filename: true, sizeBytes: true }
      }),
      favoriteFolders()
    ]);
    const busyIds = new Set(busy.map((item) => item.videoFileId));
    const ignoredIds = new Set(ignored.map((entry) => entry.videoFileId));
    const destinationKeys = new Set(destinationFiles.map((file) => `${file.filename.toLowerCase()}|${file.sizeBytes}`));
    const skipped = { inside: 0, inTransfer: 0, ignored: 0, duplicates: 0, favorites: 0 };
    const candidates: Array<{ id: string; match: NameMatch; keyword: string; diskId: string; relativePath: string; sizeBytes: number }> = [];
    for (const file of files) {
      const found = bestNameMatch(file.filename, keys);
      if (!found) continue;
      const { match, keyword } = found;
      if (file.diskId === destination.diskId && insideFolder(file.relativePath, destination.path)) skipped.inside += 1;
      else if (inFavorite(file, favorites)) skipped.favorites += 1;
      else if (busyIds.has(file.id)) skipped.inTransfer += 1;
      else if (ignoredIds.has(file.id)) skipped.ignored += 1;
      else if (destinationKeys.has(`${file.filename.toLowerCase()}|${file.sizeBytes}`)) skipped.duplicates += 1;
      else candidates.push({ id: file.id, match, keyword, diskId: file.diskId, relativePath: file.relativePath, sizeBytes: Number(file.sizeBytes) });
    }
    candidates.sort((left, right) => Number(left.match === "similar") - Number(right.match === "similar")
      || left.diskId.localeCompare(right.diskId)
      || left.relativePath.localeCompare(right.relativePath));
    return {
      destination: { id: destination.id, diskId: destination.diskId, diskName: destination.disk.name, path: destination.path, name },
      key,
      total: candidates.length,
      totalBytes: candidates.reduce((sum, file) => sum + file.sizeBytes, 0),
      exact: candidates.filter((file) => file.match === "exact").length,
      similar: candidates.filter((file) => file.match === "similar").length,
      skipped,
      keywords: keys.map((entry) => entry.label),
      items: candidates.slice(0, groupCandidateLimit).map((file) => ({ id: file.id, match: file.match, keyword: file.keyword }))
    };
  });

  // F groups the file into the folder (it joins the open grouping transfer); J leaves it alone for good.
  app.post("/api/transfers/group/decide", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = groupDecisionSchema.parse(request.body);
    const destination = await prisma.transferDestination.findUnique({ where: { id: body.destinationId }, include: { disk: true } });
    if (!destination) return reply.code(404).send({ message: "Destination not found" });
    const file = await prisma.videoFile.findFirst({
      where: visibleFilesWhere(isProtectedFolderUnlocked(request), { id: body.fileId, isPresent: true }),
      select: plannedFileSelect
    });
    if (!file) return reply.code(404).send({ message: "File not found" });

    if (body.decision === "ignore") {
      await prisma.transferGroupIgnore.upsert({
        where: { destinationId_videoFileId: { destinationId: destination.id, videoFileId: file.id } },
        create: { destinationId: destination.id, videoFileId: file.id },
        update: {}
      });
      await recordAction({ action: "transfer.group.ignore", actorType: "web", actorId: "admin", target: file.filename, result: { destinationId: destination.id } });
      return { ok: true, decision: "ignore" };
    }

    const plan = await planTransfer(destination, [file]);
    if (plan.movable.length === 0) {
      const reason = plan.skipped[0]?.reason ?? "nothing_to_move";
      return reply.code(409).send({ message: groupSkipMessages[reason], reason });
    }
    const open = await prisma.transferJob.findFirst({
      where: { destinationId: destination.id, kind: "group", status: { in: ["active", "paused"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    const created = await createJob(reply, "group", destination, plan, undefined, open?.id);
    await prisma.transferGroupIgnore.deleteMany({ where: { destinationId: destination.id, videoFileId: file.id } });
    return created;
  });

  // Z in a grouping session: forget an ignore, or take a file back out while nothing has happened to it.
  app.post("/api/transfers/group/undo", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = groupDecisionSchema.parse(request.body);
    if (body.decision === "ignore") {
      await prisma.transferGroupIgnore.deleteMany({ where: { destinationId: body.destinationId, videoFileId: body.fileId } });
      return { ok: true };
    }
    const item = await prisma.transferItem.findFirst({
      where: { videoFileId: body.fileId, state: { in: unfinishedStates }, job: { destinationId: body.destinationId, kind: "group" } },
      select: { id: true, jobId: true, filename: true }
    });
    if (!item) return reply.code(404).send({ message: "That file is not in a grouping transfer" });
    // Only while still pending: once the Companion claims it, the file finishes its way safely.
    const removed = await prisma.transferItem.deleteMany({ where: { id: item.id, state: "pending" } });
    if (removed.count === 0) return reply.code(409).send({ message: "The Companion already started moving this file; it will finish its way to the folder", reason: "already_started" });
    const left = await prisma.transferItem.count({ where: { jobId: item.jobId } });
    if (left === 0) await prisma.transferJob.deleteMany({ where: { id: item.jobId } });
    else await closeFinishedJob(item.jobId);
    await recordAction({ action: "transfer.group.undo", actorType: "web", actorId: "admin", target: item.filename, result: { jobId: item.jobId } });
    return { ok: true };
  });

  app.get("/api/transfers/summary", { preHandler: requireWebAuth }, async () => {
    await cancelVanishedTransfers();
    await syncTagRules();
    const items = await prisma.transferItem.findMany({
      where: { state: { in: unfinishedStates } },
      select: { state: true, sourceDiskId: true, targetDiskId: true, sizeBytes: true, error: true, updatedAt: true, job: { select: { status: true } } }
    });
    const summaryItems = items.map((item) => ({
      state: item.state as TransferState,
      sourceDiskId: item.sourceDiskId,
      targetDiskId: item.targetDiskId,
      sizeBytes: Number(item.sizeBytes),
      jobStatus: item.job.status,
      error: item.error,
      updatedAt: item.updatedAt
    }));
    const connected = await connectedDiskIds();
    const targetDisks = await prisma.disk.findMany({
      where: { id: { in: [...new Set(summaryItems.map((item) => item.targetDiskId))] } },
      select: { id: true, freeBytes: true, totalBytes: true }
    });
    const needs = transferNeeds(summaryItems, connected, targetDisks.map((disk) => ({
      diskId: disk.id,
      // Room left on the destination according to its last scan, keeping its reserve.
      roomBytes: disk.freeBytes == null || disk.totalBytes == null ? null : Number(disk.freeBytes) - destinationReserveBytes(Number(disk.totalBytes))
    })));
    const names = await diskIdentifiers([...new Set(needs.map((need) => need.diskId))]);
    const staging = await appSetting(companionStagingKey);
    const activeJobs = await prisma.transferJob.count({ where: { items: { some: { state: { in: unfinishedStates } } } } });
    return {
      activeJobs,
      stagingBytes: stagingBytes(summaryItems),
      staging: staging ? JSON.parse(staging) as unknown : null,
      needs: needs.map((need) => ({ ...need, diskName: names.get(need.diskId)?.name ?? "", driveLetter: names.get(need.diskId)?.driveLetter ?? null }))
    };
  });

  app.get("/api/transfers", { preHandler: requireWebAuth }, async () => {
    const jobs = await prisma.transferJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { destination: { include: { disk: { select: { name: true } } } } }
    });
    const counts = await prisma.transferItem.groupBy({
      by: ["jobId", "state"],
      where: { jobId: { in: jobs.map((job) => job.id) } },
      _count: { _all: true },
      _sum: { sizeBytes: true }
    });
    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        label: job.label,
        status: job.status,
        createdAt: job.createdAt,
        destination: { id: job.destination.id, diskId: job.destination.diskId, diskName: job.destination.disk.name, path: job.destination.path },
        states: Object.fromEntries(counts.filter((row) => row.jobId === job.id).map((row) => [row.state, { files: row._count._all, bytes: Number(row._sum.sizeBytes ?? 0n) }]))
      }))
    };
  });

  app.get("/api/transfers/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = await prisma.transferJob.findUnique({ where: { id }, include: { items: { orderBy: { createdAt: "asc" } } } });
    if (!job) return reply.code(404).send({ message: "Transfer not found" });
    return {
      job: { id: job.id, kind: job.kind, label: job.label, status: job.status, createdAt: job.createdAt },
      items: job.items.map((item) => ({
        id: item.id,
        videoFileId: item.videoFileId,
        filename: item.filename,
        sourceDiskId: item.sourceDiskId,
        sourceRelativePath: item.sourceRelativePath,
        targetRelativePath: item.targetRelativePath,
        sizeBytes: Number(item.sizeBytes),
        state: item.state,
        attempts: item.attempts,
        error: item.error,
        updatedAt: item.updatedAt
      }))
    };
  });

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post(`/api/transfers/:id/${action}`, { preHandler: requireWebAuth }, async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const job = await prisma.transferJob.findUnique({ where: { id } });
      if (!job) return reply.code(404).send({ message: "Transfer not found" });
      if (job.status === "done" || job.status === "cancelled") return reply.code(409).send({ message: "Transfer already finished" });
      let cancelledFiles = 0;
      if (action === "cancel") {
        // Only files nothing has happened to yet; the rest finish their way to the destination.
        const result = await prisma.transferItem.updateMany({ where: { jobId: id, state: "pending" }, data: { state: "cancelled" } });
        cancelledFiles = result.count;
      }
      const status = action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled";
      await prisma.transferJob.update({ where: { id }, data: { status } });
      await recordAction({ action: `transfer.${action}`, actorType: "web", actorId: "admin", target: job.label, result: { jobId: id, cancelledFiles } });
      if (action === "cancel") await closeFinishedJob(id);
      return { ok: true, status, cancelledFiles };
    });
  }
}

// ------------------------------------------------------------ Mover por etiqueta
function withTag(categoryKey: string): Prisma.VideoFileWhereInput {
  return { OR: [{ categories: { some: { categoryKey } } }, { curationStatus: categoryKey }] };
}

const tagSyncIntervalMs = 15_000;
let lastFullTagSync = 0;

// Brings every tag rule up to date: videos that carry the tag join the rule's transfer, and
// videos that lost it leave it while nothing has happened to them yet. Scoped to some drives when
// a Companion connects them; a full pass runs at most every 15 seconds.
export async function syncTagRules(options: { diskIds?: string[]; force?: boolean } = {}): Promise<{ added: number; withdrawn: number }> {
  if (!options.diskIds && !options.force) {
    if (Date.now() - lastFullTagSync < tagSyncIntervalMs) return { added: 0, withdrawn: 0 };
    lastFullTagSync = Date.now();
  }
  const rules = await prisma.transferTagRule.findMany({ include: { destination: { include: { disk: true } }, category: true } });
  let added = 0;
  let withdrawn = 0;
  for (const rule of rules) {
    const stale = await prisma.transferItem.findMany({
      where: { state: "pending", job: { tagRuleId: rule.id }, OR: [{ videoFileId: null }, { videoFile: { NOT: withTag(rule.categoryKey) } }] },
      select: { id: true, jobId: true }
    });
    if (stale.length > 0) {
      withdrawn += (await prisma.transferItem.updateMany({
        where: { id: { in: stale.map((item) => item.id) }, state: "pending" },
        data: { state: "cancelled", error: `Ya no tiene la etiqueta ${rule.category.label}.` }
      })).count;
      for (const jobId of new Set(stale.map((item) => item.jobId))) await closeFinishedJob(jobId);
    }

    const files = await prisma.videoFile.findMany({
      where: visibleFilesWhere(false, {
        ...withTag(rule.categoryKey),
        ...(options.diskIds ? { diskId: { in: options.diskIds } } : {}),
        transferItems: { none: { state: { in: unfinishedStates } } }
      }),
      select: plannedFileSelect,
      take: tagRuleBatch
    });
    if (files.length === 0) continue;
    const plan = await planTransfer(rule.destination, files);
    if (plan.movable.length === 0) continue;
    const open = await prisma.transferJob.findFirst({
      where: { tagRuleId: rule.id, status: { in: ["active", "paused"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    const jobId = open?.id ?? (await prisma.transferJob.create({
      data: { kind: "tag", destinationId: rule.destinationId, tagRuleId: rule.id, label: rule.category.label }
    })).id;
    // Another pass may have queued some of them meanwhile: those are skipped, never duplicated.
    const created = await prisma.transferItem.createMany({
      data: plan.movable.map((file) => ({
        jobId,
        videoFileId: file.id,
        filename: file.filename,
        sourceDiskId: file.diskId,
        sourceRelativePath: file.relativePath,
        targetDiskId: rule.destination.diskId,
        targetFolder: rule.destination.path,
        sizeBytes: file.sizeBytes,
        expectedModifiedAt: file.modifiedAt
      })),
      skipDuplicates: true
    });
    added += created.count;
    if (created.count === 0 && !open) await prisma.transferJob.deleteMany({ where: { id: jobId, items: { none: {} } } });
  }
  if (added > 0 || withdrawn > 0) {
    await recordAction({ action: "transfer.tag.sync", actorType: "system", result: { added, withdrawn, diskIds: options.diskIds?.length ?? null } });
  }
  return { added, withdrawn };
}

// A file that a scan no longer found (moved or deleted by hand) cannot leave its drive: its
// transfers that had not started are cancelled with the reason, instead of waiting forever.
// Files already in staging are never touched here.
export async function cancelVanishedTransfers(): Promise<number> {
  const vanished = await prisma.transferItem.findMany({
    where: { state: "pending", OR: [{ videoFileId: null }, { videoFile: { isPresent: false } }] },
    select: { id: true, jobId: true }
  });
  if (vanished.length === 0) return 0;
  const result = await prisma.transferItem.updateMany({
    where: { id: { in: vanished.map((item) => item.id) }, state: "pending" },
    data: { state: "cancelled", error: "El archivo ya no estaba en su disco en el último escaneo." }
  });
  for (const jobId of new Set(vanished.map((item) => item.jobId))) await closeFinishedJob(jobId);
  return result.count;
}

async function closeFinishedJob(jobId: string): Promise<void> {
  const open = await prisma.transferItem.count({ where: { jobId, state: { in: unfinishedStates } } });
  if (open > 0) return;
  await prisma.transferJob.updateMany({ where: { id: jobId, status: { in: ["active", "paused"] } }, data: { status: "done" } });
}
