import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  agentErrorsBatchSchema,
  damagedMediaPrefix,
  filesBatchSchema,
  riskyMediaPrefix,
  registerDiskSchema,
  scanStartSchema,
  thumbnailKindSchema,
  visualFingerprintVersion
} from "@videocat/shared";
import { prisma } from "../lib/prisma.js";
import { requireAgentAuth } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { finalizeDeletion, recordDeletionFailure } from "../lib/deletion-history.js";
import { profileAccentColor, protectedFolderPatterns } from "../lib/protected-settings.js";
import { serializeDisk } from "../lib/serialize.js";
import { thumbnailStorageHint } from "../lib/thumbnail-storage.js";
import { agentDiskIdentifierSchema, disksByAgentIdentifiers, isUuid } from "../lib/disk-identifiers.js";
import { inTransitStates, unfinishedStates } from "../lib/transfer-states.js";
import { companionStagingKey } from "../lib/transfer-summary.js";
import { locationOf } from "../lib/bucket-scan.js";
import { readObjectRange } from "../lib/s3.js";
import {
  finishScan,
  markSeen,
  relocateFiles,
  renewScanLease,
  startScan,
  storeThumbnail,
  ThumbnailStoreError,
  writeScannedFiles
} from "../lib/catalog-scan.js";
import { activitiesSchema, storeActivity } from "../lib/companion-activity.js";
import { transferOrders } from "../lib/transfer-control.js";

const transfersModeSchema = z.enum(["running", "stopping", "stopped"]);
import { noteMountedDisks } from "../lib/connected-work.js";

const fingerprintRepairBatchLimit = 5_000;
function scanLeaseOwner(request: { headers: Record<string, string | string[] | undefined> }): string {
  const header = request.headers["x-videocat-companion-id"];
  return typeof header === "string" && z.string().uuid().safeParse(header).success ? header : "legacy-agent";
}

async function appMetricValue(key: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ valueBigInt: bigint }>>(Prisma.sql`
    SELECT "valueBigInt"
    FROM "AppMetric"
    WHERE "key" = ${key}
    LIMIT 1
  `);
  return Number(rows[0]?.valueBigInt ?? 0n);
}

async function setAppMetricValue(key: string, value: bigint): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppMetric" ("key", "valueBigInt", "updatedAt")
    VALUES (${key}, ${value}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE
    SET "valueBigInt" = EXCLUDED."valueBigInt",
        "updatedAt" = CURRENT_TIMESTAMP
  `);
}

async function setAppSettingValue(key: string, value: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${key}, ${value}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = CURRENT_TIMESTAMP
  `);
}

async function diskByAgentIdentifier(identifier: string) {
  return prisma.disk.findFirst({
    where: {
      OR: [
        ...(isUuid(identifier) ? [{ id: identifier }] : []),
        { volumeId: identifier }
      ]
    }
  });
}

const downloadStatusSchema = z.object({
  status: z.enum(["queued", "downloading", "done", "failed"]),
  progressBytes: z.number().int().nonnegative().optional(),
  destinationPath: z.string().max(2000).optional().nullable(),
  errorMessage: z.string().max(2000).optional().nullable()
});
const companionHeartbeatSchema = z.object({
  version: z.number().int().nonnegative().optional(),
  mountedDiskCount: z.number().int().nonnegative().optional(),
  // Unknown identifiers are dropped instead of rejecting the heartbeat, so one odd folder
  // never makes the whole Companion look offline.
  mountedDiskIds: z.array(z.string().max(200)).max(100).optional()
    .transform((ids) => ids?.filter((id) => agentDiskIdentifierSchema.safeParse(id).success).map((id) => id.trim())),
  companionId: z.string().uuid().optional(),
  companionName: z.string().trim().min(1).max(120).optional(),
  // Transfer staging folder of this Companion; absent on versions without transfers.
  staging: z.object({
    configured: z.boolean(),
    path: z.string().max(1000).nullable().optional(),
    freeBytes: z.number().nonnegative().nullable().optional(),
    totalBytes: z.number().nonnegative().nullable().optional(),
    error: z.string().max(500).nullable().optional()
  }).optional(),
  // Live free space of the drives connected to this Companion.
  disks: z.array(z.object({
    diskId: z.string().max(200),
    freeBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative()
  })).max(100).optional(),
  activities: activitiesSchema.optional(),
  transfersWaiting: z.boolean().optional(),
  transfersMode: transfersModeSchema.optional()
});
const deletionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["deleted", "missing"]) }),
  z.object({ status: z.enum(["failed", "identity_mismatch"]), errorMessage: z.string().trim().min(1).max(4000) })
]);
const companionMountedDiskIdsKey = "companion_mounted_disk_ids";
const expectedThumbnailKinds = Array.from({ length: 15 }, (_value, index) => `frame_${String(index + 1).padStart(2, "0")}`);
const thumbnailRepairConcurrency = 32;

