import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

export type DeletionOutcome = "deleted" | "missing";

type DeletionOptions = {
  companionId?: string | null;
  source?: "review" | "manual";
};

function deletionSnapshot(file: {
  id: string;
  diskId: string;
  filename: string;
  relativePath: string;
  sizeBytes: bigint;
  reviewedAt: Date | null;
  updatedAt: Date;
  disk: { name: string };
}) {
  return {
    videoFileId: file.id,
    diskId: file.diskId,
    diskName: file.disk.name,
    filename: file.filename,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    requestedAt: file.reviewedAt ?? file.updatedAt
  };
}

async function removeThumbnailFiles(thumbnails: Array<{ relativePath: string }>): Promise<{
  removedThumbnails: number;
  thumbnailWarnings: string[];
}> {
  const baseDir = path.resolve(env.THUMBNAILS_DIR);
  let removedThumbnails = 0;
  const thumbnailWarnings: string[] = [];

  for (const thumbnail of thumbnails) {
    const thumbnailPath = path.resolve(baseDir, ...thumbnail.relativePath.split("/"));
    if (!thumbnailPath.startsWith(`${baseDir}${path.sep}`)) continue;
    try {
      await fs.rm(thumbnailPath, { force: true });
      removedThumbnails += 1;
    } catch (error) {
      thumbnailWarnings.push(error instanceof Error ? error.message : "Could not remove thumbnail");
    }
  }

  return { removedThumbnails, thumbnailWarnings };
}

export async function recordDeletionFailure(
  videoFileId: string,
  errorMessage: string,
  options: DeletionOptions = {}
): Promise<boolean> {
  const file = await prisma.videoFile.findUnique({
    where: { id: videoFileId },
    include: { disk: { select: { name: true } } }
  });
  if (!file) return false;

  const snapshot = deletionSnapshot(file);
  const attemptedAt = new Date();
  await prisma.deletionRecord.upsert({
    where: { videoFileId },
    create: {
      ...snapshot,
      status: "failed",
      source: options.source ?? "review",
      attemptedAt,
      errorMessage: errorMessage.slice(0, 4000),
      companionId: options.companionId ?? null
    },
    update: {
      ...snapshot,
      status: "failed",
      source: options.source ?? "review",
      attemptedAt,
      completedAt: null,
      errorMessage: errorMessage.slice(0, 4000),
      companionId: options.companionId ?? null
    }
  });
  return true;
}

export async function finalizeDeletion(
  videoFileId: string,
  outcome: DeletionOutcome,
  options: DeletionOptions = {}
): Promise<null | { removedThumbnails: number; thumbnailWarnings: string[] }> {
  const file = await prisma.videoFile.findUnique({
    where: { id: videoFileId },
    include: {
      disk: { select: { name: true } },
      thumbnails: { select: { relativePath: true } }
    }
  });
  if (!file) return null;

  const snapshot = deletionSnapshot(file);
  const completedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.deletionRecord.upsert({
      where: { videoFileId },
      create: {
        ...snapshot,
        status: outcome,
        source: options.source ?? "review",
        attemptedAt: completedAt,
        completedAt,
        errorMessage: null,
        companionId: options.companionId ?? null
      },
      update: {
        ...snapshot,
        status: outcome,
        source: options.source ?? "review",
        attemptedAt: completedAt,
        completedAt,
        errorMessage: null,
        companionId: options.companionId ?? null
      }
    });
    await tx.videoFile.delete({ where: { id: videoFileId } });

    if (outcome === "deleted" && file.curationStatus === "delete" && file.sizeBytes > 0n) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "AppMetric" ("key", "valueBigInt", "updatedAt")
        VALUES ('review_freed_bytes', ${file.sizeBytes}, CURRENT_TIMESTAMP)
        ON CONFLICT ("key") DO UPDATE
        SET "valueBigInt" = "AppMetric"."valueBigInt" + EXCLUDED."valueBigInt",
            "updatedAt" = CURRENT_TIMESTAMP
      `);
    }
  });

  return removeThumbnailFiles(file.thumbnails);
}
