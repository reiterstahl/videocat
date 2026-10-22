import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  authenticatedCastStreamUsername,
  authenticatedWebUsername,
  isProtectedFolderUnlocked,
  requireWebAuth,
  signCastStreamAccess
} from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  chromecastStreamingEnabled,
  protectedFolderPatterns,
  relativePathMatchesProtectedPatterns,
  remoteStreamBufferMb
} from "../lib/protected-settings.js";
import {
  cancelCompanionStream,
  companionTunnelStatus,
  openCompanionStream,
  readCompanionStreamRange
} from "../lib/companion-control-tunnel.js";
import { companionStreamMaxRangeBytes, remoteStreamMaxInFlightRanges, streamMimeType } from "@videocat/shared";
import { pumpRange } from "../lib/stream-pump.js";
import { env } from "../lib/env.js";
import { rateLimit } from "../lib/security.js";
import { disksByAgentIdentifiers } from "../lib/disk-identifiers.js";
import { locationOf } from "../lib/bucket-scan.js";
import { headObject, readObjectRange } from "../lib/s3.js";

const streamSessionSchema = z.object({
  fileId: z.string().uuid(),
  mode: z.enum(["original", "remux"]).default("original"),
  replaceSessionId: z.string().uuid().optional()
});
const streamParamsSchema = z.object({ id: z.string().uuid() });
const castStreamQuerySchema = z.object({ castToken: z.string().min(1).max(2000).optional() });
const activeStreamStatuses = ["opening", "ready", "streaming"];

