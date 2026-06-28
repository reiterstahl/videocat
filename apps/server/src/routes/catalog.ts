import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { filesQuerySchema, tagsFromFilename } from "@videocat/shared";
import { isProtectedFolderUnlocked, requireWebAuth } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { protectedFolderPatterns as loadProtectedFolderPatterns } from "../lib/protected-settings.js";
import { serializeDisk, serializeFile } from "../lib/serialize.js";

function parseBigInt(value: number | undefined): bigint | undefined {
  return value == null ? undefined : BigInt(Math.floor(value));
}

const facetsQuerySchema = z.object({
  diskIds: z.string().max(4000).optional()
});
const diskIdsQuerySchema = z.object({
  diskIds: z.string().max(4000).optional()
});
const categoryKeySchema = z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/);
const curationStatusSchema = z.union([z.literal("none"), categoryKeySchema]);
const fileCategoryToggleSchema = z.object({
  enabled: z.boolean()
});
const fileBatchCategorySchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(500),
  enabled: z.boolean()
});
const downloadQueueSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(500)
});
const downloadQueueRemoveSchema = z.object({
  queueIds: z.array(z.string().uuid()).min(1).max(500)
});
const randomDownloadSchema = z.object({
  diskIds: z.array(z.string().uuid()).min(1).max(100),
  targetGb: z.number().positive().max(500)
});
const downloadPauseSchema = z.object({
  paused: z.boolean()
});

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function sevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

function visibleReviewSql(protectedUnlocked: boolean): Prisma.Sql {
  return Prisma.sql`
    AND NOT (
        "relativePath" ILIKE '$RECYCLE.BIN'
        OR "relativePath" ILIKE '$RECYCLE.BIN/%'
        OR "relativePath" ILIKE '$RECYCLE.BIN\\%'
        OR "relativePath" ILIKE 'System Volume Information'
        OR "relativePath" ILIKE 'System Volume Information/%'
        OR "relativePath" ILIKE 'System Volume Information\\%'
      )
      ${protectedPathSql(Prisma.sql`"relativePath"`, protectedUnlocked)}
  `;
}

function reviewDiskFilterSql(diskIds: string[], filterRequested: boolean): Prisma.Sql {
  if (!filterRequested) return Prisma.empty;
  if (diskIds.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND "diskId" IN (${Prisma.join(diskIds.map((id) => Prisma.sql`${id}::uuid`))})`;
}

async function countReviewedToday(protectedUnlocked: boolean, diskIds: string[] = [], filterRequested = false): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM "VideoFile"
    WHERE "curationStatus" IN ('keep', 'delete')
      AND "reviewedAt" >= ${startOfToday()}
      ${visibleReviewSql(protectedUnlocked)}
      ${reviewDiskFilterSql(diskIds, filterRequested)}
  `);
  return Number(rows[0]?.count ?? 0);
}

async function countReviewedLast7Days(protectedUnlocked: boolean, diskIds: string[] = [], filterRequested = false): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM "VideoFile"
    WHERE "curationStatus" IN ('keep', 'delete')
      AND "reviewedAt" >= ${sevenDaysAgo()}
      ${visibleReviewSql(protectedUnlocked)}
      ${reviewDiskFilterSql(diskIds, filterRequested)}
  `);
  return Number(rows[0]?.count ?? 0);
}

async function appMetricValue(key: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ valueBigInt: bigint }>>(Prisma.sql`
    SELECT "valueBigInt"
    FROM "AppMetric"
    WHERE "key" = ${key}
    LIMIT 1
  `);
  return Number(rows[0]?.valueBigInt ?? 0);
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

async function recentReviewedIds(protectedUnlocked: boolean, take: number, diskIds: string[] = [], filterRequested = false): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"::text AS "id"
    FROM "VideoFile"
    WHERE "curationStatus" IN ('keep', 'delete')
      ${visibleReviewSql(protectedUnlocked)}
      ${reviewDiskFilterSql(diskIds, filterRequested)}
    ORDER BY "reviewedAt" DESC NULLS LAST, "updatedAt" DESC
    LIMIT ${take}
  `);
  return rows.map((row) => row.id);
}

const categoryColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const categoryCreateSchema = z.object({
  label: z.string().trim().min(1).max(32),
  color: categoryColorSchema
});
const uuidParamsSchema = z.object({
  id: z.string().uuid()
});
const thumbnailParamsSchema = z.object({
  diskId: z.string().uuid(),
  videoFileId: z.string().uuid(),
  filename: z.string().regex(/^(main|frame_\d{2})\.jpg$/)
});

function categoryKeyFromLabel(label: string): string {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || `cat-${Date.now().toString(36)}`;
}

const hiddenRootFolders = new Set(["$recycle.bin", "system volume information"]);
let protectedFolderPatterns = env.PROTECTED_FOLDER_PATTERNS
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function protectedPathSql(field: Prisma.Sql, protectedUnlocked: boolean): Prisma.Sql {
  if (protectedUnlocked || protectedFolderPatterns.length === 0) return Prisma.empty;
  return Prisma.sql`AND NOT (${Prisma.join(
    protectedFolderPatterns.map((pattern) => Prisma.sql`${field} ILIKE ${`%${escapeLikePattern(pattern)}%`} ESCAPE '\\'`),
    " OR "
  )})`;
}

function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function expandSearchVariants(value: string): string[] {
  const replacements: Record<string, string[]> = {
    a: ["a", "á"],
    e: ["e", "é"],
    i: ["i", "í"],
    n: ["n", "ñ"],
    o: ["o", "ó"],
    u: ["u", "ú", "ü"]
  };
  const normalized = normalizeSearchValue(value);
  let variants = [""];

  for (const character of normalized) {
    const options = replacements[character] ?? [character];
    variants = variants.flatMap((variant) => options.map((option) => `${variant}${option}`)).slice(0, 32);
  }

  return [...new Set([value, normalized, ...variants].filter(Boolean))].slice(0, 32);
}

function searchTokenVariants(value: string): string[][] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((token) => expandSearchVariants(token));
}

function folderLabel(path: string): string {
  if (path === ".") return "Raiz del disco";
  return path.split("/").at(-1) ?? path;
}

function folderDepth(path: string): number {
  return path === "." ? 0 : path.split("/").length;
}

function pathSegments(pathValue: string): string[] {
  return pathValue.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
}

function foldersFromPath(relativePath: string): string[] {
  const parts = pathSegments(relativePath);
  if (parts.length <= 1) return ["."];

  const folders: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    folders.push(parts.slice(0, index + 1).join("/"));
  }
  return folders;
}

function isHiddenSystemPath(relativePath: string): boolean {
  const root = pathSegments(relativePath)[0]?.toLowerCase();
  return root ? hiddenRootFolders.has(root) : false;
}

function isProtectedPath(relativePath: string): boolean {
  if (protectedFolderPatterns.length === 0) return false;
  return pathSegments(relativePath).some((segment) => {
    const normalized = segment.toLowerCase();
    return protectedFolderPatterns.some((pattern) => normalized.includes(pattern));
  });
}

