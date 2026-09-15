import type { FastifyInstance } from "fastify";
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
  relativePathMatchesProtectedPatterns
} from "../lib/protected-settings.js";
import {
  cancelCompanionStream,
  companionTunnelStatus,
  openCompanionStream,
  readCompanionStreamRange
} from "../lib/companion-control-tunnel.js";
import { companionStreamMaxRangeBytes } from "@videocat/shared";
import { env } from "../lib/env.js";
import { rateLimit } from "../lib/security.js";

const streamSessionSchema = z.object({ fileId: z.string().uuid(), mode: z.enum(["original", "remux"]).default("original") });
const streamParamsSchema = z.object({ id: z.string().uuid() });
const castStreamQuerySchema = z.object({ castToken: z.string().min(1).max(2000).optional() });
const activeStreamStatuses = ["opening", "ready", "streaming"];

function parseRange(value: string | undefined, sizeBytes: number): { start: number; end: number } | null {
  if (!value) return { start: 0, end: Math.min(sizeBytes - 1, companionStreamMaxRangeBytes - 1) };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : NaN;
  const requestedEnd = match[2] ? Number(match[2]) : NaN;
  if (!Number.isSafeInteger(start) || start < 0 || start >= sizeBytes) return null;
  const end = Number.isNaN(requestedEnd)
    ? Math.min(sizeBytes - 1, start + companionStreamMaxRangeBytes - 1)
    : Math.min(sizeBytes - 1, requestedEnd, start + companionStreamMaxRangeBytes - 1);
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
  session: { id: string; companionId: string },
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
  cancelCompanionStream(app, session.companionId, session.id, reason);
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

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/stream-sessions", { preHandler: requireWebAuth }, async (request, reply) => {
    const ownerUsername = authenticatedWebUsername(request);
    if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
    const limit = rateLimit(`remote-stream-session:${ownerUsername}`, 30, 60 * 1000);
    if (!limit.allowed) return reply.code(429).header("Retry-After", String(limit.retryAfterSeconds)).send({ message: "Too many remote playback requests" });
    const { fileId, mode } = streamSessionSchema.parse(request.body);
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
          where: {
            OR: [
              { id: { in: mountedIdentifiers } },
              { volumeId: { in: mountedIdentifiers } }
            ]
          },
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
      try {
        await prisma.streamSession.update({ where: { id }, data: { lastAccessedAt: new Date() } });
        const data = await readStreamRangeWithRetry(app, {
          companionId: session.companionId,
          sessionId: session.id,
          offset: range.start,
          length
        });
        if (data.length !== length) throw new Error("Unexpected range length");
        await prisma.streamSession.update({ where: { id }, data: { status: "streaming", lastAccessedAt: new Date() } });
        if (request.raw.aborted || reply.raw.destroyed) return reply;
        return reply.send(data);
      } catch (error) {
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
    }
  });
}