async function missingThumbnailKindsOnDisk(
  thumbnails: Array<{ kind: string; relativePath: string }>,
  thumbnailsBaseDir: string
): Promise<string[]> {
  const thumbnailsByKind = new Map(thumbnails.map((thumbnail) => [thumbnail.kind, thumbnail]));
  const directoryContents = new Map<string, Set<string>>();

  for (const thumbnail of thumbnails) {
    const thumbnailPath = path.resolve(thumbnailsBaseDir, ...thumbnail.relativePath.split("/"));
    if (!thumbnailPath.startsWith(`${thumbnailsBaseDir}${path.sep}`)) continue;

    const directory = path.dirname(thumbnailPath);
    if (directoryContents.has(directory)) continue;
    try {
      directoryContents.set(directory, new Set(await fs.readdir(directory)));
    } catch {
      directoryContents.set(directory, new Set());
    }
  }

  return expectedThumbnailKinds.filter((kind) => {
    const thumbnail = thumbnailsByKind.get(kind);
    if (!thumbnail) return true;

    const thumbnailPath = path.resolve(thumbnailsBaseDir, ...thumbnail.relativePath.split("/"));
    if (!thumbnailPath.startsWith(`${thumbnailsBaseDir}${path.sep}`)) return true;
    return !directoryContents.get(path.dirname(thumbnailPath))?.has(path.basename(thumbnailPath));
  });
}

function monthlyDownloadTag(date = new Date()): { key: string; label: string } {
  const months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const year = String(date.getFullYear()).slice(-2);
  const month = months[date.getMonth()];
  return { key: `dl-${year}-${month.toLowerCase()}`, label: `${year}/${month}` };
}

async function ensureDownloadMonthCategory(key: string, label: string): Promise<void> {
  await prisma.curationCategory.upsert({
    where: { key },
    create: { key, label, color: "#2A9FD6", builtIn: false },
    update: { label }
  });
}

// Keeps the free space of connected drives current between scans (warnings follow what you delete).
async function updateMeasuredDisks(measured: Array<{ diskId: string; freeBytes: number; totalBytes: number }>): Promise<void> {
  const disks = await prisma.disk.findMany({ where: disksByAgentIdentifiers(measured.map((disk) => disk.diskId)), select: { id: true, volumeId: true } });
  for (const disk of disks) {
    const reading = measured.find((entry) => entry.diskId === disk.volumeId || entry.diskId === disk.id);
    if (!reading) continue;
    await prisma.disk.update({ where: { id: disk.id }, data: { freeBytes: BigInt(reading.freeBytes), totalBytes: BigInt(reading.totalBytes) } });
  }
}

