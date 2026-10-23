import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type Scan, type Thumbnail } from "@prisma/client";
import { damagedMediaReason, isDamagedMediaMessage, isRiskyMediaMessage, type AgentFileInput } from "@videocat/shared";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { recordAction } from "./action-audit.js";
import { catalogFileIdentityChanged } from "./catalog-file-identity.js";
import { isStoragePermissionError } from "./thumbnail-storage.js";
import { inTransitStates, unfinishedStates } from "./transfer-states.js";
import { cancelVanishedTransfers } from "../routes/transfers.js";

// How a scan writes the catalog, shared by the Companion's agent routes and the server's own
// scanner of S3 buckets (src/scanner.ts): start with a lease, write files and thumbnails, mark
// what is still there, follow moved files, and reconcile what vanished at the end.

// Renewed on every batch/seen/error upload; this also covers slow initial disk walks.
export const scanLeaseMs = 60 * 60 * 1000;

const scanError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export async function renewScanLease(scanId: string, diskId?: string): Promise<boolean> {
  const updated = await prisma.scan.updateMany({
    where: {
      id: scanId,
      ...(diskId ? { diskId } : {}),
      status: "running",
      leaseExpiresAt: { gt: new Date() }
    },
    data: { leaseExpiresAt: new Date(Date.now() + scanLeaseMs) }
  });
  return updated.count === 1;
}

export function toDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

export function normalizedScanRoot(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  return normalized || ".";
}

export function scannedScopeWhere(scanRoots: string[]): Prisma.VideoFileWhereInput {
  if (scanRoots.includes(".")) return {};
  return {
    OR: scanRoots.map((root) => ({
      OR: [
        { relativePath: root },
        { relativePath: { startsWith: `${root}/` } }
      ]
    }))
  };
}

export function errorCategory(status: string, message?: string | null): string {
  if (isRiskyMediaMessage(message)) return "at_risk_file";
  if (isDamagedMediaMessage(message) || damagedMediaReason(message)) return "damaged_file";
  const text = `${status} ${message ?? ""}`.toLowerCase();
  if (text.includes("eperm") || text.includes("eacces") || text.includes("permission")) return "permission";
  if (text.includes("enoent") || text.includes("not found")) return "missing_path";
  if (text.includes("ffprobe") || status === "metadata_failed") return "metadata";
  if (text.includes("ffmpeg") || status === "thumbnail_failed") return "thumbnail";
  return status === "failed" ? "agent" : status;
}

export function videoFileData(diskId: string, scanId: string, file: AgentFileInput) {
  return {
    diskId,
    filename: file.filename,
    extension: file.extension.toLowerCase(),
    absolutePath: file.absolutePath,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    folderSizeBytes: file.folderSizeBytes ?? undefined,
    fileCreatedAt: toDate(file.createdAt),
    modifiedAt: toDate(file.modifiedAt),
    scanStatus: file.status,
    errorMessage: file.errorMessage,
    durationSeconds: file.metadata?.durationSeconds ?? null,
    width: file.metadata?.width ?? null,
    height: file.metadata?.height ?? null,
    fps: file.metadata?.fps ?? null,
    videoCodec: file.metadata?.videoCodec ?? null,
    audioCodec: file.metadata?.audioCodec ?? null,
    audioChannels: file.metadata?.audioChannels ?? null,
    bitrate: file.metadata?.bitrate ?? null,
    containerFormat: file.metadata?.containerFormat ?? null,
    streamCount: file.metadata?.streamCount ?? null,
    ffprobeJson: file.metadata?.raw ?? undefined,
    visualFingerprint: file.visualFingerprint,
    fingerprintVersion: file.fingerprintVersion,
    fingerprintedAt: file.visualFingerprint !== undefined ? new Date() : undefined,
    isPresent: true,
    missingSince: null,
    lastSeenScanId: scanId,
    // The file was read (again): a pending retry from the web is done, whatever the result.
    readRetryAt: null
  };
}

