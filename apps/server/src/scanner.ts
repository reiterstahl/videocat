import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// videocat-scanner: the server's own scanner of S3 buckets, in its own container because it
// needs ffmpeg (docker compose --profile s3). It shares the server's code and database, serves
// no HTTP, and never signs sessions or talks to Companions (see lib/env.ts).
process.env.VIDEOCAT_ROLE = "scanner";

const { prisma } = await import("./lib/prisma.js");
const { storageKeyState } = await import("./lib/secret-box.js");
const { scanBucket, scanFailureOf, scannerStatusKey } = await import("./lib/bucket-scan.js");
const { bucketDeletionHandledKey, bucketDeletionRequestKey, processBucketDeletions } = await import("./lib/bucket-deletions.js");
const { Prisma } = await import("@prisma/client");

const execFileAsync = promisify(execFile);
const pollMs = 10_000;
// A running scan whose scanner stopped answering this long ago is taken over.
const staleRunMs = 5 * 60 * 1000;
const intervalHours = Math.max(1, Number(process.env.S3_SCAN_INTERVAL_HOURS ?? 24) || 24);
const concurrency = Math.min(8, Math.max(1, Number(process.env.S3_SCAN_CONCURRENCY ?? 2) || 2));
const workDir = process.env.S3_SCAN_WORK_DIR ?? path.join(os.tmpdir(), "videocat-scanner");
const tools = { ffmpeg: process.env.FFMPEG_PATH ?? "ffmpeg", ffprobe: process.env.FFPROBE_PATH ?? "ffprobe" };

const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`Señal ${signal}: el escáner termina el archivo en curso y se detiene.`);
    stop.abort();
  });
}

async function ffmpegVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(tools.ffmpeg, ["-version"], { timeout: 10_000 });
    return stdout.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

// What Administración shows: whether the scanner runs and can read videos.
async function heartbeat(ffmpeg: string | null): Promise<void> {
  const value = JSON.stringify({ seenAt: new Date().toISOString(), ffmpeg, keyState: storageKeyState(), intervalHours });
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${scannerStatusKey}, ${value}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP
  `);
}

async function metric(key: string): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ valueBigInt: bigint }>>(Prisma.sql`SELECT "valueBigInt" FROM "AppMetric" WHERE "key" = ${key} LIMIT 1`);
  return rows[0]?.valueBigInt ?? 0n;
}

// "Procesar borrados" in Review asked for it since the last time: delete the marked videos of
// every bucket, then remember which request was handled.
async function deletionsIfAsked(): Promise<boolean> {
  const [requested, handled] = await Promise.all([metric(bucketDeletionRequestKey), metric(bucketDeletionHandledKey)]);
  if (requested <= handled) return false;
  const summary = await processBucketDeletions({ info: (message) => console.log(message), warn: (message) => console.warn(message) });
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppMetric" ("key", "valueBigInt", "updatedAt") VALUES (${bucketDeletionHandledKey}, ${requested}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET "valueBigInt" = EXCLUDED."valueBigInt", "updatedAt" = CURRENT_TIMESTAMP
  `);
  console.log(`Borrados en buckets: ${summary.deleted} borrados, ${summary.missing} ya no estaban, ${summary.changed} cambiaron (se conservan), ${summary.failed} con error.`);
  return true;
}

// Asked from the web, never scanned, due by the interval, or left running by a scanner that died.
async function nextBucket() {
  const now = Date.now();
  const buckets = await prisma.storageBucket.findMany({ orderBy: [{ scanRequestedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] });
  return buckets.find((bucket) => {
    if (bucket.scanStatus === "running") return !bucket.scanHeartbeatAt || now - bucket.scanHeartbeatAt.getTime() > staleRunMs;
    if (bucket.scanRequestedAt) return true;
    if (!bucket.scanFinishedAt) return bucket.lastCheckOk === true;
    return now - bucket.scanFinishedAt.getTime() > intervalHours * 60 * 60 * 1000;
  }) ?? null;
}

async function runOne(): Promise<boolean> {
  const bucket = await nextBucket();
  if (!bucket) return false;
  console.log(`Escaneando el bucket «${bucket.name}» (${bucket.bucket}/${bucket.prefix}).`);
  await prisma.storageBucket.update({
    where: { id: bucket.id },
    data: { scanStatus: "running", scanStartedAt: new Date(), scanHeartbeatAt: new Date(), scanRequestedAt: null, scanFailure: Prisma.DbNull }
  });
  try {
    const summary = await scanBucket(bucket.id, {
      tools,
      workDir,
      concurrency,
      signal: stop.signal,
      log: { info: (message) => console.log(message), warn: (message) => console.warn(message) }
    });
    await prisma.storageBucket.update({
      where: { id: bucket.id },
      data: {
        scanStatus: "idle",
        scanFinishedAt: new Date(),
        scanProgress: { ...summary, phase: "done" },
        ...(stop.signal.aborted ? { scanFailure: { code: "interrupted" }, scanRequestedAt: new Date() } : {})
      }
    });
    console.log(`Bucket «${bucket.name}»: ${summary.listed} videos, ${summary.processed} procesados (${summary.failed} con error), ${summary.relocated} movidos, ${summary.unchanged} sin cambios, ${summary.markedAbsent} ausentes.`);
  } catch (error) {
    console.error(`Falló el escaneo del bucket «${bucket.name}»:`, error instanceof Error ? error.message : error);
    await prisma.storageBucket.update({
      where: { id: bucket.id },
      data: { scanStatus: "failed", scanFinishedAt: new Date(), scanFailure: scanFailureOf(error) }
    });
  }
  return true;
}

const ffmpeg = await ffmpegVersion();
console.log(`VideoCAT scanner: ${ffmpeg ?? "ffmpeg NO disponible"}; cada ${intervalHours} h; ${concurrency} a la vez.`);
if (storageKeyState() !== "ready") console.warn("STORAGE_SECRET_KEY falta o no es válida: no se pueden abrir las credenciales de los buckets.");

while (!stop.signal.aborted) {
  await heartbeat(ffmpeg).catch((error) => console.error("No se pudo registrar el estado del escáner:", error));
  const ready = storageKeyState() === "ready";
  const deleted = ready ? await deletionsIfAsked().catch((error) => {
    console.error("Error borrando en buckets:", error);
    return false;
  }) : false;
  const worked = ffmpeg && ready ? await runOne().catch((error) => {
    console.error("Error del escáner:", error);
    return false;
  }) : false;
  if (!worked && !deleted && !stop.signal.aborted) await new Promise((resolve) => setTimeout(resolve, pollMs));
}
await prisma.$disconnect();
