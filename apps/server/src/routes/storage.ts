import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, type StorageBucket } from "@prisma/client";
import { z } from "zod";
import { requireWebAuth } from "../lib/auth.js";
import { recordAction } from "../lib/action-audit.js";
import { prisma } from "../lib/prisma.js";
import { openSecret, sealSecret, secretHint, storageKeyState, storageSecretKey } from "../lib/secret-box.js";
import { checkS3Location, normalizePrefix, type S3CheckResult, type S3Location } from "../lib/s3.js";
import { scannerStatusKey } from "../lib/bucket-scan.js";

// Administración › Almacenamiento S3: buckets the server will catalogue like drives. The secret
// key goes in sealed and never comes back out; the web only sees its last characters.

const endpointSchema = z.string().trim().max(300).transform((value, context) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      throw new Error();
    }
    return url.origin;
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The endpoint must be an http:// or https:// address without a path" });
    return z.NEVER;
  }
});

const bucketFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  endpoint: endpointSchema.default(""),
  region: z.string().trim().regex(/^[a-zA-Z0-9-]{1,64}$/).default("us-east-1"),
  bucket: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/),
  prefix: z.string().max(1000).default("").transform(normalizePrefix),
  forcePathStyle: z.boolean().default(true),
  accessKeyId: z.string().trim().min(1).max(256),
  // Empty when editing keeps the saved secret.
  secretAccessKey: z.string().max(512).default("")
});

const checkBodySchema = bucketFieldsSchema.extend({ bucketId: z.string().uuid().optional() });
const idParamsSchema = z.object({ id: z.string().uuid() });

const notConfigured = "STORAGE_SECRET_KEY is not configured";

function serializeBucket(bucket: StorageBucket) {
  return {
    id: bucket.id,
    name: bucket.name,
    endpoint: bucket.endpoint,
    region: bucket.region,
    bucket: bucket.bucket,
    prefix: bucket.prefix,
    forcePathStyle: bucket.forcePathStyle,
    accessKeyId: bucket.accessKeyId,
    secretHint: bucket.secretHint,
    diskId: bucket.diskId,
    lastCheckedAt: bucket.lastCheckedAt?.toISOString() ?? null,
    lastCheckOk: bucket.lastCheckOk,
    lastCheckFailure: bucket.lastCheckFailure,
    scanStatus: bucket.scanStatus,
    scanRequestedAt: bucket.scanRequestedAt?.toISOString() ?? null,
    scanStartedAt: bucket.scanStartedAt?.toISOString() ?? null,
    scanFinishedAt: bucket.scanFinishedAt?.toISOString() ?? null,
    scanHeartbeatAt: bucket.scanHeartbeatAt?.toISOString() ?? null,
    scanProgress: bucket.scanProgress,
    scanFailure: bucket.scanFailure,
    createdAt: bucket.createdAt.toISOString()
  };
}

// The scanner container is optional: the web says whether it runs and what it is missing.
const scannerOnlineMs = 60_000;
async function scannerStatus() {
  const setting = await prisma.appSetting.findUnique({ where: { key: scannerStatusKey } });
  if (!setting) return { installed: false, online: false, seenAt: null, ffmpeg: null, intervalHours: null };
  try {
    const value = JSON.parse(setting.value) as { seenAt?: string; ffmpeg?: string | null; intervalHours?: number };
    const seenAt = value.seenAt ?? null;
    return {
      installed: true,
      online: Boolean(seenAt && Date.now() - new Date(seenAt).getTime() <= scannerOnlineMs),
      seenAt,
      ffmpeg: value.ffmpeg ?? null,
      intervalHours: value.intervalHours ?? null
    };
  } catch {
    return { installed: true, online: false, seenAt: null, ffmpeg: null, intervalHours: null };
  }
}

function locationOf(fields: z.infer<typeof bucketFieldsSchema>, secretAccessKey: string): S3Location {
  return {
    endpoint: fields.endpoint,
    region: fields.region,
    bucket: fields.bucket,
    prefix: fields.prefix,
    forcePathStyle: fields.forcePathStyle,
    accessKeyId: fields.accessKeyId,
    secretAccessKey
  };
}

function checkRecord(check: S3CheckResult): Prisma.StorageBucketUpdateInput {
  const failed = check.steps.find((step) => step.ok === false);
  return {
    lastCheckedAt: new Date(),
    lastCheckOk: check.ok,
    lastCheckFailure: failed && "failure" in failed ? (failed.failure as Prisma.InputJsonValue) : Prisma.DbNull
  };
}

// Where the bucket lives, for the audit log: never the credentials.
function auditTarget(fields: { endpoint: string; region: string; bucket: string; prefix: string }): string {
  return `${fields.endpoint || `aws:${fields.region}`}/${fields.bucket}/${fields.prefix}`;
}