// One running scan per drive and root: an expired lease is abandoned, a live one of the same
// owner is resumed, a live one of another owner refuses the start.
export async function startScan(diskId: string, rawRootPath: string, owner: string): Promise<Scan> {
  const rootPath = normalizedScanRoot(rawRootPath);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.scan.updateMany({
      where: { diskId, rootPath, status: "running", leaseExpiresAt: { lte: now } },
      data: { status: "abandoned", finishedAt: now, leaseExpiresAt: null }
    });
    const active = await tx.scan.findFirst({
      where: { diskId, rootPath, status: "running", leaseExpiresAt: { gt: now } },
      orderBy: { startedAt: "desc" }
    });
    if (active) {
      if (active.leaseOwner === owner) return active;
      throw scanError("A reconciliation scan is already active for this disk and root", 409);
    }
    const latest = await tx.scan.aggregate({
      where: { diskId, rootPath },
      _max: { generation: true }
    });
    return tx.scan.create({
      data: {
        diskId,
        rootPath,
        status: "running",
        leaseOwner: owner,
        generation: (latest._max.generation ?? 0) + 1,
        leaseExpiresAt: new Date(Date.now() + scanLeaseMs)
      }
    });
  });
}

async function recordFileError(diskId: string, scanId: string, file: AgentFileInput): Promise<void> {
  await prisma.agentError.create({
    data: {
      diskId,
      scanId,
      category: errorCategory(file.status, file.errorMessage),
      phase: file.status === "thumbnail_failed" ? "thumbnail" : "metadata",
      message: file.errorMessage ?? file.status,
      absolutePath: file.absolutePath,
      relativePath: file.relativePath
    }
  });
}

// movesReported: the scanner decided moves itself (it can see whether the old path is gone);
// otherwise a new path takes the entry of one file with the same name, size and time.
export async function writeScannedFiles(diskId: string, scanId: string, files: AgentFileInput[], movesReported: boolean): Promise<void> {
  let errorCount = 0;
  const existingFiles = await prisma.videoFile.findMany({
    where: { diskId, relativePath: { in: files.map((file) => file.relativePath) } },
    select: { id: true, relativePath: true, sizeBytes: true, modifiedAt: true, curationStatus: true }
  });
  const existingByPath = new Map(existingFiles.map((file) => [file.relativePath, file]));

  for (const file of files) {
    if (file.status !== "scanned") errorCount += 1;

    const data = videoFileData(diskId, scanId, file);
    const existing = existingByPath.get(file.relativePath);

    if (existing) {
      const replacedAtSamePath = catalogFileIdentityChanged(existing, {
        sizeBytes: file.sizeBytes,
        modifiedAt: data.modifiedAt
      });
      const clearDeleteMark = replacedAtSamePath && existing.curationStatus === "delete";
      await prisma.$transaction(async (tx) => {
        await tx.videoFile.update({
          where: { id: existing.id },
          data: clearDeleteMark ? { ...data, curationStatus: "none", reviewedAt: null } : data
        });
        if (clearDeleteMark) {
          await tx.videoFileCategory.deleteMany({
            where: { videoFileId: existing.id, categoryKey: "delete" }
          });
        }
      });
      if (file.status !== "scanned") await recordFileError(diskId, scanId, file);
      continue;
    }

    // Older Companions do not report moves: guess them by name, size and time. A file this scan
    // already saw at its own path is still there, so a copy never takes its entry.
    const movedCandidates = data.modifiedAt && !movesReported
      ? await prisma.videoFile.findMany({
          where: {
            diskId,
            filename: file.filename,
            sizeBytes: file.sizeBytes,
            modifiedAt: data.modifiedAt,
            NOT: { relativePath: file.relativePath },
            OR: [{ lastSeenScanId: null }, { lastSeenScanId: { not: scanId } }]
          },
          select: { id: true },
          take: 2
        })
      : [];

    if (movedCandidates.length === 1) {
      await prisma.videoFile.update({
        where: { id: movedCandidates[0].id },
        data
      });
    } else {
      await prisma.videoFile.create({ data });
    }
    if (file.status !== "scanned") await recordFileError(diskId, scanId, file);
  }

  await prisma.scan.update({
    where: { id: scanId },
    data: {
      fileCount: { increment: files.length },
      errorCount: { increment: errorCount }
    }
  });

  await prisma.disk.update({
    where: { id: diskId },
    data: { lastScannedAt: new Date() }
  });
}

