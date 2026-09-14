import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticatedWebUsername, isProtectedFolderUnlocked, requireWebAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { protectedFolderPatterns, relativePathMatchesProtectedPatterns } from "../lib/protected-settings.js";
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
    const candidate = companions.find((companion) => {
      const tunnel = companionTunnelStatus(app, companion.installationId);
      return mountedDiskIds(companion.mountedDiskIds).includes(file.diskId)
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
        diskId: file.diskId,
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

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/streams/:id/content",
    preHandler: requireWebAuth,
    handler: async (request, reply) => {
      const ownerUsername = authenticatedWebUsername(request);
      if (!ownerUsername) return reply.code(401).send({ message: "Authentication required" });
      const { id } = streamParamsSchema.parse(request.params);
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
      if (request.method === "HEAD") return reply.send();
      try {
        await prisma.streamSession.update({ where: { id }, data: { lastAccessedAt: new Date() } });
        const data = await readCompanionStreamRange(app, { companionId: session.companionId, sessionId: session.id, offset: range.start, length });
        if (data.length !== length) throw new Error("Unexpected range length");
        await prisma.streamSession.update({ where: { id }, data: { status: "streaming", lastAccessedAt: new Date() } });
        return reply.send(data);
      } catch {
        await expireStreamSession(app, session, "read_failed", "error");
        app.log.warn({ streamSessionId: session.id, companionId: session.companionId, ownerUsername, requestId: request.id }, "Remote stream read failed");
        return reply.code(502).send({ message: "Companion stream became unavailable" });
      }
    }
  });
}
