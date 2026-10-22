import type { MediaLog } from "@videocat/shared/media";
import { prisma } from "./prisma.js";
import { finalizeDeletion, recordDeletionFailure } from "./deletion-history.js";
import { locationOf } from "./bucket-scan.js";
import { deleteObject, headObject, listObjects, S3RequestError } from "./s3.js";

// Videos marked for deletion (Review › J) that live in S3 buckets, deleted by the scanner when
// "Procesar borrados" asks for it — never on its own: a deleted object cannot be recovered
// unless the bucket keeps versions. Like the Companion, it first checks the object is still the
// one catalogued (size and ETag); if it changed, it is kept and its mark removed.

export const bucketDeletionRequestKey = "s3_delete_process_requested_at";
export const bucketDeletionHandledKey = "s3_delete_process_handled_at";

export type BucketDeletionSummary = { deleted: number; missing: number; changed: number; failed: number };

function failureText(error: unknown): string {
  if (error instanceof S3RequestError) {
    if (error.failure.code === "access_denied") return "La credencial del bucket no tiene permiso para borrar objetos.";
    return `El bucket respondió con un error (${error.failure.code}).`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function keepChanged(fileId: string, reason: string): Promise<void> {
  await recordDeletionFailure(fileId, reason, {});
  await prisma.$transaction([
    prisma.videoFile.updateMany({ where: { id: fileId, curationStatus: "delete" }, data: { curationStatus: "none", reviewedAt: null } }),
    prisma.videoFileCategory.deleteMany({ where: { videoFileId: fileId, categoryKey: "delete" } })
  ]);
}

export async function processBucketDeletions(log: MediaLog): Promise<BucketDeletionSummary> {
  const summary: BucketDeletionSummary = { deleted: 0, missing: 0, changed: 0, failed: 0 };
  const buckets = await prisma.storageBucket.findMany({ where: { diskId: { not: null } } });
  for (const bucket of buckets) {
    const files = await prisma.videoFile.findMany({
      where: { diskId: bucket.diskId!, curationStatus: "delete" },
      select: { id: true, relativePath: true, sizeBytes: true, storageEtag: true },
      orderBy: { relativePath: "asc" }
    });
    if (files.length === 0) continue;
    const location = locationOf(bucket);
    // A missing object counts as already deleted: that is only safe once the bucket itself answers.
    try {
      await listObjects(location, { maxKeys: 1 });
    } catch (error) {
      log.warn(`Borrados del bucket «${bucket.name}» pospuestos: el bucket no responde (${failureText(error)}).`);
      continue;
    }
    log.info(`Bucket «${bucket.name}»: ${files.length} video(s) marcados para borrar.`);
    for (const file of files) {
      const key = `${bucket.prefix}${file.relativePath}`;
      try {
        const object = await headObject(location, key);
        if (!object) {
          await finalizeDeletion(file.id, "missing", {});
          summary.missing += 1;
          continue;
        }
        if (object.sizeBytes !== Number(file.sizeBytes) || (file.storageEtag && object.etag && object.etag !== file.storageEtag)) {
          await keepChanged(file.id, "El objeto cambió desde el último escaneo; no se borró y se le quitó la marca. Revísalo de nuevo después del próximo escaneo.");
          summary.changed += 1;
          continue;
        }
        await deleteObject(location, key);
        await finalizeDeletion(file.id, "deleted", {});
        summary.deleted += 1;
      } catch (error) {
        await recordDeletionFailure(file.id, failureText(error), {});
        summary.failed += 1;
      }
    }
  }
  return summary;
}