export async function markSeen(scanId: string, diskId: string, rawPaths: string[]): Promise<{ seen: number; reactivated: number }> {
  const paths = [...new Set(rawPaths.map((value) => normalizedScanRoot(value)))];
  const reactivated = await prisma.videoFile.updateMany({
    where: { diskId, relativePath: { in: paths }, isPresent: false },
    data: { isPresent: true, missingSince: null, lastSeenScanId: scanId }
  });
  const seen = await prisma.videoFile.updateMany({
    where: { diskId, relativePath: { in: paths } },
    data: { isPresent: true, missingSince: null, lastSeenScanId: scanId }
  });
  return { seen: seen.count, reactivated: reactivated.count };
}

export type RelocationMove = {
  from: string;
  to: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: string;
  folderSizeBytes?: number | null;
};

export type RelocationRejection = { to: string; reason: "not_found" | "changed" | "occupied" | "in_transfer" };

// A folder renamed or a file moved on the same drive: the catalog entry follows it to the new
// path and keeps everything (tags, review, thumbnails, fingerprint) instead of being scanned
// again as a new video. Anything that does not match exactly is rejected and scanned as usual.
export async function relocateFiles(
  scan: Pick<Scan, "id" | "diskId" | "leaseOwner">,
  moves: RelocationMove[],
  actorType: "companion" | "system"
): Promise<{ relocated: string[]; rejected: RelocationRejection[] }> {
  const relocated: Array<{ from: string; to: string }> = [];
  const rejected: RelocationRejection[] = [];
  for (const move of moves) {
    const from = normalizedScanRoot(move.from);
    const to = normalizedScanRoot(move.to);
    const [source, occupant] = await Promise.all([
      prisma.videoFile.findUnique({
        where: { diskId_relativePath: { diskId: scan.diskId, relativePath: from } },
        select: { id: true, sizeBytes: true, modifiedAt: true, _count: { select: { transferItems: { where: { state: { in: unfinishedStates } } } } } }
      }),
      prisma.videoFile.findUnique({ where: { diskId_relativePath: { diskId: scan.diskId, relativePath: to } }, select: { id: true } })
    ]);
    if (!source) {
      rejected.push({ to, reason: "not_found" });
      continue;
    }
    if (catalogFileIdentityChanged(source, { sizeBytes: move.sizeBytes, modifiedAt: new Date(move.modifiedAt) })) {
      rejected.push({ to, reason: "changed" });
      continue;
    }
    if (occupant) {
      rejected.push({ to, reason: "occupied" });
      continue;
    }
    // A transfer knows the file by its old path; it finishes first.
    if (source._count.transferItems > 0) {
      rejected.push({ to, reason: "in_transfer" });
      continue;
    }
    try {
      await prisma.videoFile.update({
        where: { id: source.id },
        data: {
          relativePath: to,
          absolutePath: move.absolutePath,
          filename: path.posix.basename(to),
          extension: path.posix.extname(to).toLowerCase(),
          ...(move.folderSizeBytes !== undefined ? { folderSizeBytes: move.folderSizeBytes === null ? null : BigInt(move.folderSizeBytes) } : {}),
          isPresent: true,
          missingSince: null,
          lastSeenScanId: scan.id
        }
      });
      relocated.push({ from, to });
    } catch (error) {
      // Another scan took the new path at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") rejected.push({ to, reason: "occupied" });
      else throw error;
    }
  }

  if (relocated.length > 0) {
    await recordAction({
      action: "scan.relocate",
      actorType,
      actorId: scan.leaseOwner,
      diskId: scan.diskId,
      target: `${relocated.length} archivo(s) movidos o en carpetas renombradas`,
      result: { sample: relocated.slice(0, 5) }
    });
  }
  return { relocated: relocated.map((move) => move.to), rejected };
}

