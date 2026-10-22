import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type StorageBucket } from "@prisma/client";
import { agentFileSchema, isVideoExtension, type AgentFileInput } from "@videocat/shared";
import { analyzeMedia, type MediaLog, type MediaTools } from "@videocat/shared/media";
import { prisma } from "./prisma.js";
import { openSecret } from "./secret-box.js";
import { listAllObjects, presignedGetUrl, S3RequestError, scrubSignedUrls, type S3Location, type S3Object } from "./s3.js";
import { finishScan, markSeen, relocateFiles, renewScanLease, startScan, storeThumbnail, writeScannedFiles } from "./catalog-scan.js";

// One scan of an S3 bucket by the server's scanner (src/scanner.ts), written to the catalog the
// same way a Companion writes a drive: unchanged objects are only marked as seen, objects copied
// to another key keep their entry, new or changed ones are read with ffprobe/ffmpeg through a
// signed URL (by ranges, never downloaded whole), and what vanished is marked absent at the end.

export const scannerLeaseOwner = "s3-scanner";
// AppSetting the scanner refreshes every few seconds: { seenAt, ffmpeg, keyState, intervalHours }.
export const scannerStatusKey = "s3_scanner_status";

export type BucketScanProgress = {
  phase: "listing" | "processing" | "finishing";
  listed: number;
  toProcess: number;
  processed: number;
  failed: number;
  relocated: number;
  current: string | null;
};

export type BucketScanSummary = {
  listed: number;
  unchanged: number;
  processed: number;
  failed: number;
  relocated: number;
  markedAbsent: number;
};

export function locationOf(bucket: StorageBucket): S3Location {
  return { ...bucket, secretAccessKey: openSecret(bucket.secretSealed, bucket.id) };
}

// The catalog path of an object: its key inside the bucket's prefix.
export function relativeKey(key: string, prefix: string): string {
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function isCatalogObject(object: S3Object, prefix: string): boolean {
  const relative = relativeKey(object.key, prefix);
  return relative.length > 0 && !relative.endsWith("/") && isVideoExtension(path.posix.extname(relative));
}

type CatalogRow = { id: string; relativePath: string; sizeBytes: bigint; modifiedAt: Date | null; storageEtag: string | null };

function unchanged(row: CatalogRow, object: S3Object): boolean {
  if (row.sizeBytes !== BigInt(object.sizeBytes)) return false;
  if (row.storageEtag && object.etag) return row.storageEtag === object.etag;
  return row.modifiedAt?.getTime() === object.lastModified?.getTime();
}

// S3 has no rename: a key renamed or a folder moved is a copy to a new key (new date) and a
// delete. The same ETag and size on a key that vanished is that object; with several such keys,
// only the one with the same file name counts. Anything else is read as a new video.
export function findMoves(objects: S3Object[], rows: CatalogRow[], prefix: string): Map<string, CatalogRow> {
  const listed = new Set(objects.map((object) => relativeKey(object.key, prefix)));
  const vanished = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    if (listed.has(row.relativePath) || !row.storageEtag) continue;
    const key = `${row.storageEtag}:${row.sizeBytes}`;
    vanished.set(key, [...(vanished.get(key) ?? []), row]);
  }
  const catalogued = new Set(rows.map((row) => row.relativePath));
  const moves = new Map<string, CatalogRow>();
  const claimed = new Set<string>();
  for (const object of objects) {
    const to = relativeKey(object.key, prefix);
    if (!object.etag || catalogued.has(to)) continue;
    const candidates = (vanished.get(`${object.etag}:${object.sizeBytes}`) ?? []).filter((row) => !claimed.has(row.id));
    const name = path.posix.basename(to);
    const sameName = candidates.filter((row) => path.posix.basename(row.relativePath) === name);
    const source = candidates.length === 1 ? candidates[0] : sameName.length === 1 ? sameName[0] : null;
    if (!source) continue;
    claimed.add(source.id);
    moves.set(to, source);
  }
  return moves;
}

async function ensureDisk(bucket: StorageBucket): Promise<string> {
  if (bucket.diskId) return bucket.diskId;
  return prisma.$transaction(async (tx) => {
    const disk = await tx.disk.create({
      data: { name: bucket.name, nameLocked: true, kind: "s3", volumeId: `s3:${bucket.id}`, fileSystem: "S3" }
    });
    await tx.storageBucket.update({ where: { id: bucket.id }, data: { diskId: disk.id } });
    return disk.id;
  });
}

