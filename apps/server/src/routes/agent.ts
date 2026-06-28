import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  agentErrorsBatchSchema,
  filesBatchSchema,
  registerDiskSchema,
  scanStartSchema,
  thumbnailKindSchema
} from "@videocat/shared";
import { prisma } from "../lib/prisma.js";
import { requireAgentAuth } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { serializeDisk } from "../lib/serialize.js";

function toDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

async function incrementAppMetric(key: string, incrementBy: bigint): Promise<void> {
  if (incrementBy <= 0n) return;
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppMetric" ("key", "valueBigInt", "updatedAt")
    VALUES (${key}, ${incrementBy}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE
    SET "valueBigInt" = "AppMetric"."valueBigInt" + EXCLUDED."valueBigInt",
        "updatedAt" = CURRENT_TIMESTAMP
  `);
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

function videoFileData(diskId: string, file: ReturnType<typeof filesBatchSchema.parse>["files"][number]) {
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
    ffprobeJson: file.metadata?.raw ?? undefined
  };
}

function errorCategory(status: string, message?: string | null): string {
  const text = `${status} ${message ?? ""}`.toLowerCase();
  if (text.includes("eperm") || text.includes("eacces") || text.includes("permission")) return "permission";
  if (text.includes("enoent") || text.includes("not found")) return "missing_path";
  if (text.includes("ffprobe") || status === "metadata_failed") return "metadata";
  if (text.includes("ffmpeg") || status === "thumbnail_failed") return "thumbnail";
  return status === "failed" ? "agent" : status;
}

async function diskByAgentIdentifier(identifier: string) {
  return prisma.disk.findFirst({
    where: {
      OR: [
        { id: identifier },
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
  mountedDiskCount: z.number().int().nonnegative().optional()
});

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

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/agent/companion/heartbeat", { preHandler: requireAgentAuth }, async (request) => {
    const body = companionHeartbeatSchema.parse(request.body ?? {});
    await Promise.all([
      setAppMetricValue("companion_last_seen_at", BigInt(Date.now())),
      setAppMetricValue("companion_version", BigInt(body.version ?? 0)),
      setAppMetricValue("companion_mounted_disk_count", BigInt(body.mountedDiskCount ?? 0))
    ]);
    return { ok: true };
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
            name: body.name,
            volumeLabel: body.volumeLabel,
            driveLetter: body.driveLetter,
            totalBytes: body.totalBytes ?? undefined,
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
            fileSystem: body.fileSystem,
            notes: body.notes
          }
        });

    return { disk: serializeDisk(disk) };
  });

  app.post("/api/agent/scan/start", { preHandler: requireAgentAuth }, async (request) => {
    const body = scanStartSchema.parse(request.body);
    const scan = await prisma.scan.create({
      data: {
        diskId: body.diskId,
        rootPath: body.rootPath,
        status: "running"
      }
    });
    return { scan };
  });

  app.post("/api/agent/files/batch", { preHandler: requireAgentAuth }, async (request) => {
    const body = filesBatchSchema.parse(request.body);
    let errorCount = 0;

    for (const file of body.files) {
      if (file.status !== "scanned") errorCount += 1;

      const data = videoFileData(body.diskId, file);
      const existing = await prisma.videoFile.findUnique({
        where: {
          diskId_relativePath: {
            diskId: body.diskId,
            relativePath: file.relativePath
          }
        },
        select: { id: true }
      });

      if (existing) {
        await prisma.videoFile.update({
          where: { id: existing.id },
          data
        });
        if (file.status !== "scanned") {
          await prisma.agentError.create({
            data: {
              diskId: body.diskId,
              scanId: body.scanId,
              category: errorCategory(file.status, file.errorMessage),
              phase: file.status === "thumbnail_failed" ? "thumbnail" : "metadata",
              message: file.errorMessage ?? file.status,
              absolutePath: file.absolutePath,
              relativePath: file.relativePath
            }
          });
        }
        continue;
      }

      const movedCandidates = data.modifiedAt
        ? await prisma.videoFile.findMany({
            where: {
              diskId: body.diskId,
              filename: file.filename,
              sizeBytes: file.sizeBytes,
              modifiedAt: data.modifiedAt,
              NOT: { relativePath: file.relativePath }
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
      if (file.status !== "scanned") {
        await prisma.agentError.create({
          data: {
            diskId: body.diskId,
            scanId: body.scanId,
            category: errorCategory(file.status, file.errorMessage),
            phase: file.status === "thumbnail_failed" ? "thumbnail" : "metadata",
            message: file.errorMessage ?? file.status,
            absolutePath: file.absolutePath,
            relativePath: file.relativePath
          }
        });
      }
    }

    await prisma.scan.update({
      where: { id: body.scanId },
      data: {
        fileCount: { increment: body.files.length },
        errorCount: { increment: errorCount }
      }
    });

    await prisma.disk.update({
      where: { id: body.diskId },
      data: { lastScannedAt: new Date() }
    });

    return { ok: true, accepted: body.files.length };
  });

  app.post("/api/agent/errors/batch", { preHandler: requireAgentAuth }, async (request) => {
    const body = agentErrorsBatchSchema.parse(request.body);
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
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const disk = await diskByAgentIdentifier(id);
    if (!disk) return reply.code(404).send({ message: "Disk not found" });

    const files = await prisma.videoFile.findMany({
      where: {
        diskId: disk.id,
        curationStatus: "delete"
      },
      select: {
        id: true,
        filename: true,
        relativePath: true,
        sizeBytes: true,
        modifiedAt: true
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

  app.get("/api/agent/downloads/queue", { preHandler: requireAgentAuth }, async (request) => {
    const query = z.object({
      diskId: z.string().uuid().optional(),
      staleMs: z.coerce.number().int().min(5000).max(24 * 60 * 60 * 1000).optional()
    }).parse(request.query);
    const paused = await appMetricValue("download_queue_paused") > 0;
    if (paused) return { paused: true, files: [] };

    const disk = query.diskId ? await diskByAgentIdentifier(query.diskId) : null;
    if (query.diskId && !disk) return { paused: false, files: [] };
    const diskFilter = disk ? Prisma.sql`AND v."diskId" = ${disk.id}::uuid` : Prisma.empty;
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
        ${diskFilter}
      ORDER BY dq."requestedAt" ASC
      LIMIT 1
    `);

    return {
      paused: false,
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

  app.delete("/api/agent/files/:id/catalog", { preHandler: requireAgentAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const file = await prisma.videoFile.findUnique({
      where: { id },
      include: { thumbnails: true }
    });
    if (!file) return reply.code(404).send({ message: "File not found" });

    await prisma.videoFile.delete({ where: { id } });
    if (file.curationStatus === "delete") {
      await incrementAppMetric("review_freed_bytes", file.sizeBytes);
    }

    const baseDir = path.resolve(env.THUMBNAILS_DIR);
    for (const thumbnail of file.thumbnails) {
      const filePath = path.resolve(baseDir, ...thumbnail.relativePath.split("/"));
      if (!filePath.startsWith(`${baseDir}${path.sep}`)) continue;
      await fs.rm(filePath, { force: true }).catch(() => undefined);
    }

    return { ok: true };
  });

  app.post("/api/agent/thumbnails/upload", { preHandler: requireAgentAuth }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ message: "Missing thumbnail file" });

    const fields = data.fields as Record<string, { value?: unknown }>;
    const diskId = String(fields.diskId?.value ?? "");
    const relativePath = String(fields.relativePath?.value ?? "");
    const kind = thumbnailKindSchema.parse(String(fields.kind?.value ?? ""));
    const timestampSeconds = Number(fields.timestampSeconds?.value ?? 0);

    const videoFile = await prisma.videoFile.findUnique({
      where: { diskId_relativePath: { diskId, relativePath } }
    });
    if (!videoFile) return reply.code(404).send({ message: "Video file must be uploaded before thumbnails" });

    const filename = `${kind}.jpg`;
    const thumbnailRelativePath = path.posix.join(diskId, videoFile.id, filename);
    const destination = path.join(env.THUMBNAILS_DIR, thumbnailRelativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, await data.toBuffer());

    const thumbnail = await prisma.thumbnail.upsert({
      where: {
        videoFileId_kind: {
          videoFileId: videoFile.id,
          kind
        }
      },
      create: {
        videoFileId: videoFile.id,
        kind,
        timestampSeconds,
        relativePath: thumbnailRelativePath
      },
      update: {
        timestampSeconds,
        relativePath: thumbnailRelativePath
      }
    });

    return { thumbnail };
  });

  app.post("/api/agent/scan/finish", { preHandler: requireAgentAuth }, async (request) => {
    const body = z.object({ scanId: z.string().uuid() }).parse(request.body);
    const scan = await prisma.scan.update({
      where: { id: body.scanId },
      data: { status: "finished", finishedAt: new Date() }
    });
    return { scan };
  });
}