export class ThumbnailStoreError extends Error {
  constructor(readonly reason: "no_video" | "not_jpeg" | "not_writable", options?: { cause?: unknown }) {
    super(reason === "no_video"
      ? "Video file must be uploaded before thumbnails"
      : reason === "not_jpeg" ? "Thumbnail must be a valid JPEG image" : "Thumbnail storage is not writable", options);
    this.name = "ThumbnailStoreError";
  }
}

export async function storeThumbnail(input: { diskId: string; relativePath: string; kind: string; timestampSeconds: number; image: Buffer }): Promise<Thumbnail> {
  const videoFile = await prisma.videoFile.findUnique({
    where: { diskId_relativePath: { diskId: input.diskId, relativePath: input.relativePath } }
  });
  if (!videoFile) throw new ThumbnailStoreError("no_video");

  const { image } = input;
  const isJpeg = image.length >= 4
    && image[0] === 0xff
    && image[1] === 0xd8
    && image[image.length - 2] === 0xff
    && image[image.length - 1] === 0xd9;
  if (!isJpeg) throw new ThumbnailStoreError("not_jpeg");

  const filename = `${input.kind}.jpg`;
  const thumbnailRelativePath = path.posix.join(input.diskId, videoFile.id, filename);
  const destination = path.join(env.THUMBNAILS_DIR, thumbnailRelativePath);
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, image);
  } catch (error) {
    if (!isStoragePermissionError(error)) throw error;
    throw new ThumbnailStoreError("not_writable", { cause: error });
  }

  return prisma.thumbnail.upsert({
    where: {
      videoFileId_kind: {
        videoFileId: videoFile.id,
        kind: input.kind
      }
    },
    create: {
      videoFileId: videoFile.id,
      kind: input.kind,
      timestampSeconds: input.timestampSeconds,
      relativePath: thumbnailRelativePath
    },
    update: {
      timestampSeconds: input.timestampSeconds,
      relativePath: thumbnailRelativePath,
      createdAt: new Date()
    }
  });
}

export async function finishScan(
  current: Scan,
  options: { reconcile: boolean; scanRoots: string[]; actorType: "companion" | "system" }
): Promise<{ scan: Scan; reconciliation: { markedAbsent: number; cancelledTransfers: number } }> {
  let markedAbsent = 0;
  if (options.reconcile) {
    const scanRoots = [...new Set(options.scanRoots.map(normalizedScanRoot))];
    if (scanRoots.length === 0) throw scanError("scanRoots are required for reconciliation", 400);
    const newest = await prisma.scan.aggregate({
      where: { diskId: current.diskId, rootPath: current.rootPath },
      _max: { generation: true }
    });
    if (newest._max.generation !== current.generation) {
      throw scanError("A newer scan generation owns reconciliation", 409);
    }
    const result = await prisma.videoFile.updateMany({
      where: {
        diskId: current.diskId,
        isPresent: true,
        AND: [
          scannedScopeWhere(scanRoots),
          { OR: [{ lastSeenScanId: null }, { lastSeenScanId: { not: current.id } }] },
          // A file on its way to another drive is legitimately missing from its old place.
          { transferItems: { none: { state: { in: inTransitStates } } } }
        ]
      },
      data: { isPresent: false, missingSince: new Date() }
    });
    markedAbsent = result.count;
  }
  const cancelledTransfers = markedAbsent > 0 ? await cancelVanishedTransfers() : 0;

  const scan = await prisma.scan.update({
    where: { id: current.id },
    data: { status: "finished", finishedAt: new Date(), leaseExpiresAt: null }
  });
  await recordAction({
    action: "scan.finish",
    actorType: options.actorType,
    actorId: current.leaseOwner,
    diskId: current.diskId,
    target: current.rootPath,
    metadata: { generation: current.generation, reconciled: options.reconcile },
    result: { fileCount: scan.fileCount, errorCount: scan.errorCount, markedAbsent, cancelledTransfers }
  });
  return { scan, reconciliation: { markedAbsent, cancelledTransfers } };
}