export async function scanBucket(
  bucketId: string,
  options: { tools: MediaTools; workDir: string; concurrency: number; signal?: AbortSignal; log: MediaLog }
): Promise<BucketScanSummary> {
  const bucket = await prisma.storageBucket.findUniqueOrThrow({ where: { id: bucketId } });
  const location = locationOf(bucket);
  const diskId = await ensureDisk(bucket);
  const progress: BucketScanProgress = { phase: "listing", listed: 0, toProcess: 0, processed: 0, failed: 0, relocated: 0, current: null };
  let lastWrite = 0;
  const report = async (force = false) => {
    if (!force && Date.now() - lastWrite < 1500) return;
    lastWrite = Date.now();
    await prisma.storageBucket.update({
      where: { id: bucketId },
      data: { scanProgress: progress as unknown as Prisma.InputJsonValue, scanHeartbeatAt: new Date() }
    });
  };

  const scan = await startScan(diskId, ".", scannerLeaseOwner);
  const scanDir = path.join(options.workDir, scan.id);
  try {
    const objects = (await listAllObjects(location, (listed) => {
      progress.listed = listed;
      void report();
    })).filter((object) => isCatalogObject(object, bucket.prefix));
    progress.listed = objects.length;

    const rows = await prisma.videoFile.findMany({
      where: { diskId },
      select: { id: true, relativePath: true, sizeBytes: true, modifiedAt: true, storageEtag: true }
    });
    const byPath = new Map(rows.map((row) => [row.relativePath, row]));
    const moves = findMoves(objects, rows, bucket.prefix);
    const seenPaths: string[] = [];
    const pending: S3Object[] = [];
    for (const object of objects) {
      const relative = relativeKey(object.key, bucket.prefix);
      const row = byPath.get(relative);
      if (row && unchanged(row, object)) seenPaths.push(relative);
      else if (!row && moves.has(relative)) continue;
      else pending.push(object);
    }
    for (let index = 0; index < seenPaths.length; index += 500) {
      await markSeen(scan.id, diskId, seenPaths.slice(index, index + 500));
    }

    // The entry keeps its identity: relocateFiles checks the date it knows, then the object's
    // own date and ETag are written (a copied object has a new date).
    if (moves.size > 0) {
      const objectsByPath = new Map(objects.map((object) => [relativeKey(object.key, bucket.prefix), object]));
      const result = await relocateFiles(scan, [...moves].map(([to, row]) => ({
        from: row.relativePath,
        to,
        absolutePath: `s3://${bucket.bucket}/${objectsByPath.get(to)!.key}`,
        sizeBytes: Number(row.sizeBytes),
        modifiedAt: (row.modifiedAt ?? new Date(0)).toISOString(),
        folderSizeBytes: null
      })), "system");
      for (const to of result.relocated) {
        const object = objectsByPath.get(to)!;
        await prisma.videoFile.update({
          where: { diskId_relativePath: { diskId, relativePath: to } },
          data: { modifiedAt: object.lastModified, storageEtag: object.etag }
        });
      }
      progress.relocated = result.relocated.length;
      const rejected = new Set(result.rejected.map((item) => item.to));
      pending.push(...objects.filter((object) => rejected.has(relativeKey(object.key, bucket.prefix))));
    }

    progress.phase = "processing";
    progress.toProcess = pending.length;
    await report(true);

    const scanObject = async (object: S3Object, relative: string): Promise<boolean> => {
      const safeName = `s3://${bucket.bucket}/${object.key}`;
      const stem = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 16);
      const url = await presignedGetUrl(location, object.key);
      const analyzed = await analyzeMedia(url, {
        tools: options.tools,
        label: relative,
        createThumbnails: true,
        createFingerprint: true,
        thumbnailPath: (kind) => path.join(scanDir, `${stem}-${kind}.jpg`),
        rawPath: (kind) => path.join(scanDir, `${stem}-${kind}.gray`),
        signal: options.signal,
        log: {
          info: (message) => options.log.info(scrubSignedUrls(message, url, safeName)),
          warn: (message) => options.log.warn(scrubSignedUrls(message, url, safeName))
        }
      });
      const record: AgentFileInput = agentFileSchema.parse({
        filename: path.posix.basename(relative),
        extension: path.posix.extname(relative).toLowerCase(),
        absolutePath: safeName,
        relativePath: relative,
        sizeBytes: object.sizeBytes,
        folderSizeBytes: null,
        createdAt: null,
        modifiedAt: object.lastModified?.toISOString() ?? null,
        status: analyzed.status,
        // ffmpeg names its input in errors: the signature never reaches the catalog.
        errorMessage: analyzed.errorMessage ? scrubSignedUrls(analyzed.errorMessage, url, safeName) : null,
        visualFingerprint: analyzed.visualFingerprint,
        fingerprintVersion: analyzed.fingerprintVersion,
        metadata: analyzed.metadata
      });
      await writeScannedFiles(diskId, scan.id, [record], true);
      await prisma.videoFile.update({
        where: { diskId_relativePath: { diskId, relativePath: relative } },
        data: { storageEtag: object.etag }
      });
      for (const thumbnail of analyzed.thumbnails) {
        await storeThumbnail({ diskId, relativePath: relative, kind: thumbnail.kind, timestampSeconds: thumbnail.timestampSeconds, image: await fs.readFile(thumbnail.filePath) });
        await fs.rm(thumbnail.filePath, { force: true });
      }
      return analyzed.status !== "scanned";
    };

    const queue = [...pending];
    const worker = async () => {
      for (let object = queue.shift(); object && !options.signal?.aborted; object = queue.shift()) {
        if (!await renewScanLease(scan.id, diskId)) throw Object.assign(new Error("Scan lease expired"), { statusCode: 409 });
        const relative = relativeKey(object.key, bucket.prefix);
        progress.current = relative;
        await report();
        const failed = await scanObject(object, relative);
        progress.processed += 1;
        if (failed) progress.failed += 1;
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, () => worker()));
    progress.current = null;

    // Stopped halfway: what was not read yet is not missing, so nothing is reconciled.
    const complete = !options.signal?.aborted;
    progress.phase = "finishing";
    await report(true);
    const current = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    const finished = await finishScan(current, { reconcile: complete, scanRoots: ["."], actorType: "system" });
    return {
      listed: objects.length,
      unchanged: seenPaths.length,
      processed: progress.processed,
      failed: progress.failed,
      relocated: progress.relocated,
      markedAbsent: finished.reconciliation.markedAbsent
    };
  } catch (error) {
    await prisma.scan.updateMany({
      where: { id: scan.id, status: "running" },
      data: { status: "failed", finishedAt: new Date(), leaseExpiresAt: null }
    });
    throw error;
  } finally {
    await fs.rm(scanDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function scanFailureOf(error: unknown): Prisma.InputJsonValue {
  if (error instanceof S3RequestError) return error.failure as unknown as Prisma.InputJsonValue;
  return { code: "scan_error", detail: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
}
