import type { Disk, Thumbnail, VideoFile } from "@prisma/client";
import { tagsFromFilename } from "@videocat/shared";
import { env } from "./env.js";

export function toNumber(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  return Number(value);
}

export function thumbnailUrl(relativePath: string): string {
  return `${env.PUBLIC_THUMBNAILS_BASE_URL}/${relativePath.replace(/^\/+/, "")}`;
}

export function serializeDisk(disk: Disk) {
  return {
    ...disk,
    totalBytes: toNumber(disk.totalBytes),
    freeBytes: toNumber(disk.freeBytes)
  };
}

export function serializeThumbnail(thumbnail: Thumbnail) {
  return {
    ...thumbnail,
    url: `${thumbnailUrl(thumbnail.relativePath)}?v=${thumbnail.createdAt.getTime()}`
  };
}

export function serializeFile(
  file: VideoFile & {
    disk?: Disk;
    thumbnails?: Thumbnail[];
    categoryKeys?: string[];
    downloadQueue?: {
      status: string;
      requestedAt: Date;
      completedAt: Date | null;
      destinationPath: string | null;
      downloadedTag: string | null;
    } | null;
    transferItems?: Array<{ state: string; targetDiskId: string; targetFolder: string }>;
  },
  duplicateCount = 0
) {
  const { downloadQueue, transferItems, ...publicFile } = file;
  const transfer = transferItems?.[0];
  const categoryKeys = file.categoryKeys ??
    (file.curationStatus !== "none" ? [file.curationStatus] : []);
  return {
    ...publicFile,
    sizeBytes: toNumber(file.sizeBytes) ?? 0,
    folderSizeBytes: toNumber(file.folderSizeBytes),
    bitrate: toNumber(file.bitrate),
    disk: file.disk ? serializeDisk(file.disk) : undefined,
    thumbnails: file.thumbnails?.map(serializeThumbnail) ?? [],
    tags: tagsFromFilename(file.filename),
    categoryKeys,
    downloadStatus: downloadQueue?.status ?? null,
    downloadRequestedAt: downloadQueue?.requestedAt ?? null,
    downloadCompletedAt: downloadQueue?.completedAt ?? null,
    downloadDestinationPath: downloadQueue?.destinationPath ?? null,
    downloadedTag: downloadQueue?.downloadedTag ?? null,
    lastIndexedAt: file.updatedAt,
    duplicateCount,
    isProbableDuplicate: duplicateCount > 1,
    transfer: transfer ? { state: transfer.state, targetDiskId: transfer.targetDiskId, targetFolder: transfer.targetFolder } : null
  };
}