function firstProtectedFolderPath(pathValue: string): string | null {
  const parts = pathSegments(pathValue);
  const index = parts.findIndex((segment) => {
    const normalized = segment.toLowerCase();
    return protectedFolderPatterns.some((pattern) => normalized.includes(pattern));
  });
  return index >= 0 ? parts.slice(0, index + 1).join("/") : null;
}

function applyHiddenPathFilter(where: Prisma.VideoFileWhereInput): void {
  where.AND = [
    ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as Prisma.VideoFileWhereInput[]),
    {
      NOT: [
        { relativePath: { equals: "$RECYCLE.BIN", mode: "insensitive" } },
        { relativePath: { startsWith: "$RECYCLE.BIN/", mode: "insensitive" } },
        { relativePath: { startsWith: "$RECYCLE.BIN\\", mode: "insensitive" } },
        { relativePath: { equals: "System Volume Information", mode: "insensitive" } },
        { relativePath: { startsWith: "System Volume Information/", mode: "insensitive" } },
        { relativePath: { startsWith: "System Volume Information\\", mode: "insensitive" } }
      ]
    }
  ];
}

function protectedPathFilter(): Prisma.VideoFileWhereInput | null {
  if (protectedFolderPatterns.length === 0) return null;
  return {
    OR: protectedFolderPatterns.map((pattern) => ({
      relativePath: { contains: pattern, mode: "insensitive" }
    }))
  };
}

function applyProtectedPathFilter(where: Prisma.VideoFileWhereInput): void {
  const filter = protectedPathFilter();
  if (!filter) return;
  where.AND = [
    ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as Prisma.VideoFileWhereInput[]),
    { NOT: filter }
  ];
}

function duplicateEligibleWhere(extra: Prisma.VideoFileWhereInput = {}): Prisma.VideoFileWhereInput {
  const where: Prisma.VideoFileWhereInput = { ...extra };
  applyHiddenPathFilter(where);
  applyProtectedPathFilter(where);
  return where;
}

function fileIncludes() {
  return {
    disk: true,
    thumbnails: { orderBy: { kind: "asc" as const } }
  };
}

type CategoryRow = {
  videoFileId: string;
  categoryKey: string;
};

async function categoryRowsForFileIds(ids: string[]): Promise<CategoryRow[]> {
  if (ids.length === 0) return [];
  return prisma.$queryRaw<CategoryRow[]>(Prisma.sql`
    SELECT "videoFileId", "categoryKey"
    FROM "VideoFileCategory"
    WHERE "videoFileId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
  `);
}

async function categoryFileIds(categoryKey: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ videoFileId: string }>>(Prisma.sql`
    SELECT "videoFileId"
    FROM "VideoFileCategory"
    WHERE "categoryKey" = ${categoryKey}
  `);
  return rows.map((row) => row.videoFileId);
}

async function ensureCategory(key: string, label: string, color: string, builtIn = true): Promise<void> {
  await prisma.curationCategory.upsert({
    where: { key },
    create: { key, label, color, builtIn },
    update: { label, color, builtIn }
  });
}

