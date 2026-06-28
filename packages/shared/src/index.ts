import { z } from "zod";

export const videoExtensions = [
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".mxf",
  ".mts",
  ".m2ts",
  ".webm",
  ".wmv",
  ".flv"
] as const;

export const fileScanStatusSchema = z.enum([
  "pending",
  "scanned",
  "metadata_failed",
  "thumbnail_failed",
  "failed"
]);

export type FileScanStatus = z.infer<typeof fileScanStatusSchema>;

export const registerDiskSchema = z.object({
  name: z.string().min(1),
  volumeLabel: z.string().optional().nullable(),
  volumeId: z.string().optional().nullable(),
  driveLetter: z.string().optional().nullable(),
  totalBytes: z.number().int().nonnegative().optional().nullable(),
  fileSystem: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const scanStartSchema = z.object({
  diskId: z.string().uuid(),
  rootPath: z.string().min(1)
});

export const ffprobeVideoMetadataSchema = z.object({
  durationSeconds: z.number().nonnegative().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  fps: z.number().nonnegative().nullable().optional(),
  videoCodec: z.string().nullable().optional(),
  audioCodec: z.string().nullable().optional(),
  audioChannels: z.number().int().nonnegative().nullable().optional(),
  bitrate: z.number().int().nonnegative().nullable().optional(),
  containerFormat: z.string().nullable().optional(),
  streamCount: z.number().int().nonnegative().nullable().optional(),
  raw: z.unknown().optional()
});

export const agentFileSchema = z.object({
  filename: z.string().min(1),
  extension: z.string().min(1),
  absolutePath: z.string().min(1),
  relativePath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  folderSizeBytes: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.string().datetime().nullable().optional(),
  modifiedAt: z.string().datetime().nullable().optional(),
  status: fileScanStatusSchema,
  errorMessage: z.string().nullable().optional(),
  metadata: ffprobeVideoMetadataSchema.nullable().optional()
});

export const filesBatchSchema = z.object({
  scanId: z.string().uuid(),
  diskId: z.string().uuid(),
  files: z.array(agentFileSchema).min(1).max(200)
});

export const agentErrorSchema = z.object({
  category: z.string().min(1).max(80),
  phase: z.string().min(1).max(40),
  code: z.string().max(80).nullable().optional(),
  message: z.string().min(1).max(4000),
  absolutePath: z.string().max(2000).nullable().optional(),
  relativePath: z.string().max(2000).nullable().optional()
});

export const agentErrorsBatchSchema = z.object({
  scanId: z.string().uuid(),
  diskId: z.string().uuid(),
  errors: z.array(agentErrorSchema).min(1).max(200)
});

export const thumbnailKindSchema = z.union([
  z.literal("main"),
  z.string().regex(/^frame_\d{2}$/)
]);

export const filesQuerySchema = z.object({
  q: z.string().max(200).optional(),
  diskId: z.string().uuid().optional(),
  diskIds: z.string().max(4000).optional(),
  extension: z.string().max(20).optional(),
  folders: z.string().max(4000).optional(),
  tags: z.string().max(2000).optional(),
  minSize: z.coerce.number().optional(),
  maxSize: z.coerce.number().optional(),
  minDuration: z.coerce.number().optional(),
  maxDuration: z.coerce.number().optional(),
  width: z.coerce.number().int().optional(),
  height: z.coerce.number().int().optional(),
  codec: z.string().optional(),
  duplicateOnly: z.coerce.boolean().optional(),
  curationStatus: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  sortBy: z.enum(["filename", "sizeBytes", "durationSeconds", "modifiedAt", "createdAt"]).default("modifiedAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc")
});

export type RegisterDiskInput = z.infer<typeof registerDiskSchema>;
export type ScanStartInput = z.infer<typeof scanStartSchema>;
export type AgentFileInput = z.infer<typeof agentFileSchema>;
export type FilesBatchInput = z.infer<typeof filesBatchSchema>;
export type AgentErrorInput = z.infer<typeof agentErrorSchema>;
export type AgentErrorsBatchInput = z.infer<typeof agentErrorsBatchSchema>;
export type FilesQueryInput = z.infer<typeof filesQuerySchema>;

export function isVideoExtension(extension: string): boolean {
  return videoExtensions.includes(extension.toLowerCase() as (typeof videoExtensions)[number]);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "-";
  const rounded = Math.round(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ignoredTagTokens = new Set([
  "video",
  "videos",
  "movie",
  "clip",
  "final",
  "copy",
  "copia",
  "backup",
  "edit",
  "edited",
  "export",
  "render",
  "sequence",
  "secuencia",
  "untitled",
  "sin",
  "titulo"
]);

export function tagsFromFilename(filename: string): string[] {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  const tags = normalized
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^\d{4}p$/.test(token))
    .filter((token) => !ignoredTagTokens.has(token));

  return [...new Set(tags)].slice(0, 12);
}