// Open ranges run to the end of the file: the response streams with read-ahead and the
// browser stops reading (or asks a new range) when it has enough or seeks.
function parseRange(value: string | undefined, sizeBytes: number): { start: number; end: number } | null {
  if (!value) return { start: 0, end: sizeBytes - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : NaN;
  const requestedEnd = match[2] ? Number(match[2]) : NaN;
  if (!Number.isSafeInteger(start) || start < 0 || start >= sizeBytes) return null;
  const end = Number.isNaN(requestedEnd) ? sizeBytes - 1 : Math.min(sizeBytes - 1, requestedEnd);
  return end >= start ? { start, end } : null;
}

function mountedDiskIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function hiddenSystemPath(relativePath: string): boolean {
  const root = relativePath.replace(/\\/g, "/").split("/")[0]?.toLowerCase();
  return root === "$recycle.bin" || root === "system volume information";
}

function sessionExpired(session: { expiresAt: Date; createdAt: Date; lastAccessedAt: Date | null }): boolean {
  if (session.expiresAt <= new Date()) return true;
  const lastActivity = session.lastAccessedAt ?? session.createdAt;
  return lastActivity.getTime() + env.REMOTE_STREAM_IDLE_TIMEOUT_MS <= Date.now();
}

async function expireStreamSession(
  app: FastifyInstance,
  session: { id: string; companionId: string | null },
  errorCode: "expired" | "idle_timeout" | "cancelled" | "read_failed",
  reason: "client_closed" | "expired" | "superseded" | "error"
): Promise<void> {
  await prisma.streamSession.updateMany({
    where: { id: session.id, status: { in: activeStreamStatuses } },
    data: {
      status: errorCode === "cancelled" ? "cancelled" : errorCode === "read_failed" ? "failed" : "expired",
      errorCode,
      completedAt: new Date()
    }
  });
  // Sessions served from an S3 bucket have no Companion to tell.
  if (session.companionId) cancelCompanionStream(app, session.companionId, session.id, reason);
}

async function expireInactiveStreams(app: FastifyInstance, companionId?: string): Promise<void> {
  const sessions = await prisma.streamSession.findMany({
    where: { status: { in: activeStreamStatuses }, ...(companionId ? { companionId } : {}) },
    select: { id: true, companionId: true, expiresAt: true, createdAt: true, lastAccessedAt: true }
  });
  await Promise.all(sessions.filter(sessionExpired).map((session) =>
    expireStreamSession(app, session, session.expiresAt <= new Date() ? "expired" : "idle_timeout", "expired")
  ));
}

function sessionForOwner(id: string, ownerUsername: string) {
  return prisma.streamSession.findFirst({ where: { id, ownerUsername } });
}

async function readStreamRangeWithRetry(
  app: FastifyInstance,
  input: { companionId: string; sessionId: string; offset: number; length: number }
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await readCompanionStreamRange(app, input);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError;
}

async function* continueWith(first: Buffer, rest: AsyncGenerator<Buffer>): AsyncGenerator<Buffer> {
  yield first;
  yield* rest;
}

// A newer playback of the same person replaces the one they were watching.
async function replaceSession(app: FastifyInstance, request: { id: string }, ownerUsername: string, replaceSessionId: string | undefined, fileId: string): Promise<void> {
  if (!replaceSessionId) return;
  const replacedSession = await prisma.streamSession.findFirst({
    where: {
      id: replaceSessionId,
      ownerUsername,
      status: { in: activeStreamStatuses }
    },
    select: { id: true, companionId: true }
  });
  if (!replacedSession) return;
  await expireStreamSession(app, replacedSession, "cancelled", "superseded");
  app.log.info({
    streamSessionId: replacedSession.id,
    replacementFileId: fileId,
    companionId: replacedSession.companionId,
    ownerUsername,
    requestId: request.id
  }, "Remote stream session superseded by next playback request");
}

// Passes the bytes on as they come and keeps the session alive while they flow.
async function* touchingEach(body: ReadableStream<Uint8Array>, touch: () => void): AsyncGenerator<Buffer> {
  for await (const chunk of Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>)) {
    touch();
    yield chunk as Buffer;
  }
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/stream-sessions", { preHandler: requireWebAuth }, async (request, reply) => {
    const ownerUsername = authenticatedWebUsername(request);
    if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
    const limit = rateLimit(`remote-stream-session:${ownerUsername}`, 30, 60 * 1000);
    if (!limit.allowed) return reply.code(429).header("Retry-After", String(limit.retryAfterSeconds)).send({ message: "Too many remote playback requests" });
    const { fileId, mode, replaceSessionId } = streamSessionSchema.parse(request.body);
    const file = await prisma.videoFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        diskId: true,
        relativePath: true,
        sizeBytes: true,
        isPresent: true,
        extension: true,
        videoCodec: true,
        audioCodec: true
      }
    });
    if (!file || !file.isPresent || hiddenSystemPath(file.relativePath)) return reply.code(404).send({ message: "File not available" });
    const patterns = await protectedFolderPatterns();
    if (relativePathMatchesProtectedPatterns(file.relativePath, patterns) && !isProtectedFolderUnlocked(request)) {
      return reply.code(403).send({ message: "PIN required" });
    }
    if (mode === "remux") {
      const containerNeedsRemux = ![".mp4", ".m4v", ".mov"].includes(file.extension.toLowerCase());
      const compatibleVideo = ["h264", "avc"].includes((file.videoCodec ?? "").toLowerCase());
      const compatibleAudio = ["aac", "mp3"].includes((file.audioCodec ?? "").toLowerCase());
      if (!containerNeedsRemux || !compatibleVideo || !compatibleAudio) {
        return reply.code(400).send({ message: "This file is not eligible for the MP4 remux fallback" });
      }
    }

    // A video in an S3 bucket: the server reads it from the bucket, no Companion takes part.
    const disk = await prisma.disk.findUnique({ where: { id: file.diskId }, select: { kind: true, storageBucket: true } });
    if (disk?.kind === "s3") {
      if (mode === "remux") return reply.code(400).send({ message: "The MP4 remux is not available for videos in S3 buckets" });
      const bucket = disk.storageBucket;
      if (!bucket) return reply.code(409).send({ message: "This bucket is no longer set up in Administración" });
      await expireInactiveStreams(app);
      await replaceSession(app, request, ownerUsername, replaceSessionId, file.id);
      const activeUserCount = await prisma.streamSession.count({
        where: { ownerUsername, status: { in: activeStreamStatuses }, expiresAt: { gt: new Date() } }
      });
      if (activeUserCount >= env.REMOTE_STREAM_MAX_SESSIONS_PER_USER) {
        return reply.code(409).send({ message: "Your account already has the maximum number of remote streams" });
      }
      const expiresAt = new Date(Date.now() + env.REMOTE_STREAM_SESSION_LIFETIME_MS);
      const session = await prisma.streamSession.create({
        data: { videoFileId: file.id, storageBucketId: bucket.id, ownerUsername, mode, expiresAt }
      });
      try {
        const object = await headObject(locationOf(bucket), `${bucket.prefix}${file.relativePath}`);
        if (object.sizeBytes !== Number(file.sizeBytes)) throw new Error("Object size changed since the last scan");
        const ready = await prisma.streamSession.update({
          where: { id: session.id },
          data: { status: "ready", fileSizeBytes: BigInt(object.sizeBytes), mimeType: streamMimeType(file.extension.startsWith(".") ? file.extension : `.${file.extension}`) }
        });
        app.log.info({ streamSessionId: ready.id, storageBucketId: bucket.id, ownerUsername, requestId: request.id }, "Remote stream session ready from an S3 bucket");
        return { session: { id: ready.id, status: ready.status, expiresAt: ready.expiresAt.toISOString(), mimeType: ready.mimeType, sizeBytes: Number(ready.fileSizeBytes ?? 0n) } };
      } catch (error) {
        await prisma.streamSession.update({ where: { id: session.id }, data: { status: "failed", errorCode: "not_available", completedAt: new Date() } });
        app.log.warn({ streamSessionId: session.id, storageBucketId: bucket.id, requestId: request.id, error: error instanceof Error ? error.message : "unknown" }, "Remote stream session from an S3 bucket could not be prepared");
        return reply.code(409).send({ message: "The bucket could not serve this video; scan it again" });
      }
    }

    const companions = await prisma.companionAgent.findMany({
      where: { revokedAt: null },
      select: { installationId: true, mountedDiskIds: true }
    });
    // Companions report the stable identifier stored in .videocat-disk.json.
    // Catalog files reference the internal Disk id, which can differ for older
    // catalogs created before marker identifiers were used directly.
    const mountedIdentifiers = [...new Set(companions.flatMap((companion) => mountedDiskIds(companion.mountedDiskIds)))];
    const mountedDisks = mountedIdentifiers.length > 0
      ? await prisma.disk.findMany({
          where: disksByAgentIdentifiers(mountedIdentifiers),
          select: { id: true, volumeId: true }
        })
      : [];
    const catalogDiskIdByIdentifier = new Map<string, string>();
    for (const disk of mountedDisks) {
      catalogDiskIdByIdentifier.set(disk.id, disk.id);
      if (disk.volumeId) catalogDiskIdByIdentifier.set(disk.volumeId, disk.id);
    }

    const candidate = companions
      .map((companion) => {
        const mountedIdentifier = mountedDiskIds(companion.mountedDiskIds)
          .find((identifier) => (catalogDiskIdByIdentifier.get(identifier) ?? identifier) === file.diskId);
        return { ...companion, mountedIdentifier };
      })
      .find((companion) => {
        const tunnel = companionTunnelStatus(app, companion.installationId);
        return Boolean(companion.mountedIdentifier)
          && tunnel.connected
          && tunnel.capabilities?.streamRead === true
          && (mode !== "remux" || (env.REMOTE_REMUX_ENABLED && tunnel.capabilities?.streamRemux === true));
      });
    if (!candidate) return reply.code(409).send({ message: mode === "remux" ? "No Companion with optional MP4 remuxing is ready" : "No paired Companion with this disk is ready for streaming" });

    await expireInactiveStreams(app, candidate.installationId);
    await replaceSession(app, request, ownerUsername, replaceSessionId, file.id);
    const [activeCompanionCount, activeUserCount] = await Promise.all([
      prisma.streamSession.count({
        where: { companionId: candidate.installationId, ownerUsername, status: { in: activeStreamStatuses }, expiresAt: { gt: new Date() } }
      }),
      prisma.streamSession.count({
        where: { ownerUsername, status: { in: activeStreamStatuses }, expiresAt: { gt: new Date() } }
      })
    ]);
    if (activeCompanionCount >= env.REMOTE_STREAM_MAX_SESSIONS_PER_COMPANION) {
      return reply.code(409).send({ message: "This Companion is already streaming a video" });
    }
    if (activeUserCount >= env.REMOTE_STREAM_MAX_SESSIONS_PER_USER) {
      return reply.code(409).send({ message: "Your account already has the maximum number of remote streams" });
    }

    const expiresAt = new Date(Date.now() + env.REMOTE_STREAM_SESSION_LIFETIME_MS);
    const session = await prisma.streamSession.create({
      data: {
        videoFileId: file.id,
        companionId: candidate.installationId,
        ownerUsername,
        mode,
        expiresAt
      }
    });
    try {
      const prepared = await openCompanionStream(app, {
        companionId: candidate.installationId,
        sessionId: session.id,
        fileId: file.id,
        // The Companion resolves paths against its marker/manual target id,
        // not the catalog's internal PostgreSQL Disk id.
        diskId: candidate.mountedIdentifier!,
        relativePath: file.relativePath,
        expectedSizeBytes: Number(file.sizeBytes),
        mode,
        expiresAt: expiresAt.toISOString()
      });
      if (mode === "original" && prepared.sizeBytes !== Number(file.sizeBytes)) throw new Error("Stream size changed while opening");
      const ready = await prisma.streamSession.update({
        where: { id: session.id },
        data: { status: "ready", fileSizeBytes: BigInt(prepared.sizeBytes), mimeType: prepared.mimeType }
      });
      app.log.info({ streamSessionId: ready.id, companionId: ready.companionId, ownerUsername, mode, requestId: request.id }, "Remote stream session ready");
      return { session: { id: ready.id, status: ready.status, expiresAt: ready.expiresAt.toISOString(), mimeType: ready.mimeType, sizeBytes: Number(ready.fileSizeBytes ?? 0n) } };
    } catch {
      await prisma.streamSession.update({ where: { id: session.id }, data: { status: "failed", errorCode: "not_available", completedAt: new Date() } });
      app.log.warn({ streamSessionId: session.id, companionId: candidate.installationId, ownerUsername, requestId: request.id }, "Remote stream session could not be prepared");
      return reply.code(409).send({ message: "Companion could not prepare this file for streaming" });
    }
  });

  app.get("/api/stream-sessions/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const ownerUsername = authenticatedWebUsername(request);
    if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
    const { id } = streamParamsSchema.parse(request.params);
    const session = await sessionForOwner(id, ownerUsername);
    if (!session) return reply.code(404).send({ message: "Stream session not found" });
    const expired = sessionExpired(session);
    if (expired) await expireStreamSession(app, session, session.expiresAt <= new Date() ? "expired" : "idle_timeout", "expired");
    return { session: { id: session.id, status: expired ? "expired" : session.status, expiresAt: session.expiresAt.toISOString(), mimeType: session.mimeType, sizeBytes: session.fileSizeBytes == null ? null : Number(session.fileSizeBytes) } };
  });

  app.delete("/api/stream-sessions/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const ownerUsername = authenticatedWebUsername(request);
    if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
    const { id } = streamParamsSchema.parse(request.params);
    const session = await sessionForOwner(id, ownerUsername);
    if (!session) return reply.code(404).send({ message: "Stream session not found" });
    await expireStreamSession(app, session, "cancelled", "client_closed");
    app.log.info({ streamSessionId: session.id, companionId: session.companionId, ownerUsername, requestId: request.id }, "Remote stream session cancelled");
    return { ok: true };
  });

  app.post("/api/stream-sessions/:id/cast-access", { preHandler: requireWebAuth }, async (request, reply) => {
    const ownerUsername = authenticatedWebUsername(request);
    if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
    if (!(await chromecastStreamingEnabled())) {
      return reply.code(403).send({ message: "Chromecast streaming is disabled in your profile" });
    }
    const { id } = streamParamsSchema.parse(request.params);
    const session = await sessionForOwner(id, ownerUsername);
    if (!session || sessionExpired(session) || !activeStreamStatuses.includes(session.status) || !session.mimeType) {
      return reply.code(404).send({ message: "Stream session unavailable" });
    }
    const castToken = signCastStreamAccess(session.id, ownerUsername, session.expiresAt);
    return {
      path: `/api/streams/${session.id}/content?castToken=${encodeURIComponent(castToken)}`,
      expiresAt: session.expiresAt.toISOString(),
      mimeType: session.mimeType
    };
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/streams/:id/content",
    handler: async (request, reply) => {
      const { id } = streamParamsSchema.parse(request.params);
      const castQuery = castStreamQuerySchema.parse(request.query);
      const webUsername = authenticatedWebUsername(request);
      const castUsername = authenticatedCastStreamUsername(castQuery.castToken, id);
      if (!webUsername && castUsername && !(await chromecastStreamingEnabled())) {
        return reply.code(403).send({ message: "Chromecast streaming is disabled in your profile" });
      }
      const ownerUsername = webUsername ?? castUsername;
      if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
      const session = await sessionForOwner(id, ownerUsername);
      const expired = session ? sessionExpired(session) : false;
      if (!session || session.status === "cancelled" || session.status === "failed" || expired || session.fileSizeBytes == null || !session.mimeType) {
        if (session && expired) await expireStreamSession(app, session, session.expiresAt <= new Date() ? "expired" : "idle_timeout", "expired");
        return reply.code(404).send({ message: "Stream session unavailable" });
      }
      const sizeBytes = Number(session.fileSizeBytes);
      const range = parseRange(typeof request.headers.range === "string" ? request.headers.range : undefined, sizeBytes);
      if (!range) return reply.code(416).header("Content-Range", `bytes */${sizeBytes}`).send();
      const length = range.end - range.start + 1;
      reply
        .code(206)
        .header("Accept-Ranges", "bytes")
        .header("Content-Range", `bytes ${range.start}-${range.end}/${sizeBytes}`)
        .header("Content-Length", String(length))
        .header("Content-Type", session.mimeType)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store");
      if (castQuery.castToken) {
        reply.header("Cross-Origin-Resource-Policy", "cross-origin");
        const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : null;
        if (requestOrigin) {
          reply
            .header("Access-Control-Allow-Origin", requestOrigin)
            .header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type")
            .header("Vary", "Origin");
        }
      }
      if (request.method === "HEAD") return reply.send();
      // Long playback keeps the session alive without a database write per chunk.
      let touchedAt = Date.now();
      const touch = () => {
        if (Date.now() - touchedAt < 15_000) return;
        touchedAt = Date.now();
        void prisma.streamSession.update({ where: { id }, data: { lastAccessedAt: new Date() } }).catch(() => undefined);
      };

      if (session.storageBucketId) {
        const [bucket, file] = await Promise.all([
          prisma.storageBucket.findUnique({ where: { id: session.storageBucketId } }),
          prisma.videoFile.findUnique({ where: { id: session.videoFileId }, select: { relativePath: true } })
        ]);
        if (!bucket || !file) return reply.code(404).send({ message: "Stream session unavailable" });
        // The read stops when the browser goes away (a seek, a pause that drops the request).
        const upstream = new AbortController();
        request.raw.on("close", () => upstream.abort());
        let body: ReadableStream<Uint8Array>;
        try {
          await prisma.streamSession.update({ where: { id }, data: { status: "streaming", lastAccessedAt: new Date() } });
          body = await readObjectRange(locationOf(bucket), `${bucket.prefix}${file.relativePath}`, range.start, range.end, upstream.signal);
        } catch (error) {
          if (request.raw.aborted || reply.raw.destroyed) return reply;
          app.log.warn({ streamSessionId: session.id, storageBucketId: bucket.id, requestId: request.id, error: error instanceof Error ? error.message : "unknown" }, "S3 stream range failed; session remains available for retry");
          return reply.code(503).header("Retry-After", "1").send({ message: "The bucket did not answer this range" });
        }
        return reply.send(Readable.from(touchingEach(body, touch), { objectMode: false }));
      }

      const companionId = session.companionId;
      if (!companionId) return reply.code(404).send({ message: "Stream session unavailable" });
      const readRange = (offset: number, rangeLength: number) => readStreamRangeWithRetry(app, {
        companionId,
        sessionId: session.id,
        offset,
        length: rangeLength
      });
      const chunks = pumpRange({
        start: range.start,
        end: range.end,
        chunkBytes: companionStreamMaxRangeBytes,
        bufferBytes: (await remoteStreamBufferMb()) * 1024 * 1024,
        maxInFlight: remoteStreamMaxInFlightRanges,
        read: readRange,
        onChunk: touch
      });
      let first: Buffer;
      try {
        await prisma.streamSession.update({ where: { id }, data: { lastAccessedAt: new Date() } });
        // The first chunk arrives before the headers go out, so an unavailable Companion still answers 503.
        const head = await chunks.next();
        if (head.done) throw new Error("Unexpected range length");
        first = head.value;
        await prisma.streamSession.update({ where: { id }, data: { status: "streaming", lastAccessedAt: new Date() } });
      } catch (error) {
        await chunks.return(undefined);
        if (request.raw.aborted || reply.raw.destroyed) return reply;
        app.log.warn({
          streamSessionId: session.id,
          companionId: session.companionId,
          ownerUsername,
          requestId: request.id,
          error: error instanceof Error ? error.message : "unknown"
        }, "Remote stream range failed; session remains available for retry");
        return reply.code(503).header("Retry-After", "1").send({ message: "Companion stream range is temporarily unavailable" });
      }
      if (request.raw.aborted || reply.raw.destroyed) {
        await chunks.return(undefined);
        return reply;
      }
      if (first.length === length) return reply.send(first);
      // A failure later on cuts the response; the browser asks again from where it stopped.
      return reply.send(Readable.from(continueWith(first, chunks), { objectMode: false }));
    }
  });
}