export async function storageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/storage/buckets", { preHandler: requireWebAuth }, async () => {
    const buckets = await prisma.storageBucket.findMany({ orderBy: { createdAt: "asc" } });
    // encryptionKey: "ready", or "missing"/"invalid" with the steps to set STORAGE_SECRET_KEY.
    return { encryptionKey: storageKeyState(), scanner: await scannerStatus(), buckets: buckets.map(serializeBucket) };
  });

  // "Probar conexión" on the form, before saving. Editing with the secret left empty uses the saved one.
  app.post("/api/storage/buckets/check", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = checkBodySchema.parse(request.body);
    let secret = body.secretAccessKey;
    if (!secret && body.bucketId) {
      const saved = await prisma.storageBucket.findUnique({ where: { id: body.bucketId } });
      if (!saved) return reply.code(404).send({ message: "Bucket not found" });
      if (!storageSecretKey()) return reply.code(409).send({ message: notConfigured });
      secret = openSecret(saved.secretSealed, saved.id);
    }
    if (!secret) return reply.code(400).send({ message: "The secret access key is required" });
    return { check: await checkS3Location(locationOf(body, secret)) };
  });

  // Saved only when the connection works, so a bucket in the list is always one that answered.
  app.post("/api/storage/buckets", { preHandler: requireWebAuth }, async (request, reply) => {
    const body = bucketFieldsSchema.parse(request.body);
    if (!storageSecretKey()) return reply.code(409).send({ message: notConfigured });
    if (!body.secretAccessKey) return reply.code(400).send({ message: "The secret access key is required" });
    const check = await checkS3Location(locationOf(body, body.secretAccessKey));
    if (!check.ok) return { saved: false, check };

    const id = crypto.randomUUID();
    const bucket = await prisma.storageBucket.create({
      data: {
        id,
        name: body.name,
        endpoint: body.endpoint,
        region: body.region,
        bucket: body.bucket,
        prefix: body.prefix,
        forcePathStyle: body.forcePathStyle,
        accessKeyId: body.accessKeyId,
        secretSealed: sealSecret(body.secretAccessKey, id),
        secretHint: secretHint(body.secretAccessKey),
        lastCheckedAt: new Date(),
        lastCheckOk: true
      }
    });
    await recordAction({ action: "storage.bucket.create", actorType: "web", actorId: "admin", target: auditTarget(bucket), metadata: { bucketId: bucket.id, name: bucket.name } });
    return { saved: true, check, bucket: serializeBucket(bucket) };
  });

  app.patch("/api/storage/buckets/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = bucketFieldsSchema.parse(request.body);
    if (!storageSecretKey()) return reply.code(409).send({ message: notConfigured });
    const saved = await prisma.storageBucket.findUnique({ where: { id } });
    if (!saved) return reply.code(404).send({ message: "Bucket not found" });
    const secret = body.secretAccessKey || openSecret(saved.secretSealed, saved.id);
    const check = await checkS3Location(locationOf(body, secret));
    if (!check.ok) return { saved: false, check };

    const bucket = await prisma.storageBucket.update({
      where: { id },
      data: {
        name: body.name,
        endpoint: body.endpoint,
        region: body.region,
        bucket: body.bucket,
        prefix: body.prefix,
        forcePathStyle: body.forcePathStyle,
        accessKeyId: body.accessKeyId,
        ...(body.secretAccessKey ? { secretSealed: sealSecret(body.secretAccessKey, id), secretHint: secretHint(body.secretAccessKey) } : {}),
        lastCheckedAt: new Date(),
        lastCheckOk: true,
        lastCheckFailure: Prisma.DbNull
      }
    });
    // The catalog drive follows the bucket's name.
    if (bucket.diskId && bucket.name !== saved.name) {
      await prisma.disk.update({ where: { id: bucket.diskId }, data: { name: bucket.name, nameLocked: true } });
    }
    await recordAction({
      action: "storage.bucket.update",
      actorType: "web",
      actorId: "admin",
      diskId: bucket.diskId,
      target: auditTarget(bucket),
      metadata: { bucketId: bucket.id, name: bucket.name, secretChanged: Boolean(body.secretAccessKey) }
    });
    return { saved: true, check, bucket: serializeBucket(bucket) };
  });

  // Checks a saved bucket again and keeps the result, shown on its row.
  app.post("/api/storage/buckets/:id/check", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    if (!storageSecretKey()) return reply.code(409).send({ message: notConfigured });
    const saved = await prisma.storageBucket.findUnique({ where: { id } });
    if (!saved) return reply.code(404).send({ message: "Bucket not found" });
    const check = await checkS3Location({ ...saved, secretAccessKey: openSecret(saved.secretSealed, saved.id) });
    const bucket = await prisma.storageBucket.update({ where: { id }, data: checkRecord(check) });
    return { check, bucket: serializeBucket(bucket) };
  });

  // "Escanear ahora": the scanner takes it on its next round (every few seconds).
  app.post("/api/storage/buckets/:id/scan", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const saved = await prisma.storageBucket.findUnique({ where: { id } });
    if (!saved) return reply.code(404).send({ message: "Bucket not found" });
    if (saved.scanStatus === "running") return reply.code(409).send({ message: "This bucket is already being scanned" });
    const bucket = await prisma.storageBucket.update({ where: { id }, data: { scanRequestedAt: new Date() } });
    await recordAction({ action: "storage.bucket.scan", actorType: "web", actorId: "admin", diskId: bucket.diskId, target: auditTarget(bucket), metadata: { bucketId: bucket.id, name: bucket.name } });
    return { bucket: serializeBucket(bucket) };
  });

  app.delete("/api/storage/buckets/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const saved = await prisma.storageBucket.findUnique({ where: { id } });
    if (!saved) return reply.code(404).send({ message: "Bucket not found" });
    // Its catalog drive (once scanned) stays; removing it is Administración › Discos' job.
    await prisma.storageBucket.delete({ where: { id } });
    await recordAction({ action: "storage.bucket.delete", actorType: "web", actorId: "admin", diskId: saved.diskId, target: auditTarget(saved), metadata: { bucketId: saved.id, name: saved.name } });
    return { ok: true };
  });
}
