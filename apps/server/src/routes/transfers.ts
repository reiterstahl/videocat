import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAction } from "../lib/action-audit.js";
import { isProtectedFolderUnlocked, requireAgentAuth, requireWebAuth } from "../lib/auth.js";
import { finalizeDeletion } from "../lib/deletion-history.js";
import { disksByAgentIdentifiers } from "../lib/disk-identifiers.js";
import { normalizeFolderName } from "../lib/folder-groups.js";
import { prisma } from "../lib/prisma.js";
import { companionStagingKey, stagingBytes, transferNeeds } from "../lib/transfer-summary.js";
import { canCompanionTransition, isTransferState, unfinishedStates, type TransferState } from "../lib/transfer-states.js";
import { visibleFilesWhere } from "./catalog.js";

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

const consolidateSchema = z.object({
  destinationId: z.string().uuid(),
  sources: z.array(z.object({ d: z.string().uuid(), p: z.string().trim().min(1).max(2000) })).min(1).max(100)
});

const plannedFileSelect = { id: true, diskId: true, relativePath: true, filename: true, sizeBytes: true, modifiedAt: true } satisfies Prisma.VideoFileSelect;
type PlannedFile = Prisma.VideoFileGetPayload<{ select: typeof plannedFileSelect }>;
type DestinationWithDisk = Prisma.TransferDestinationGetPayload<{ include: { disk: true } }>;
type SkipReason = "already_there" | "in_transfer" | "duplicate_at_destination";

type TransferPlan = {
  movable: PlannedFile[];
  skipped: Array<{ fileId: string; reason: SkipReason }>;
  neededBytes: number;
  freeBytes: number | null;
  pendingBytes: number;
  reserveBytes: number;
  fits: boolean;
  spaceProblem: Record<string, unknown>;
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

  const skipped: TransferPlan["skipped"] = [];
  const movable = files.filter((file) => {
    if (file.diskId === destination.diskId && insideFolder(file.relativePath, destination.path)) {
      skipped.push({ fileId: file.id, reason: "already_there" });
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
  const spaceProblem = freeBytes === null
    ? { message: "Scan the destination drive first so its free space is known", reason: "unknown_space" }
    : { message: "Not enough free space on the destination drive", reason: "no_space", freeBytes, pendingBytes, neededBytes, reserveBytes };
  return { movable, skipped, neededBytes, freeBytes, pendingBytes, reserveBytes, fits, spaceProblem };
}

async function createJob(reply: FastifyReply, kind: "consolidate" | "group", destination: DestinationWithDisk, plan: TransferPlan, label?: string) {
  try {
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.transferJob.create({
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
    return { job, items: plan.movable.length, neededBytes: plan.neededBytes, skipped: plan.skipped };
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

    const data: Prisma.TransferItemUpdateInput = { state: to, error: body.error ?? null };
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
      await prisma.$transaction(async (tx) => {
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
        await tx.transferItem.update({ where: { id }, data: { ...data, deliveredAt: new Date() } });
      });
      await recordAction({ action: "transfer.delivered", actorType: "companion", actorId: companionId, target: targetRelativePath, result: { itemId: id, bytes: Number(item.sizeBytes) } });
      return { ok: true, state: to };
    }

    if (to === "duplicate") {
      await prisma.transferItem.update({ where: { id }, data });
      if (item.videoFileId) await finalizeDeletion(item.videoFileId, "deleted", { companionId });
      await recordAction({ action: "transfer.duplicate", actorType: "companion", actorId: companionId, target: item.filename, result: { itemId: id } });
      await closeFinishedJob(item.jobId);
      return { ok: true, state: to };
    }

    await prisma.transferItem.update({ where: { id }, data });
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
  app.get("/api/transfers/destinations", { preHandler: requireWebAuth }, async () => {
    const destinations = await prisma.transferDestination.findMany({ include: { disk: { select: { name: true, freeBytes: true, totalBytes: true } } }, orderBy: { createdAt: "asc" } });
    return {
      destinations: destinations.map((destination) => ({
        id: destination.id,
        diskId: destination.diskId,
        diskName: destination.disk.name,
        path: destination.path,
        nameKey: destination.nameKey,
        freeBytes: destination.disk.freeBytes == null ? null : Number(destination.disk.freeBytes),
        totalBytes: destination.disk.totalBytes == null ? null : Number(destination.disk.totalBytes)
      }))
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
    if (!plan.fits) return reply.code(409).send(plan.spaceProblem);
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
        skipped: { duplicates: plan.skipped.filter((entry) => entry.reason === "duplicate_at_destination").length, inTransfer: plan.skipped.filter((entry) => entry.reason === "in_transfer").length }
      };
      if (mode === "preview") return summary;
      if (plan.movable.length === 0) return reply.code(409).send({ message: "Nothing to move", reason: "nothing_to_move", ...summary });
      if (!plan.fits) return reply.code(409).send({ ...plan.spaceProblem, ...summary });
      return createJob(reply, "consolidate", destination, plan, destination.path.split("/").pop());
    });
  }

  app.get("/api/transfers/summary", { preHandler: requireWebAuth }, async () => {
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
    const needs = transferNeeds(summaryItems, connected);
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

async function closeFinishedJob(jobId: string): Promise<void> {
  const open = await prisma.transferItem.count({ where: { jobId, state: { in: unfinishedStates } } });
  if (open > 0) return;
  await prisma.transferJob.updateMany({ where: { id: jobId, status: { in: ["active", "paused"] } }, data: { status: "done" } });
}