async function queueDownloadsForFileIds(fileIds: string[], source = "manual"): Promise<void> {
  const uniqueIds = [...new Set(fileIds)];
  if (uniqueIds.length === 0) return;
  await ensureCategory("download", "A descargar", "#FC6121", true);
  const idSql = Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`));
  await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`
      INSERT INTO "VideoFileCategory" ("videoFileId", "categoryKey")
      SELECT selected."id", 'download'
      FROM unnest(ARRAY[${idSql}]) AS selected("id")
      ON CONFLICT DO NOTHING
    `),
    prisma.$executeRaw(Prisma.sql`
      INSERT INTO "DownloadQueue" ("videoFileId", "status", "source", "requestedAt", "updatedAt")
      SELECT selected."id", 'queued', ${source}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM unnest(ARRAY[${idSql}]) AS selected("id")
      ON CONFLICT ("videoFileId") DO UPDATE
      SET "status" = CASE
            WHEN "DownloadQueue"."status" = 'downloading' THEN "DownloadQueue"."status"
            ELSE 'queued'
          END,
          "source" = EXCLUDED."source",
          "requestedAt" = CURRENT_TIMESTAMP,
          "startedAt" = CASE WHEN "DownloadQueue"."status" = 'downloading' THEN "DownloadQueue"."startedAt" ELSE NULL END,
          "completedAt" = NULL,
          "destinationPath" = NULL,
          "errorMessage" = NULL,
          "progressBytes" = CASE WHEN "DownloadQueue"."status" = 'downloading' THEN "DownloadQueue"."progressBytes" ELSE 0 END,
          "progressUpdatedAt" = CASE WHEN "DownloadQueue"."status" = 'downloading' THEN "DownloadQueue"."progressUpdatedAt" ELSE NULL END,
          "updatedAt" = CURRENT_TIMESTAMP
    `)
  ]);
}

async function removeQueuedDownloadsForFileIds(fileIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(fileIds)];
  if (uniqueIds.length === 0) return;
  const idSql = Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`));
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "DownloadQueue"
    WHERE "videoFileId" IN (${idSql}) AND "status" IN ('queued', 'failed')
  `);
}

function monthDownloadTag(date = new Date()): { key: string; label: string } {
  const months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const year = String(date.getFullYear()).slice(-2);
  const month = months[date.getMonth()];
  return { key: `dl-${year}-${month.toLowerCase()}`, label: `${year}/${month}` };
}

async function attachCategoryKeys<T extends { id: string; curationStatus: string }>(
  files: T[]
): Promise<Array<T & { categoryKeys: string[] }>> {
  const rows = await categoryRowsForFileIds(files.map((file) => file.id));
  const byFileId = new Map<string, string[]>();
  for (const row of rows) {
    byFileId.set(row.videoFileId, [...(byFileId.get(row.videoFileId) ?? []), row.categoryKey]);
  }

  return files.map((file) => ({
    ...file,
    categoryKeys: byFileId.get(file.id) ?? (file.curationStatus !== "none" ? [file.curationStatus] : [])
  }));
}

function applyFolderFilter(where: Prisma.VideoFileWhereInput, folders: string[]): void {
  if (folders.length === 0) return;

  const folderFilters: Prisma.VideoFileWhereInput[] = folders.flatMap<Prisma.VideoFileWhereInput>((folder) => {
    if (folder === ".") {
      return [
        {
          NOT: [
            { relativePath: { contains: "/" } },
            { relativePath: { contains: "\\" } }
          ]
        }
      ];
    }

    return [
      { relativePath: { startsWith: `${folder}/` } },
      { relativePath: { startsWith: `${folder}\\` } }
    ];
  });

  where.AND = [
    ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as Prisma.VideoFileWhereInput[]),
    { OR: folderFilters }
  ];
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async () => {
    protectedFolderPatterns = (await loadProtectedFolderPatterns()).map((pattern) => pattern.toLowerCase());
  });

  app.get("/thumbnails/:diskId/:videoFileId/:filename", { preHandler: requireWebAuth }, async (request, reply) => {
    const params = thumbnailParamsSchema.parse(request.params);
    const relativePath = path.posix.join(params.diskId, params.videoFileId, params.filename);
    const thumbnail = await prisma.thumbnail.findFirst({
      where: {
        videoFileId: params.videoFileId,
        relativePath
      },
      include: {
        videoFile: true
      }
    });

    if (!thumbnail) return reply.code(404).send({ message: "Thumbnail not found" });
    if (thumbnail.videoFile.diskId !== params.diskId) return reply.code(404).send({ message: "Thumbnail not found" });
    if (isHiddenSystemPath(thumbnail.videoFile.relativePath)) return reply.code(404).send({ message: "Thumbnail not found" });
    if (isProtectedPath(thumbnail.videoFile.relativePath) && !isProtectedFolderUnlocked(request)) {
      return reply.code(403).send({ message: "PIN required" });
    }

    const baseDir = path.resolve(env.THUMBNAILS_DIR);
    const filePath = path.resolve(baseDir, ...relativePath.split("/"));
    if (!filePath.startsWith(`${baseDir}${path.sep}`)) {
      return reply.code(404).send({ message: "Thumbnail not found" });
    }

    try {
      const image = await fs.readFile(filePath);
      return reply
        .type("image/jpeg")
        .header("Cache-Control", "private, max-age=86400")
        .send(image);
    } catch {
      return reply.code(404).send({ message: "Thumbnail not found" });
    }
  });

  app.get("/api/disks", { preHandler: requireWebAuth }, async () => {
    const disks = await prisma.disk.findMany({ orderBy: { name: "asc" } });
    return { disks: disks.map(serializeDisk) };
  });

  app.delete("/api/admin/disks/:id/catalog", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = uuidParamsSchema.parse(request.params);
    const disk = await prisma.disk.findUnique({ where: { id } });
    if (!disk) return reply.code(404).send({ message: "Disk not found" });

    const [thumbnails, files, errors, scans, updatedDisk] = await prisma.$transaction([
      prisma.thumbnail.deleteMany({ where: { videoFile: { is: { diskId: id } } } }),
      prisma.videoFile.deleteMany({ where: { diskId: id } }),
      prisma.agentError.deleteMany({ where: { diskId: id } }),
      prisma.scan.deleteMany({ where: { diskId: id } }),
      prisma.disk.update({
        where: { id },
        data: { lastScannedAt: new Date() }
      })
    ]);

    let thumbnailFilesRemoved = true;
    let thumbnailFileWarning: string | null = null;
    try {
      await fs.rm(path.join(env.THUMBNAILS_DIR, id), { recursive: true, force: true });
    } catch (error) {
      thumbnailFilesRemoved = false;
      thumbnailFileWarning = error instanceof Error ? error.message : "Could not remove thumbnail files";
    }

    return {
      ok: true,
      disk: serializeDisk(updatedDisk),
      deleted: {
        files: files.count,
        thumbnails: thumbnails.count,
        errors: errors.count,
        scans: scans.count
      },
      thumbnailFilesRemoved,
      thumbnailFileWarning
    };
  });

  app.get("/api/categories", { preHandler: requireWebAuth }, async () => {
    const categories = await prisma.curationCategory.findMany({
      orderBy: [{ builtIn: "desc" }, { label: "asc" }]
    });
    return { categories };
  });

  app.post("/api/categories", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = categoryCreateSchema.parse(request.body);
    const key = categoryKeyFromLabel(body.label);
    const existing = await prisma.curationCategory.findUnique({ where: { key } });
    if (existing) return reply.code(409).send({ message: "Category already exists" });

    const category = await prisma.curationCategory.create({
      data: {
        key,
        label: body.label,
        color: body.color.toUpperCase()
      }
    });

    return { category };
  });

  app.delete("/api/categories/:key", { preHandler: requireWebAuth }, async (request, reply) => {
    const { key } = z.object({ key: categoryKeySchema }).parse(request.params);
    const category = await prisma.curationCategory.findUnique({ where: { key } });
    if (!category) return reply.code(404).send({ message: "Category not found" });
    if (category.builtIn) {
      return reply.code(400).send({ message: "This category cannot be deleted" });
    }

    await prisma.$transaction([
      prisma.videoFile.updateMany({
        where: { curationStatus: key },
        data: { curationStatus: "none" }
      }),
      prisma.curationCategory.delete({ where: { key } })
    ]);

    return { ok: true };
  });

  app.get("/api/facets", { preHandler: requireWebAuth }, async (request) => {
    const query = facetsQuerySchema.parse(request.query);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const diskIds = commaList(query.diskIds);
    const where: Prisma.VideoFileWhereInput = diskIds.length > 0 ? { diskId: { in: diskIds } } : {};
    applyHiddenPathFilter(where);
    const files = await prisma.videoFile.findMany({
      where,
      select: {
        id: true,
        filename: true,
        extension: true,
        relativePath: true,
        curationStatus: true
      }
    });
    const categoryRows = await categoryRowsForFileIds(files.map((file) => file.id));
    const categoryRowsByFileId = new Map<string, string[]>();
    for (const row of categoryRows) {
      categoryRowsByFileId.set(row.videoFileId, [...(categoryRowsByFileId.get(row.videoFileId) ?? []), row.categoryKey]);
    }

    const folderCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const extensionCounts = new Map<string, number>();
    const curationCounts = new Map<string, number>();

    for (const file of files) {
      if (isHiddenSystemPath(file.relativePath)) continue;

      const protectedFolder = firstProtectedFolderPath(file.relativePath);
      const visibleFolderSource = protectedFolder && !protectedUnlocked ? `${protectedFolder}/__locked__` : file.relativePath;

      for (const folder of foldersFromPath(visibleFolderSource)) {
        folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
      }

      if (protectedFolder && !protectedUnlocked) continue;

      const categoryKeys = (categoryRowsByFileId.get(file.id) ?? []).length > 0
        ? categoryRowsByFileId.get(file.id)!
        : file.curationStatus !== "none"
          ? [file.curationStatus]
          : [];
      for (const categoryKey of categoryKeys) {
        curationCounts.set(categoryKey, (curationCounts.get(categoryKey) ?? 0) + 1);
      }

      if (file.extension) {
        extensionCounts.set(file.extension, (extensionCounts.get(file.extension) ?? 0) + 1);
      }

      for (const tag of tagsFromFilename(file.filename)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const folders = [...folderCounts.entries()]
      .map(([path, count]) => ({
        path,
        label: folderLabel(path),
        depth: folderDepth(path),
        count,
        locked: !protectedUnlocked && isProtectedPath(path)
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 300);

    const tags = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .filter((item) => item.count > 1)
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 100);

    const extensions = [...extensionCounts.entries()]
      .map(([extension, count]) => ({ extension, count }))
      .sort((a, b) => a.extension.localeCompare(b.extension));

    const categories = await prisma.curationCategory.findMany({
      orderBy: [{ builtIn: "desc" }, { label: "asc" }]
    });
    const curationStatuses = categories.map((category) => ({
      key: category.key,
      label: category.label,
      color: category.color,
      builtIn: category.builtIn,
      count: curationCounts.get(category.key) ?? 0
    }));

    return { folders, tags, extensions, curationStatuses, protectedUnlocked };
  });

  app.get("/api/files", { preHandler: requireWebAuth }, async (request) => {
    const query = filesQuerySchema.parse(request.query);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const diskIds = commaList(query.diskIds);
    const folders = commaList(query.folders);
    const selectedTags = commaList(query.tags);
    const where: Prisma.VideoFileWhereInput = {
      diskId: diskIds.length > 0 ? { in: diskIds } : query.diskId,
      extension: query.extension ? query.extension.toLowerCase() : undefined,
      sizeBytes: {
        gte: parseBigInt(query.minSize),
        lte: parseBigInt(query.maxSize)
      },
      durationSeconds: {
        gte: query.minDuration,
        lte: query.maxDuration
      },
      width: query.width,
      height: query.height,
      videoCodec: query.codec ? { contains: query.codec, mode: "insensitive" } : undefined
    };
    if (query.curationStatus) {
      const taggedIds = await categoryFileIds(query.curationStatus);
      where.OR = [
        { curationStatus: query.curationStatus },
        ...(taggedIds.length > 0 ? [{ id: { in: taggedIds } }] : [])
      ];
    }

    applyHiddenPathFilter(where);
    if (!protectedUnlocked) applyProtectedPathFilter(where);

    const queryTokens = query.q ? searchTokenVariants(query.q) : [];
    if (queryTokens.length > 0) {
      const searchFilters: Prisma.VideoFileWhereInput[] = queryTokens.map((variants) => ({
        OR: variants.flatMap<Prisma.VideoFileWhereInput>((token) => [
          { filename: { contains: token, mode: "insensitive" } },
          { relativePath: { contains: token, mode: "insensitive" } }
        ])
      }));

      where.AND = [
        ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as Prisma.VideoFileWhereInput[]),
        ...searchFilters
      ];
    }

    applyFolderFilter(where, folders);

    if (query.duplicateOnly) {
      const duplicateSizes = await prisma.videoFile.groupBy({
        by: ["sizeBytes"],
        where: duplicateEligibleWhere(),
        having: { sizeBytes: { _count: { gt: 1 } } }
      });
      applyProtectedPathFilter(where);
      where.sizeBytes = {
        ...(typeof where.sizeBytes === "object" ? where.sizeBytes : {}),
        in: duplicateSizes.map((group) => group.sizeBytes)
      };
    }

    const orderBy: Prisma.VideoFileOrderByWithRelationInput | Prisma.VideoFileOrderByWithRelationInput[] =
      query.duplicateOnly
        ? [{ sizeBytes: "asc" }, { filename: "asc" }]
        : { [query.sortBy]: query.sortDirection };
    const skip = (query.page - 1) * query.pageSize;

    let total: number;
    let files;

    if (selectedTags.length > 0) {
      const candidates = await prisma.videoFile.findMany({
        where,
        select: {
          id: true,
          filename: true
        },
        orderBy
      });
      const matchingIds = candidates
        .filter((file) => {
          const fileTags = tagsFromFilename(file.filename);
          return selectedTags.every((tag) => fileTags.includes(tag));
        })
        .map((file) => file.id);
      const pageIds = matchingIds.slice(skip, skip + query.pageSize);
      const filesById = await prisma.videoFile.findMany({
        where: { id: { in: pageIds } },
        include: fileIncludes()
      });

      const sortIndex = new Map(pageIds.map((id, index) => [id, index]));
      files = filesById.sort((a, b) => (sortIndex.get(a.id) ?? 0) - (sortIndex.get(b.id) ?? 0));
      total = matchingIds.length;
    } else {
      [total, files] = await Promise.all([
        prisma.videoFile.count({ where }),
        prisma.videoFile.findMany({
          where,
          include: fileIncludes(),
          orderBy,
          skip,
          take: query.pageSize
        })
      ]);
    }

    const sizes = [...new Set(files.map((file) => file.sizeBytes.toString()))].map((value) => BigInt(value));
    const duplicateGroups =
      sizes.length > 0
        ? await prisma.videoFile.groupBy({
            by: ["sizeBytes"],
            where: duplicateEligibleWhere({ sizeBytes: { in: sizes } }),
            _count: { _all: true }
          })
        : [];
    const duplicateCountBySize = new Map(duplicateGroups.map((group) => [group.sizeBytes.toString(), group._count._all]));
    const filesWithCategories = await attachCategoryKeys(files);

    return {
      files: filesWithCategories.map((file) =>
        serializeFile(file, isProtectedPath(file.relativePath) ? 0 : (duplicateCountBySize.get(file.sizeBytes.toString()) ?? 0))
      ),
      page: query.page,
      pageSize: query.pageSize,
      total
    };
  });

  app.get("/api/files/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const file = await prisma.videoFile.findUnique({
      where: { id },
      include: fileIncludes()
    });
    if (!file) return reply.code(404).send({ message: "File not found" });
    if (isHiddenSystemPath(file.relativePath)) return reply.code(404).send({ message: "File not found" });
    if (isProtectedPath(file.relativePath) && !protectedUnlocked) {
      return reply.code(403).send({ message: "PIN required" });
    }

    if (isProtectedPath(file.relativePath)) {
      const [fileWithCategories] = await attachCategoryKeys([file]);
      return {
        file: serializeFile(fileWithCategories, 0),
        duplicates: []
      };
    }

    const duplicateCount = await prisma.videoFile.count({
      where: duplicateEligibleWhere({ sizeBytes: file.sizeBytes })
    });
    const duplicates = await prisma.videoFile.findMany({
      where: duplicateEligibleWhere({ sizeBytes: file.sizeBytes, NOT: { id: file.id } }),
      include: fileIncludes(),
      take: 20,
      orderBy: { filename: "asc" }
    });
    const [fileWithCategories] = await attachCategoryKeys([file]);
    const duplicatesWithCategories = await attachCategoryKeys(duplicates);

    return {
      file: serializeFile(fileWithCategories, duplicateCount),
      duplicates: duplicatesWithCategories.map((duplicate) => serializeFile(duplicate, duplicateCount))
    };
  });

  app.delete("/api/files/:id/catalog", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = uuidParamsSchema.parse(request.params);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const file = await prisma.videoFile.findUnique({
      where: { id },
      include: { thumbnails: true }
    });
    if (!file) return reply.code(404).send({ message: "File not found" });
    if (isHiddenSystemPath(file.relativePath)) return reply.code(404).send({ message: "File not found" });
    if (isProtectedPath(file.relativePath) && !protectedUnlocked) {
      return reply.code(403).send({ message: "PIN required" });
    }

    await prisma.videoFile.delete({ where: { id } });

    const baseDir = path.resolve(env.THUMBNAILS_DIR);
    const removedThumbnails: string[] = [];
    const thumbnailWarnings: string[] = [];
    for (const thumbnail of file.thumbnails) {
      const filePath = path.resolve(baseDir, ...thumbnail.relativePath.split("/"));
      if (!filePath.startsWith(`${baseDir}${path.sep}`)) continue;
      try {
        await fs.rm(filePath, { force: true });
        removedThumbnails.push(thumbnail.relativePath);
      } catch (error) {
        thumbnailWarnings.push(error instanceof Error ? error.message : "Could not remove thumbnail");
      }
    }

    return {
      ok: true,
      removedThumbnails: removedThumbnails.length,
      thumbnailWarnings
    };
  });

  app.get("/api/folder-usage", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const diskIds = commaList(query.diskIds);
    const where: Prisma.VideoFileWhereInput = diskIds.length > 0 ? { diskId: { in: diskIds } } : {};
    applyHiddenPathFilter(where);
    if (!protectedUnlocked) applyProtectedPathFilter(where);

    const files = await prisma.videoFile.findMany({
      where,
      select: {
        diskId: true,
        relativePath: true,
        sizeBytes: true,
        folderSizeBytes: true,
        disk: { select: { name: true } }
      }
    });

    const folders = new Map<string, { diskId: string; diskName: string; folder: string; sizeBytes: number; fileCount: number; estimated: boolean }>();
    for (const file of files) {
      const parts = pathSegments(file.relativePath);
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      const key = `${file.diskId}:${folder}`;
      const existing = folders.get(key) ?? {
        diskId: file.diskId,
        diskName: file.disk.name,
        folder,
        sizeBytes: 0,
        fileCount: 0,
        estimated: true
      };
      existing.fileCount += 1;
      if (file.folderSizeBytes != null) {
        existing.sizeBytes = Math.max(existing.sizeBytes, Number(file.folderSizeBytes));
        existing.estimated = false;
      } else if (existing.estimated) {
        existing.sizeBytes += Number(file.sizeBytes);
      }
      folders.set(key, existing);
    }

    return {
      folders: [...folders.values()].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 120)
    };
  });

  app.get("/api/audit/errors", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const diskIds = commaList(query.diskIds);
    const where: Prisma.AgentErrorWhereInput = diskIds.length > 0 ? { diskId: { in: diskIds } } : {};
    const [summary, errors] = await Promise.all([
      prisma.agentError.groupBy({
        by: ["category", "phase"],
        where,
        _count: { _all: true },
        orderBy: { _count: { category: "desc" } },
        take: 50
      }),
      prisma.agentError.findMany({
        where,
        include: {
          disk: { select: { name: true } },
          scan: { select: { startedAt: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 300
      })
    ]);

    return {
      summary: summary.map((item) => ({
        category: item.category,
        phase: item.phase,
        count: item._count._all
      })),
      errors: errors.map((error) => ({
        id: error.id,
        diskName: error.disk.name,
        category: error.category,
        phase: error.phase,
        code: error.code,
        message: error.message,
        absolutePath: error.absolutePath,
        relativePath: error.relativePath,
        createdAt: error.createdAt,
        scanStartedAt: error.scan?.startedAt ?? null
      }))
    };
  });

  app.patch("/api/files/:id/curation", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ curationStatus: curationStatusSchema }).parse(request.body);
    if (body.curationStatus !== "none") {
      const category = await prisma.curationCategory.findUnique({ where: { key: body.curationStatus } });
      if (!category) return reply.code(400).send({ message: "Unknown category" });
    }
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const current = await prisma.videoFile.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ message: "File not found" });
    if (isHiddenSystemPath(current.relativePath)) return reply.code(404).send({ message: "File not found" });
    if (isProtectedPath(current.relativePath) && !protectedUnlocked) {
      return reply.code(403).send({ message: "PIN required" });
    }

    await prisma.videoFile.update({
      where: { id },
      data: { curationStatus: body.curationStatus }
    });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "VideoFile"
      SET "reviewedAt" = ${body.curationStatus === "keep" || body.curationStatus === "delete" ? new Date() : null}
      WHERE "id" = ${id}::uuid
    `);
    if (body.curationStatus !== "none") {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "VideoFileCategory" ("videoFileId", "categoryKey")
        VALUES (${id}::uuid, ${body.curationStatus})
        ON CONFLICT DO NOTHING
      `);
    }

    const file = await prisma.videoFile.findUniqueOrThrow({
      where: { id },
      include: fileIncludes()
    });
    const [fileWithCategories] = await attachCategoryKeys([file]);

    const duplicateCount = isProtectedPath(file.relativePath)
      ? 0
      : await prisma.videoFile.count({ where: duplicateEligibleWhere({ sizeBytes: file.sizeBytes }) });

    return { file: serializeFile(fileWithCategories, duplicateCount) };
  });

  app.patch("/api/files/batch/categories/:key", { preHandler: requireWebAuth }, async (request, reply) => {
    const { key } = z.object({ key: categoryKeySchema }).parse(request.params);
    const body = fileBatchCategorySchema.parse(request.body);
    const uniqueIds = [...new Set(body.fileIds)];
    const category = await prisma.curationCategory.findUnique({ where: { key } });
    if (!category) return reply.code(400).send({ message: "Unknown category" });

    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const currentFiles = await prisma.videoFile.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, relativePath: true, sizeBytes: true, curationStatus: true }
    });
    if (currentFiles.length !== uniqueIds.length) {
      return reply.code(404).send({ message: "One or more files were not found" });
    }
    if (currentFiles.some((file) => isHiddenSystemPath(file.relativePath))) {
      return reply.code(404).send({ message: "One or more files were not found" });
    }
    if (!protectedUnlocked && currentFiles.some((file) => isProtectedPath(file.relativePath))) {
      return reply.code(403).send({ message: "PIN required" });
    }

    const idSql = Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`));
    if (body.enabled) {
      if (key === "download") {
        await queueDownloadsForFileIds(uniqueIds, "manual");
      } else {
        await prisma.$transaction([
          prisma.$executeRaw(Prisma.sql`
            INSERT INTO "VideoFileCategory" ("videoFileId", "categoryKey")
            SELECT selected."id", ${key}
            FROM unnest(ARRAY[${idSql}]) AS selected("id")
            ON CONFLICT DO NOTHING
          `),
          ...(key === "keep" || key === "delete"
            ? [
                prisma.videoFile.updateMany({
                  where: { id: { in: uniqueIds } },
                  data: { curationStatus: key }
                }),
                prisma.$executeRaw(Prisma.sql`
                  UPDATE "VideoFile"
                  SET "reviewedAt" = ${new Date()}
                  WHERE "id" IN (${idSql})
                `)
              ]
            : [])
        ]);
      }
    } else {
      await prisma.$transaction([
        prisma.$executeRaw(Prisma.sql`
          DELETE FROM "VideoFileCategory"
          WHERE "videoFileId" IN (${idSql}) AND "categoryKey" = ${key}
        `),
        ...(key === "keep" || key === "delete"
          ? [
              prisma.videoFile.updateMany({
                where: { id: { in: uniqueIds }, curationStatus: key },
                data: { curationStatus: "none" }
              }),
              prisma.$executeRaw(Prisma.sql`
                UPDATE "VideoFile"
                SET "reviewedAt" = NULL
                WHERE "id" IN (${idSql}) AND "curationStatus" = 'none'
              `)
            ]
          : [])
      ]);
      if (key === "download") await removeQueuedDownloadsForFileIds(uniqueIds);
    }

    const files = await prisma.videoFile.findMany({
      where: { id: { in: uniqueIds } },
      include: fileIncludes()
    });
    const filesWithCategories = await attachCategoryKeys(files);
    const sizes = [...new Set(files.map((file) => file.sizeBytes.toString()))].map((value) => BigInt(value));
    const duplicateCounts = sizes.length
      ? await prisma.videoFile.groupBy({
          by: ["sizeBytes"],
          where: duplicateEligibleWhere({ sizeBytes: { in: sizes } }),
          _count: { _all: true }
        })
      : [];
    const duplicateCountBySize = new Map(duplicateCounts.map((item) => [item.sizeBytes.toString(), item._count._all]));

    return {
      files: filesWithCategories.map((file) =>
        serializeFile(file, isProtectedPath(file.relativePath) ? 0 : (duplicateCountBySize.get(file.sizeBytes.toString()) ?? 0))
      )
    };
  });

  app.patch("/api/files/:id/categories/:key", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id, key } = z.object({ id: z.string().uuid(), key: categoryKeySchema }).parse(request.params);
    const body = fileCategoryToggleSchema.parse(request.body);
    const category = await prisma.curationCategory.findUnique({ where: { key } });
    if (!category) return reply.code(400).send({ message: "Unknown category" });

    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const current = await prisma.videoFile.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ message: "File not found" });
    if (isHiddenSystemPath(current.relativePath)) return reply.code(404).send({ message: "File not found" });
    if (isProtectedPath(current.relativePath) && !protectedUnlocked) {
      return reply.code(403).send({ message: "PIN required" });
    }

    if (body.enabled) {
      if (key === "download") {
        await queueDownloadsForFileIds([id], "manual");
      } else {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO "VideoFileCategory" ("videoFileId", "categoryKey")
          VALUES (${id}::uuid, ${key})
          ON CONFLICT DO NOTHING
        `);
        if (key === "keep" || key === "delete") {
          await prisma.videoFile.update({ where: { id }, data: { curationStatus: key } });
          await prisma.$executeRaw(Prisma.sql`
            UPDATE "VideoFile"
            SET "reviewedAt" = ${new Date()}
            WHERE "id" = ${id}::uuid
          `);
        }
      }
    } else {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "VideoFileCategory"
        WHERE "videoFileId" = ${id}::uuid AND "categoryKey" = ${key}
      `);
      if (key === "download") await removeQueuedDownloadsForFileIds([id]);
      if (current.curationStatus === key) {
        await prisma.videoFile.update({ where: { id }, data: { curationStatus: "none" } });
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "VideoFile"
          SET "reviewedAt" = NULL
          WHERE "id" = ${id}::uuid
        `);
      }
    }

    const file = await prisma.videoFile.findUniqueOrThrow({
      where: { id },
      include: fileIncludes()
    });
    const [fileWithCategories] = await attachCategoryKeys([file]);
    const duplicateCount = isProtectedPath(file.relativePath)
      ? 0
      : await prisma.videoFile.count({ where: duplicateEligibleWhere({ sizeBytes: file.sizeBytes }) });

    return { file: serializeFile(fileWithCategories, duplicateCount) };
  });

  app.get("/api/review/summary", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const diskFilterRequested = query.diskIds !== undefined;
    const diskIds = commaList(query.diskIds);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const pendingWhere: Prisma.VideoFileWhereInput = {
      curationStatus: { notIn: ["keep", "delete"] }
    };
    if (diskFilterRequested) pendingWhere.diskId = { in: diskIds };
    applyHiddenPathFilter(pendingWhere);
    if (!protectedUnlocked) {
      applyProtectedPathFilter(pendingWhere);
    }

    const [pendingTotal, markedToday, markedLast7Days, freedBytes, pendingFiles, recentIds] = await Promise.all([
      prisma.videoFile.count({ where: pendingWhere }),
      countReviewedToday(protectedUnlocked, diskIds, diskFilterRequested),
      countReviewedLast7Days(protectedUnlocked, diskIds, diskFilterRequested),
      appMetricValue("review_freed_bytes"),
      prisma.videoFile.findMany({
        where: pendingWhere,
        include: fileIncludes(),
        orderBy: { updatedAt: "desc" },
        take: 24
      }),
      recentReviewedIds(protectedUnlocked, 24, diskIds, diskFilterRequested)
    ]);
    const recentOrder = new Map(recentIds.map((id, index) => [id, index]));
    const recentFiles = recentIds.length
      ? (await prisma.videoFile.findMany({
          where: { id: { in: recentIds } },
          include: fileIncludes()
        })).sort((a, b) => (recentOrder.get(a.id) ?? 0) - (recentOrder.get(b.id) ?? 0))
      : [];

    const [pendingWithCategories, recentWithCategories] = await Promise.all([
      attachCategoryKeys(pendingFiles),
      attachCategoryKeys(recentFiles)
    ]);

    return {
      pendingTotal,
      markedToday,
      markedLast7Days,
      freedBytes,
      pending: pendingWithCategories.map((file) => serializeFile(file, 0)),
      recent: recentWithCategories.map((file) => serializeFile(file, 0))
    };
  });

  app.get("/api/review/recoverable-space", { preHandler: requireWebAuth }, async (request) => {
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const rows = await prisma.$queryRaw<Array<{
      diskId: string;
      diskName: string;
      driveLetter: string | null;
      volumeLabel: string | null;
      totalBytes: bigint | null;
      fileCount: bigint;
      recoverableBytes: bigint;
    }>>(Prisma.sql`
      SELECT
        d."id"::text AS "diskId",
        d."name" AS "diskName",
        d."driveLetter" AS "driveLetter",
        d."volumeLabel" AS "volumeLabel",
        d."totalBytes" AS "totalBytes",
        COUNT(v."id")::bigint AS "fileCount",
        COALESCE(SUM(v."sizeBytes"), 0)::bigint AS "recoverableBytes"
      FROM "Disk" d
      INNER JOIN "VideoFile" v ON v."diskId" = d."id"
      WHERE v."curationStatus" = 'delete'
        AND NOT (
          v."relativePath" ILIKE '$RECYCLE.BIN'
          OR v."relativePath" ILIKE '$RECYCLE.BIN/%'
          OR v."relativePath" ILIKE '$RECYCLE.BIN\\%'
          OR v."relativePath" ILIKE 'System Volume Information'
          OR v."relativePath" ILIKE 'System Volume Information/%'
          OR v."relativePath" ILIKE 'System Volume Information\\%'
        )
        ${protectedPathSql(Prisma.sql`v."relativePath"`, protectedUnlocked)}
      GROUP BY d."id", d."name", d."driveLetter", d."volumeLabel", d."totalBytes"
      ORDER BY "recoverableBytes" DESC, "fileCount" DESC, d."name" ASC
    `);

    const disks = rows.map((row) => ({
      diskId: row.diskId,
      diskName: row.diskName,
      driveLetter: row.driveLetter,
      volumeLabel: row.volumeLabel,
      totalBytes: row.totalBytes == null ? null : Number(row.totalBytes),
      fileCount: Number(row.fileCount),
      recoverableBytes: Number(row.recoverableBytes)
    }));
    const totalRecoverableBytes = disks.reduce((sum, disk) => sum + disk.recoverableBytes, 0);

    return { totalRecoverableBytes, disks };
  });

  app.get("/api/review/recent", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const diskFilterRequested = query.diskIds !== undefined;
    const diskIds = commaList(query.diskIds);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const recentIds = await recentReviewedIds(protectedUnlocked, 24, diskIds, diskFilterRequested);
    const recentOrder = new Map(recentIds.map((id, index) => [id, index]));
    const files = recentIds.length
      ? (await prisma.videoFile.findMany({
          where: { id: { in: recentIds } },
          include: fileIncludes()
        })).sort((a, b) => (recentOrder.get(a.id) ?? 0) - (recentOrder.get(b.id) ?? 0))
      : [];

    const filesWithCategories = await attachCategoryKeys(files);
    return { files: filesWithCategories.map((file) => serializeFile(file, 0)) };
  });

  app.get("/api/review/next", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const diskFilterRequested = query.diskIds !== undefined;
    const diskIds = commaList(query.diskIds);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const where: Prisma.VideoFileWhereInput = {
      curationStatus: { notIn: ["keep", "delete"] }
    };
    if (diskFilterRequested) where.diskId = { in: diskIds };
    applyHiddenPathFilter(where);
    if (!protectedUnlocked) applyProtectedPathFilter(where);

    const total = await prisma.videoFile.count({ where });
    if (total === 0) return { file: null, remaining: 0 };

    const skip = Math.floor(Math.random() * total);
    const file = await prisma.videoFile.findFirst({
      where,
      include: fileIncludes(),
      orderBy: { id: "asc" },
      skip
    });

    return {
      file: file ? serializeFile((await attachCategoryKeys([file]))[0], 0) : null,
      remaining: total
    };
  });

  app.get("/api/downloads/summary", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const diskIds = commaList(query.diskIds);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const diskFilter = diskIds.length > 0
      ? Prisma.sql`AND v."diskId" IN (${Prisma.join(diskIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty;
    const visibleSql = Prisma.sql`
      AND NOT (
        v."relativePath" ILIKE '$RECYCLE.BIN'
        OR v."relativePath" ILIKE '$RECYCLE.BIN/%'
        OR v."relativePath" ILIKE '$RECYCLE.BIN\\%'
        OR v."relativePath" ILIKE 'System Volume Information'
        OR v."relativePath" ILIKE 'System Volume Information/%'
        OR v."relativePath" ILIKE 'System Volume Information\\%'
      )
      ${protectedPathSql(Prisma.sql`v."relativePath"`, protectedUnlocked)}
    `;
    const [pausedValue, statusCounts, totalRows, entries] = await Promise.all([
      appMetricValue("download_queue_paused"),
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
        SELECT dq."status", COUNT(*)::bigint AS "count"
        FROM "DownloadQueue" dq
        INNER JOIN "VideoFile" v ON v."id" = dq."videoFileId"
        WHERE TRUE
          ${diskFilter}
          ${visibleSql}
        GROUP BY dq."status"
        ORDER BY dq."status" ASC
      `),
      prisma.$queryRaw<Array<{ pendingBytes: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(v."sizeBytes"), 0)::bigint AS "pendingBytes"
        FROM "DownloadQueue" dq
        INNER JOIN "VideoFile" v ON v."id" = dq."videoFileId"
        WHERE dq."status" IN ('queued', 'downloading')
          ${diskFilter}
          ${visibleSql}
      `),
      prisma.$queryRaw<Array<{
        id: string;
        videoFileId: string;
        status: string;
        source: string;
        requestedAt: Date;
        startedAt: Date | null;
        completedAt: Date | null;
        destinationPath: string | null;
        downloadedTag: string | null;
        errorMessage: string | null;
        progressBytes: bigint;
        progressUpdatedAt: Date | null;
      }>>(Prisma.sql`
        SELECT
          dq."id"::text AS "id",
          dq."videoFileId"::text AS "videoFileId",
          dq."status",
          dq."source",
          dq."requestedAt",
          dq."startedAt",
          dq."completedAt",
          dq."destinationPath",
          dq."downloadedTag",
          dq."errorMessage",
          dq."progressBytes",
          dq."progressUpdatedAt"
        FROM "DownloadQueue" dq
        INNER JOIN "VideoFile" v ON v."id" = dq."videoFileId"
        WHERE TRUE
          ${diskFilter}
          ${visibleSql}
        ORDER BY
          CASE dq."status"
            WHEN 'downloading' THEN 1
            WHEN 'queued' THEN 2
            WHEN 'failed' THEN 3
            ELSE 4
          END,
          dq."requestedAt" DESC
        LIMIT 120
      `)
    ]);

    const fileIds = entries.map((entry) => entry.videoFileId);
    const files = fileIds.length
      ? await prisma.videoFile.findMany({
          where: { id: { in: fileIds } },
          include: fileIncludes()
        })
      : [];
    const filesWithCategories = await attachCategoryKeys(files);
    const filesById = new Map(filesWithCategories.map((file) => [file.id, file]));
    return {
      paused: pausedValue > 0,
      counts: Object.fromEntries(statusCounts.map((item) => [item.status, Number(item.count)])),
      pendingBytes: Number(totalRows[0]?.pendingBytes ?? 0n),
      entries: entries.flatMap((entry) => {
        const file = filesById.get(entry.videoFileId);
        if (!file) return [];
        return [{
          id: entry.id,
          status: entry.status,
          source: entry.source,
          requestedAt: entry.requestedAt,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          destinationPath: entry.destinationPath,
          downloadedTag: entry.downloadedTag,
          errorMessage: entry.errorMessage,
          progressBytes: Number(entry.progressBytes),
          progressUpdatedAt: entry.progressUpdatedAt,
          file: serializeFile({
            ...file,
            downloadQueue: entry
          }, 0)
        }];
      })
    };
  });

  app.patch("/api/downloads/pause", { preHandler: requireWebAuth }, async (request) => {
    const body = downloadPauseSchema.parse(request.body);
    await setAppMetricValue("download_queue_paused", body.paused ? 1n : 0n);
    return { ok: true, paused: body.paused };
  });

  app.delete("/api/downloads/queue", { preHandler: requireWebAuth }, async () => {
    const rows = await prisma.$queryRaw<Array<{ videoFileId: string }>>(Prisma.sql`
      SELECT "videoFileId"::text AS "videoFileId"
      FROM "DownloadQueue"
      WHERE "status" IN ('queued', 'failed')
    `);
    const ids = rows.map((row) => row.videoFileId);
    if (ids.length === 0) return { ok: true, cleared: 0 };

    const idSql = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    await prisma.$transaction([
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "VideoFileCategory"
        WHERE "videoFileId" IN (${idSql}) AND "categoryKey" = 'download'
      `),
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "DownloadQueue"
        WHERE "videoFileId" IN (${idSql}) AND "status" IN ('queued', 'failed')
      `)
    ]);

    return { ok: true, cleared: ids.length };
  });

  app.post("/api/downloads/queue/remove", { preHandler: requireWebAuth }, async (request) => {
    const body = downloadQueueRemoveSchema.parse(request.body);
    const uniqueIds = [...new Set(body.queueIds)];
    const idSql = Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await prisma.$queryRaw<Array<{ id: string; videoFileId: string }>>(Prisma.sql`
      SELECT "id"::text AS "id", "videoFileId"::text AS "videoFileId"
      FROM "DownloadQueue"
      WHERE "id" IN (${idSql}) AND "status" IN ('queued', 'failed')
    `);
    if (rows.length === 0) return { ok: true, removed: 0, skipped: uniqueIds.length };

    const removableQueueIds = Prisma.join(rows.map((row) => Prisma.sql`${row.id}::uuid`));
    const removableFileIds = Prisma.join(rows.map((row) => Prisma.sql`${row.videoFileId}::uuid`));
    await prisma.$transaction([
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "VideoFileCategory"
        WHERE "videoFileId" IN (${removableFileIds}) AND "categoryKey" = 'download'
      `),
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "DownloadQueue"
        WHERE "id" IN (${removableQueueIds}) AND "status" IN ('queued', 'failed')
      `)
    ]);

    return { ok: true, removed: rows.length, skipped: uniqueIds.length - rows.length };
  });

  app.post("/api/downloads/queue", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = downloadQueueSchema.parse(request.body);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const files = await prisma.videoFile.findMany({
      where: { id: { in: body.fileIds } },
      select: { id: true, relativePath: true }
    });
    if (files.length !== new Set(body.fileIds).size) return reply.code(404).send({ message: "One or more files were not found" });
    if (files.some((file) => isHiddenSystemPath(file.relativePath))) return reply.code(404).send({ message: "One or more files were not found" });
    if (!protectedUnlocked && files.some((file) => isProtectedPath(file.relativePath))) return reply.code(403).send({ message: "PIN required" });

    await queueDownloadsForFileIds(files.map((file) => file.id), "manual");
    return { ok: true, queued: files.length };
  });

  app.post("/api/downloads/random", { preHandler: requireWebAuth }, async (request) => {
    const body = randomDownloadSchema.parse(request.body);
    const protectedUnlocked = isProtectedFolderUnlocked(request);
    const targetBytes = BigInt(Math.ceil(body.targetGb * 1024 ** 3));
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      sizeBytes: bigint;
    }>>(Prisma.sql`
      SELECT v."id"::text AS "id", v."sizeBytes" AS "sizeBytes"
      FROM "VideoFile" v
      WHERE v."diskId" IN (${Prisma.join(body.diskIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND NOT EXISTS (
          SELECT 1
          FROM "VideoFileCategory" vc
          WHERE vc."videoFileId" = v."id"
            AND (vc."categoryKey" LIKE 'dl-%' OR vc."categoryKey" = 'download')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "DownloadQueue" dq
          WHERE dq."videoFileId" = v."id"
            AND dq."status" IN ('queued', 'downloading')
        )
        AND NOT (
          v."relativePath" ILIKE '$RECYCLE.BIN'
          OR v."relativePath" ILIKE '$RECYCLE.BIN/%'
          OR v."relativePath" ILIKE '$RECYCLE.BIN\\%'
          OR v."relativePath" ILIKE 'System Volume Information'
          OR v."relativePath" ILIKE 'System Volume Information/%'
          OR v."relativePath" ILIKE 'System Volume Information\\%'
        )
        ${protectedPathSql(Prisma.sql`v."relativePath"`, protectedUnlocked)}
      ORDER BY random()
      LIMIT 2000
    `);

    const selectedIds: string[] = [];
    let selectedBytes = 0n;
    for (const row of rows) {
      selectedIds.push(row.id);
      selectedBytes += row.sizeBytes;
      if (selectedBytes >= targetBytes) break;
    }
    if (selectedIds.length > 0) await queueDownloadsForFileIds(selectedIds, "random");

    const files = selectedIds.length > 0
      ? await prisma.videoFile.findMany({
          where: { id: { in: selectedIds } },
          include: fileIncludes()
        })
      : [];
    const order = new Map(selectedIds.map((id, index) => [id, index]));
    const filesWithCategories = await attachCategoryKeys(files.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));

    return {
      queued: selectedIds.length,
      queuedBytes: Number(selectedBytes),
      files: filesWithCategories.map((file) => serializeFile(file, 0))
    };
  });

  app.get("/api/duplicates/by-size", { preHandler: requireWebAuth }, async (request) => {
    const query = diskIdsQuerySchema.parse(request.query);
    const diskIds = commaList(query.diskIds);
    const where = duplicateEligibleWhere(diskIds.length > 0 ? { diskId: { in: diskIds } } : {});
    const groups = await prisma.videoFile.groupBy({
      by: ["sizeBytes"],
      where,
      _count: { _all: true },
      having: { sizeBytes: { _count: { gt: 1 } },
      },
      orderBy: { _count: { sizeBytes: "desc" } },
      take: 80
    });
    const sizes = groups.map((group) => group.sizeBytes);
    const files = sizes.length > 0
      ? await prisma.videoFile.findMany({
          where: duplicateEligibleWhere({
            ...(diskIds.length > 0 ? { diskId: { in: diskIds } } : {}),
            sizeBytes: { in: sizes }
          }),
          include: fileIncludes(),
          orderBy: [{ sizeBytes: "desc" }, { filename: "asc" }]
        })
      : [];
    const filesBySize = new Map<string, typeof files>();
    const filesWithCategories = await attachCategoryKeys(files);
    for (const file of filesWithCategories) {
      const key = file.sizeBytes.toString();
      filesBySize.set(key, [...(filesBySize.get(key) ?? []), file]);
    }

    return {
      groups: groups.map((group) => ({
        sizeBytes: Number(group.sizeBytes),
        count: group._count._all,
        files: (filesBySize.get(group.sizeBytes.toString()) ?? []).map((file) => serializeFile(file, group._count._all))
      }))
    };
  });

  app.get("/api/stats", { preHandler: requireWebAuth }, async (request) => {
    const visibleWhere: Prisma.VideoFileWhereInput = {};
    applyHiddenPathFilter(visibleWhere);
    if (!isProtectedFolderUnlocked(request)) applyProtectedPathFilter(visibleWhere);

    const [diskCount, fileCount, totalSize, duplicateGroups] = await Promise.all([
      prisma.disk.count(),
      prisma.videoFile.count({ where: visibleWhere }),
      prisma.videoFile.aggregate({ where: visibleWhere, _sum: { sizeBytes: true } }),
      prisma.videoFile.groupBy({
        by: ["sizeBytes"],
        where: duplicateEligibleWhere(),
        having: { sizeBytes: { _count: { gt: 1 } } }
      })
    ]);

    return {
      diskCount,
      fileCount,
      totalBytes: Number(totalSize._sum.sizeBytes ?? 0n),
      duplicateGroupCount: duplicateGroups.length
    };
  });

  app.get("/api/companion/status", { preHandler: requireWebAuth }, async () => {
    const [lastSeenAt, version, mountedDiskCount] = await Promise.all([
      appMetricValue("companion_last_seen_at"),
      appMetricValue("companion_version"),
      appMetricValue("companion_mounted_disk_count")
    ]);
    const now = Date.now();
    const staleAfterMs = 45000;
    const online = lastSeenAt > 0 && now - lastSeenAt <= staleAfterMs;

    return {
      online,
      lastSeenAt: lastSeenAt > 0 ? new Date(lastSeenAt).toISOString() : null,
      staleAfterMs,
      version,
      mountedDiskCount
    };
  });
}