// Names chosen in the web for the drives a Companion has connected, keyed by the identifier the
// Companion uses, so it can write them into each drive's .videocat-disk.json.
async function chosenDiskNames(mountedDiskIds: string[]): Promise<Array<{ diskId: string; name: string }>> {
  if (mountedDiskIds.length === 0) return [];
  const disks = await prisma.disk.findMany({
    where: { AND: [disksByAgentIdentifiers(mountedDiskIds), { nameLocked: true }] },
    select: { id: true, volumeId: true, name: true }
  });
  return disks.flatMap((disk) => {
    const diskId = mountedDiskIds.find((id) => id === disk.volumeId || id === disk.id);
    return diskId ? [{ diskId, name: disk.name }] : [];
  });
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // Live activity (copying, verifying, downloading, scanning, deleting), sent about once a second while busy.
  app.post("/api/agent/companion/activity", { preHandler: requireAgentAuth }, async (request, reply) => {
    const body = z.object({ companionId: z.string().uuid(), activities: activitiesSchema, transfersWaiting: z.boolean().optional(), transfersMode: transfersModeSchema.optional() }).parse(request.body ?? {});
    const headerValue = request.headers["x-videocat-companion-id"];
    if (headerValue !== body.companionId) return reply.code(400).send({ message: "Companion identity header and body must match" });
    const companion = await prisma.companionAgent.findUnique({ where: { installationId: body.companionId }, select: { name: true } });
    storeActivity(body.companionId, companion?.name ?? null, body.activities, Date.now(), body.transfersWaiting ?? false, body.transfersMode ?? "running");
    return { ok: true };
  });

  app.post("/api/agent/companion/heartbeat", { preHandler: requireAgentAuth }, async (request, reply) => {
    const body = companionHeartbeatSchema.parse(request.body ?? {});
    const headerValue = request.headers["x-videocat-companion-id"];
    const headerCompanionId = typeof headerValue === "string" ? headerValue : undefined;
    if (Boolean(body.companionId) !== Boolean(headerCompanionId) || body.companionId !== headerCompanionId) {
      return reply.code(400).send({ message: "Companion identity header and body must match" });
    }
    const mountedDiskIds = [...new Set(body.mountedDiskIds ?? [])];
    noteMountedDisks(body.companionId ?? "companion", mountedDiskIds);
    const metrics: Promise<unknown>[] = [
      setAppMetricValue("companion_last_seen_at", BigInt(Date.now())),
      setAppMetricValue("companion_version", BigInt(body.version ?? 0)),
      setAppMetricValue("companion_mounted_disk_count", BigInt(body.mountedDiskCount ?? mountedDiskIds.length)),
      setAppSettingValue(companionMountedDiskIdsKey, JSON.stringify(mountedDiskIds))
    ];
    if (body.companionId && body.activities) storeActivity(body.companionId, body.companionName ?? null, body.activities, Date.now(), body.transfersWaiting ?? false, body.transfersMode ?? "running");
    const measured = (body.disks ?? []).filter((disk) => agentDiskIdentifierSchema.safeParse(disk.diskId).success && disk.totalBytes > 0 && disk.freeBytes <= disk.totalBytes);
    if (measured.length > 0) metrics.push(updateMeasuredDisks(measured));
    if (body.staging) {
      metrics.push(setAppSettingValue(companionStagingKey, JSON.stringify({ ...body.staging, companionName: body.companionName ?? null, reportedAt: Date.now() })));
    }
    if (body.companionId) {
      metrics.push(prisma.companionAgent.upsert({
        where: { installationId: body.companionId },
        create: {
          installationId: body.companionId,
          name: body.companionName,
          version: body.version ?? 0,
          mountedDiskCount: body.mountedDiskCount ?? mountedDiskIds.length,
          mountedDiskIds
        },
        update: {
          name: body.companionName,
          version: body.version ?? 0,
          mountedDiskCount: body.mountedDiskCount ?? mountedDiskIds.length,
          mountedDiskIds,
          lastSeenAt: new Date(),
        }
      }));
    }
    await Promise.all(metrics);
    const [processDeletesRequestedAt, processDownloadsRequestedAt, orders, accent, diskNames] = await Promise.all([
      appMetricValue("delete_process_requested_at"),
      appMetricValue("download_process_requested_at"),
      transferOrders(),
      profileAccentColor(),
      chosenDiskNames(mountedDiskIds)
    ]);
    return {
      ok: true,
      appearance: { accent },
      diskNames,
      commands: { processDeletesRequestedAt, processDownloadsRequestedAt, transfersStopRequestedAt: orders.stopRequestedAt, transfersResumeRequestedAt: orders.resumeRequestedAt }
    };
  });

  app.post("/api/agent/register-disk", { preHandler: requireAgentAuth }, async (request) => {
    const body = registerDiskSchema.parse(request.body);
    const existing = body.volumeId
      ? await prisma.disk.findFirst({ where: { volumeId: body.volumeId } })
      : null;

    const disk = existing
      ? await prisma.disk.update({
          where: { id: existing.id },
          data: {
            // A name chosen in the web is kept; only the detected one follows the drive.
            ...(existing.nameLocked ? {} : { name: body.name }),
            volumeLabel: body.volumeLabel,
            driveLetter: body.driveLetter,
            totalBytes: body.totalBytes ?? undefined,
            freeBytes: body.freeBytes ?? undefined,
            fileSystem: body.fileSystem,
            notes: body.notes ?? existing.notes,
            lastScannedAt: new Date()
          }
        })
      : await prisma.disk.create({
          data: {
            name: body.name,
            volumeLabel: body.volumeLabel,
            volumeId: body.volumeId,
            driveLetter: body.driveLetter,
            totalBytes: body.totalBytes ?? undefined,
            freeBytes: body.freeBytes ?? undefined,
            fileSystem: body.fileSystem,
            notes: body.notes
          }
        });

    return { disk: serializeDisk(disk) };
  });

  app.post("/api/agent/scan/start", { preHandler: requireAgentAuth }, async (request) => {
    const body = scanStartSchema.parse(request.body);
    const scan = await startScan(body.diskId, body.rootPath, scanLeaseOwner(request));
    return { scan, lease: { expiresAt: scan.leaseExpiresAt, generation: scan.generation } };
  });

  app.get("/api/agent/disks/:id/scan-index", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: agentDiskIdentifierSchema }).parse(request.params);
    const disk = await diskByAgentIdentifier(id);
    if (!disk) return reply.code(404).send({ message: "Disk not found" });

    const files = await prisma.videoFile.findMany({
      where: { diskId: disk.id, isPresent: true },
      select: {
        relativePath: true,
        sizeBytes: true,
        modifiedAt: true,
        readRetryAt: true
      },
      orderBy: { relativePath: "asc" }
    });

    return {
      disk: { id: disk.id, name: disk.name },
      files: files.map((file) => ({
        relativePath: file.relativePath,
        sizeBytes: Number(file.sizeBytes),
        modifiedAt: file.modifiedAt?.toISOString() ?? null
      })),
      // Files at risk the web asked to read again (Companion 0.2.22 or later).
      readRetry: files.filter((file) => file.readRetryAt).map((file) => file.relativePath)
    };
  });

  app.get("/api/agent/disks/:id/fingerprint-repair-queue", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: agentDiskIdentifierSchema }).parse(request.params);
    const disk = await diskByAgentIdentifier(id);
    if (!disk) return reply.code(404).send({ message: "Disk not found" });
    const patterns = await protectedFolderPatterns();
    const files = await prisma.videoFile.findMany({
      where: {
        diskId: disk.id,
        isPresent: true,
        durationSeconds: { not: null },
        OR: [
          { visualFingerprint: null },
          { fingerprintVersion: null },
          { fingerprintVersion: { lt: visualFingerprintVersion } }
        ],
        scanStatus: { in: ["scanned", "thumbnail_failed"] },
        AND: [
          {
            NOT: [
              { relativePath: { equals: "$RECYCLE.BIN", mode: "insensitive" } },
              { relativePath: { startsWith: "$RECYCLE.BIN/", mode: "insensitive" } },
              { relativePath: { equals: "System Volume Information", mode: "insensitive" } },
              { relativePath: { startsWith: "System Volume Information/", mode: "insensitive" } }
            ]
          },
          ...(patterns.length > 0
            ? [{ NOT: { OR: patterns.map((pattern) => ({ relativePath: { contains: pattern, mode: "insensitive" as const } })) } }]
            : [])
        ]
      },
      select: { relativePath: true },
      orderBy: [
        { fingerprintedAt: { sort: "asc", nulls: "first" } },
        { relativePath: "asc" }
      ],
      take: fingerprintRepairBatchLimit
    });
    return { disk: { id: disk.id, name: disk.name }, files };
  });

  app.get("/api/agent/disks/:id/thumbnail-repair-queue", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: agentDiskIdentifierSchema }).parse(request.params);
    const disk = await diskByAgentIdentifier(id);
    if (!disk) return reply.code(404).send({ message: "Disk not found" });

    const files = await prisma.videoFile.findMany({
      // A damaged file cannot give thumbnails: it is only read again when it changes (the Companion
      // notices the new size or date), never on every scan.
      where: {
        diskId: disk.id,
        isPresent: true,
        NOT: [
          { scanStatus: "metadata_failed", errorMessage: { startsWith: damagedMediaPrefix } },
          { scanStatus: "metadata_failed", errorMessage: { startsWith: riskyMediaPrefix } }
        ]
      },
      select: {
        relativePath: true,
        thumbnails: { select: { kind: true, relativePath: true } }
      },
      orderBy: { relativePath: "asc" }
    });

    const thumbnailsBaseDir = path.resolve(env.THUMBNAILS_DIR);
    const repairFiles: Array<{ relativePath: string; missingKinds: string[] }> = [];
    for (let index = 0; index < files.length; index += thumbnailRepairConcurrency) {
      const batch = files.slice(index, index + thumbnailRepairConcurrency);
      const checked = await Promise.all(batch.map(async (file) => ({
        relativePath: file.relativePath,
        missingKinds: await missingThumbnailKindsOnDisk(file.thumbnails, thumbnailsBaseDir)
      })));
      repairFiles.push(...checked.filter((file) => file.missingKinds.length > 0));
    }

    return {
      disk: { id: disk.id, name: disk.name },
      expectedThumbnailCount: expectedThumbnailKinds.length,
      files: repairFiles
    };
  });

  app.post("/api/agent/files/batch", { preHandler: requireAgentAuth }, async (request, reply) => {
    const body = filesBatchSchema.parse(request.body);
    const scan = await prisma.scan.findUnique({
      where: { id: body.scanId },
      select: { diskId: true, status: true }
    });
    if (!scan || scan.diskId !== body.diskId) return reply.code(404).send({ message: "Scan not found for disk" });
    if (scan.status !== "running") return reply.code(409).send({ message: "Scan is not running" });
    if (!await renewScanLease(body.scanId, body.diskId)) return reply.code(409).send({ message: "Scan lease expired; start a new scan" });
    await writeScannedFiles(body.diskId, body.scanId, body.files, body.movesReported ?? false);
    return { ok: true, accepted: body.files.length };
  });

  app.post("/api/agent/scans/:id/seen", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      paths: z.array(z.string().trim().min(1).max(2000)).min(1).max(500)
    }).parse(request.body);
    const scan = await prisma.scan.findUnique({ where: { id }, select: { diskId: true, status: true } });
    if (!scan) return reply.code(404).send({ message: "Scan not found" });
    if (scan.status !== "running") return reply.code(409).send({ message: "Scan is not running" });
    if (!await renewScanLease(id, scan.diskId)) return reply.code(409).send({ message: "Scan lease expired; start a new scan" });

    const { seen, reactivated } = await markSeen(id, scan.diskId, body.paths);
    return { ok: true, seen, reactivated };
  });

  // A folder renamed or a file moved on the same drive: the catalog entry follows it to the new
  // path and keeps everything (tags, review, thumbnails, fingerprint) instead of being scanned
  // again as a new video. Anything that does not match exactly is rejected and scanned as usual.
  app.post("/api/agent/scans/:id/relocate", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      moves: z.array(z.object({
        from: z.string().trim().min(1).max(2000),
        to: z.string().trim().min(1).max(2000),
        absolutePath: z.string().trim().min(1).max(4000),
        sizeBytes: z.number().int().nonnegative(),
        modifiedAt: z.string().datetime(),
        folderSizeBytes: z.number().int().nonnegative().nullable().optional()
      })).min(1).max(200)
    }).parse(request.body);
    const scan = await prisma.scan.findUnique({ where: { id }, select: { diskId: true, status: true, leaseOwner: true } });
    if (!scan) return reply.code(404).send({ message: "Scan not found" });
    if (scan.status !== "running") return reply.code(409).send({ message: "Scan is not running" });
    if (!await renewScanLease(id, scan.diskId)) return reply.code(409).send({ message: "Scan lease expired; start a new scan" });

    const { relocated, rejected } = await relocateFiles({ id, diskId: scan.diskId, leaseOwner: scan.leaseOwner }, body.moves, "companion");
    return { ok: true, relocated, rejected };
  });

  app.post("/api/agent/errors/batch", { preHandler: requireAgentAuth }, async (request, reply) => {
    const body = agentErrorsBatchSchema.parse(request.body);
    const scan = await prisma.scan.findUnique({
      where: { id: body.scanId },
      select: { diskId: true, status: true }
    });
    if (!scan || scan.diskId !== body.diskId) return reply.code(404).send({ message: "Scan not found for disk" });
    if (scan.status !== "running") return reply.code(409).send({ message: "Scan is not running" });
    if (!await renewScanLease(body.scanId, body.diskId)) return reply.code(409).send({ message: "Scan lease expired; start a new scan" });
    await prisma.agentError.createMany({
      data: body.errors.map((error) => ({
        diskId: body.diskId,
        scanId: body.scanId,
        category: error.category,
        phase: error.phase,
        code: error.code ?? null,
        message: error.message,
        absolutePath: error.absolutePath ?? null,
        relativePath: error.relativePath ?? null
      }))
    });
    await prisma.scan.update({
      where: { id: body.scanId },
      data: { errorCount: { increment: body.errors.length } }
    });
    return { ok: true, accepted: body.errors.length };
  });

  app.get("/api/agent/disks/:id/delete-queue", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: agentDiskIdentifierSchema }).parse(request.params);
    const disk = await diskByAgentIdentifier(id);
    if (!disk) return reply.code(404).send({ message: "Disk not found" });

    const files = await prisma.videoFile.findMany({
      where: {
        diskId: disk.id,
        curationStatus: "delete",
        // Never delete a file that a transfer is moving; it is handled when the transfer ends.
        transferItems: { none: { state: { in: unfinishedStates } } }
      },
      select: {
        id: true,
        filename: true,
        relativePath: true,
        sizeBytes: true,
        modifiedAt: true,
        durationSeconds: true,
        visualFingerprint: true
      },
      orderBy: { relativePath: "asc" },
      take: 500
    });

    return {
      disk: serializeDisk(disk),
      files: files.map((file) => ({
        ...file,
        sizeBytes: Number(file.sizeBytes)
      }))
    };
  });

  // A random sample of the files the catalog keeps for a disk, so the Companion can tell whether
  // the drive in front of it is that disk before writing its marker. Unknown disks have no files.
  app.get("/api/agent/disks/:id/identity-sample", { preHandler: requireAgentAuth }, async (request) => {
    const { id } = z.object({ id: agentDiskIdentifierSchema }).parse(request.params);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const disk = await diskByAgentIdentifier(id);
    if (!disk) return { disk: null, totalFiles: 0, files: [] };

    // Files on their way through a transfer are not where the catalog says.
    const notInTransit = Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "TransferItem" ti
      WHERE ti."videoFileId" = vf."id" AND ti."state" IN (${Prisma.join(inTransitStates)})
    )`;
    const [countRows, files] = await Promise.all([
      prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "count" FROM "VideoFile" vf
        WHERE vf."diskId" = ${disk.id}::uuid AND ${notInTransit}
      `),
      prisma.$queryRaw<Array<{ relativePath: string; sizeBytes: bigint }>>(Prisma.sql`
        SELECT vf."relativePath", vf."sizeBytes" FROM "VideoFile" vf
        WHERE vf."diskId" = ${disk.id}::uuid AND ${notInTransit}
        ORDER BY random()
        LIMIT ${limit}
      `)
    ]);

    return {
      disk: serializeDisk(disk),
      totalFiles: Number(countRows[0]?.count ?? 0),
      files: files.map((file) => ({ relativePath: file.relativePath, sizeBytes: Number(file.sizeBytes) }))
    };
  });

  app.get("/api/agent/downloads/queue", { preHandler: requireAgentAuth }, async (request) => {
    const query = z.object({
      diskId: agentDiskIdentifierSchema.optional(),
      // "server": videos in S3 buckets, which the Companion downloads through the server
      // (GET /api/agent/downloads/:id/content). Companions without it never receive them.
      source: z.enum(["drive", "server"]).default("drive"),
      staleMs: z.coerce.number().int().min(5000).max(24 * 60 * 60 * 1000).optional()
    }).parse(request.query);
    const paused = await appMetricValue("download_queue_paused") > 0;
    if (paused) return { paused: true, files: [] };

    const disk = query.source === "drive" && query.diskId ? await diskByAgentIdentifier(query.diskId) : null;
    if (query.source === "drive" && query.diskId && !disk) return { paused: false, files: [] };
    const diskFilter = query.source === "server"
      ? Prisma.sql`AND v."diskId" IN (SELECT "id" FROM "Disk" WHERE "kind" = 's3')`
      : disk
        ? Prisma.sql`AND v."diskId" = ${disk.id}::uuid`
        : Prisma.sql`AND v."diskId" IN (SELECT "id" FROM "Disk" WHERE "kind" <> 's3')`;
    if (query.staleMs) {
      const cutoff = new Date(Date.now() - query.staleMs);
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "DownloadQueue" dq
        SET "status" = 'failed',
            "errorMessage" = ${`Descarga sin progreso durante ${Math.round(query.staleMs / 1000)}s; se cancelo automaticamente.`},
            "updatedAt" = CURRENT_TIMESTAMP
        FROM "VideoFile" v
        WHERE v."id" = dq."videoFileId"
          AND dq."status" = 'downloading'
          AND COALESCE(dq."progressUpdatedAt", dq."startedAt", dq."updatedAt") < ${cutoff}
          ${diskFilter}
      `);
    }

    const queues = await prisma.$queryRaw<Array<{
      id: string;
      fileId: string;
      diskId: string;
      diskName: string;
      filename: string;
      relativePath: string;
      sizeBytes: bigint;
      modifiedAt: Date | null;
      requestedAt: Date;
    }>>(Prisma.sql`
      SELECT
        dq."id"::text AS "id",
        v."id"::text AS "fileId",
        v."diskId"::text AS "diskId",
        d."name" AS "diskName",
        v."filename",
        v."relativePath",
        v."sizeBytes",
        v."modifiedAt",
        dq."requestedAt"
      FROM "DownloadQueue" dq
      INNER JOIN "VideoFile" v ON v."id" = dq."videoFileId"
      INNER JOIN "Disk" d ON d."id" = v."diskId"
      WHERE dq."status" = 'queued'
        AND v."isPresent" = TRUE
        ${diskFilter}
      ORDER BY dq."requestedAt" ASC
      LIMIT 1
    `);

    return {
      paused: false,
      // Echoed so a Companion knows this server understood "server" (older ones ignore it).
      source: query.source,
      files: queues.map((queue) => ({
        id: queue.id,
        fileId: queue.fileId,
        diskId: queue.diskId,
        diskName: queue.diskName,
        filename: queue.filename,
        relativePath: queue.relativePath,
        sizeBytes: Number(queue.sizeBytes),
        modifiedAt: queue.modifiedAt,
        requestedAt: queue.requestedAt
      }))
    };
  });

  // The object of a queued download from an S3 bucket, streamed from the bucket: the Companion
  // never holds the bucket's credentials.
  app.get("/api/agent/downloads/:id/content", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await prisma.downloadQueue.findUnique({
      where: { id },
      include: { videoFile: { include: { disk: { include: { storageBucket: true } } } } }
    });
    if (!item || !["queued", "downloading"].includes(item.status)) return reply.code(404).send({ message: "Download not found" });
    const bucket = item.videoFile.disk.storageBucket;
    if (item.videoFile.disk.kind !== "s3" || !bucket) return reply.code(404).send({ message: "Only downloads from S3 buckets come through the server" });
    const sizeBytes = Number(item.videoFile.sizeBytes);
    const headers = { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Length": String(sizeBytes) };
    if (sizeBytes === 0) return reply.headers(headers).send(Buffer.alloc(0));
    const upstream = new AbortController();
    request.raw.on("close", () => upstream.abort());
    try {
      const body = await readObjectRange(locationOf(bucket), `${bucket.prefix}${item.videoFile.relativePath}`, 0, sizeBytes - 1, upstream.signal);
      return reply.headers(headers).send(Readable.fromWeb(body as WebReadableStream<Uint8Array>));
    } catch (error) {
      if (request.raw.aborted || reply.raw.destroyed) return reply;
      request.log.warn({ downloadId: id, storageBucketId: bucket.id, error: error instanceof Error ? error.message : "unknown" }, "S3 download could not start");
      return reply.code(502).send({ message: "The bucket did not answer" });
    }
  });

  app.patch("/api/agent/downloads/:id/status", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = downloadStatusSchema.parse(request.body);
    const currentRows = await prisma.$queryRaw<Array<{ videoFileId: string; destinationPath: string | null; downloadedTag: string | null }>>(Prisma.sql`
      SELECT "videoFileId"::text AS "videoFileId", "destinationPath", "downloadedTag"
      FROM "DownloadQueue"
      WHERE "id" = ${id}::uuid
      LIMIT 1
    `);
    const current = currentRows[0];
    if (!current) return reply.code(404).send({ message: "Download queue item not found" });

    const completedAt = body.status === "done" ? new Date() : null;
    const tag = body.status === "done" ? monthlyDownloadTag(completedAt ?? new Date()) : null;
    if (tag) await ensureDownloadMonthCategory(tag.key, tag.label);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "DownloadQueue"
        SET "status" = ${body.status},
            "startedAt" = CASE
              WHEN ${body.status} = 'downloading' THEN CURRENT_TIMESTAMP
              ELSE "startedAt"
            END,
            "completedAt" = ${completedAt},
            "destinationPath" = COALESCE(${body.destinationPath ?? null}, "destinationPath"),
            "downloadedTag" = COALESCE(${tag?.label ?? null}, "downloadedTag"),
            "errorMessage" = ${body.status === "failed" ? (body.errorMessage ?? "Download failed") : null},
            "progressBytes" = CASE
              WHEN ${body.status} = 'done' THEN (
                SELECT v."sizeBytes" FROM "VideoFile" v WHERE v."id" = "DownloadQueue"."videoFileId"
              )
              WHEN ${body.progressBytes ?? null}::bigint IS NOT NULL THEN ${body.progressBytes ?? null}::bigint
              WHEN ${body.status} = 'queued' THEN 0
              ELSE "progressBytes"
            END,
            "progressUpdatedAt" = CASE
              WHEN ${body.status} IN ('downloading', 'done') OR ${body.progressBytes ?? null}::bigint IS NOT NULL THEN CURRENT_TIMESTAMP
              ELSE "progressUpdatedAt"
            END,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid
      `);
      if (tag) {
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM "VideoFileCategory"
          WHERE "videoFileId" = ${current.videoFileId}::uuid AND "categoryKey" = 'download'
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "VideoFileCategory" ("videoFileId", "categoryKey")
          VALUES (${current.videoFileId}::uuid, ${tag.key})
          ON CONFLICT DO NOTHING
        `);
      }
    });

    return { ok: true };
  });

  app.post("/api/agent/files/:id/deletion-result", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = deletionResultSchema.parse(request.body);
    const headerValue = request.headers["x-videocat-companion-id"];
    const companionId = typeof headerValue === "string" ? headerValue : null;

    if (body.status === "failed" || body.status === "identity_mismatch") {
      const recorded = await recordDeletionFailure(id, body.errorMessage, { companionId });
      if (!recorded) return reply.code(404).send({ message: "File not found" });
      if (body.status === "identity_mismatch") {
        await prisma.$transaction([
          prisma.videoFile.updateMany({
            where: { id, curationStatus: "delete" },
            data: { curationStatus: "none", reviewedAt: null }
          }),
          prisma.videoFileCategory.deleteMany({
            where: { videoFileId: id, categoryKey: "delete" }
          })
        ]);
      }
      return { ok: true, removedFromCatalog: false, deleteMarkCleared: body.status === "identity_mismatch" };
    }

    const result = await finalizeDeletion(id, body.status, { companionId });
    if (!result) return reply.code(404).send({ message: "File not found" });
    return { ok: true, removedFromCatalog: true, ...result };
  });

  app.delete("/api/agent/files/:id/catalog", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const headerValue = request.headers["x-videocat-companion-id"];
    const companionId = typeof headerValue === "string" ? headerValue : null;
    const result = await finalizeDeletion(id, "deleted", { companionId });
    if (!result) return reply.code(404).send({ message: "File not found" });
    return { ok: true, ...result };
  });

  app.post("/api/agent/thumbnails/upload", { preHandler: requireAgentAuth }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ message: "Missing thumbnail file" });

    const fields = data.fields as Record<string, { value?: unknown }>;
    const metadata = z.object({
      diskId: z.string().uuid(),
      relativePath: z.string().trim().min(1).max(4000),
      kind: thumbnailKindSchema,
      timestampSeconds: z.coerce.number().finite().nonnegative()
    }).parse({
      diskId: String(fields.diskId?.value ?? ""),
      relativePath: String(fields.relativePath?.value ?? ""),
      kind: String(fields.kind?.value ?? ""),
      timestampSeconds: fields.timestampSeconds?.value ?? 0
    });

    try {
      const thumbnail = await storeThumbnail({ ...metadata, image: await data.toBuffer() });
      return { thumbnail };
    } catch (error) {
      if (!(error instanceof ThumbnailStoreError)) throw error;
      if (error.reason === "no_video") return reply.code(404).send({ message: error.message });
      if (error.reason === "not_jpeg") return reply.code(415).send({ message: error.message });
      request.log.error({ err: error.cause }, "Thumbnail storage is not writable");
      return reply.code(507).send({ message: `Thumbnail storage is not writable on the server. ${thumbnailStorageHint}` });
    }
  });

  app.post("/api/agent/scan/finish", { preHandler: requireAgentAuth }, async (request, reply) => {
    const body = z.object({
      scanId: z.string().uuid(),
      reconcile: z.boolean().default(false),
      scanRoots: z.array(z.string().trim().min(1).max(1000)).max(100).default([])
    }).parse(request.body);
    const current = await prisma.scan.findUnique({ where: { id: body.scanId } });
    if (!current) return reply.code(404).send({ message: "Scan not found" });
    if (current.status !== "running") return reply.code(409).send({ message: "Scan is not running" });
    if (!await renewScanLease(body.scanId, current.diskId)) return reply.code(409).send({ message: "Scan lease expired; start a new scan" });

    return finishScan(current, { reconcile: body.reconcile, scanRoots: body.scanRoots, actorType: "companion" });
  });
}
