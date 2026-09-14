import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isProtectedFolderUnlocked, requireWebAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { protectedFolderPatterns, relativePathMatchesProtectedPatterns } from "../lib/protected-settings.js";
import {
  cancelCompanionStream,
  companionTunnelStatus,
  openCompanionStream,
  readCompanionStreamRange
} from "../lib/companion-control-tunnel.js";
import { companionStreamMaxRangeBytes, companionStreamSessionLifetimeMs } from "@videocat/shared";

const streamSessionSchema = z.object({ fileId: z.string().uuid() });
const streamParamsSchema = z.object({ id: z.string().uuid() });
const maxStreamsPerCompanion = 1;

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

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/stream-sessions", { preHandler: requireWebAuth }, async (request, reply) => {
    const { fileId } = streamSessionSchema.parse(request.body);
    const file = await prisma.videoFile.findUnique({
      where: { id: fileId },
      select: { id: true, diskId: true, relativePath: true, sizeBytes: true, isPresent: true }
    });
    if (!file || !file.isPresent || hiddenSystemPath(file.relativePath)) return reply.code(404).send({ message: "File not available" });
    const patterns = await protectedFolderPatterns();
    if (relativePathMatchesProtectedPatterns(file.relativePath, patterns) && !isProtectedFolderUnlocked(request)) {
      return reply.code(403).send({ message: "PIN required" });
    }

    const companions = await prisma.companionAgent.findMany({
      where: { revokedAt: null },
      select: { installationId: true, mountedDiskIds: true }
    });
    const candidate = companions.find((companion) => {
      const tunnel = companionTunnelStatus(app, companion.installationId);
      return mountedDiskIds(companion.mountedDiskIds).includes(file.diskId) && tunnel.connected && tunnel.capabilities?.streamRead === true;
    });
    if (!candidate) return reply.code(409).send({ message: "No paired Companion with this disk is ready for streaming" });

    const activeCount = await prisma.streamSession.count({
      where: { companionId: candidate.installationId, status: { in: ["opening", "ready", "streaming"] }, expiresAt: { gt: new Date() } }
    });
    if (activeCount >= maxStreamsPerCompanion) return reply.code(409).send({ message: "This Companion is already streaming a video" });

    const expiresAt = new Date(Date.now() + companionStreamSessionLifetimeMs);
    const session = await prisma.streamSession.create({
      data: {
        videoFileId: file.id,
        companionId: candidate.installationId,
        ownerUsername: process.env.ADMIN_USER ?? "admin",
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
        expiresAt: expiresAt.toISOString()
      });
      if (prepared.sizeBytes !== Number(file.sizeBytes)) throw new Error("Stream size changed while opening");
      const ready = await prisma.streamSession.update({
        where: { id: session.id },
        data: { status: "ready", fileSizeBytes: BigInt(prepared.sizeBytes), mimeType: prepared.mimeType }
      });
      return { session: { id: ready.id, status: ready.status, expiresAt: ready.expiresAt.toISOString(), mimeType: ready.mimeType, sizeBytes: Number(ready.fileSizeBytes ?? 0n) } };
    } catch {
      await prisma.streamSession.update({ where: { id: session.id }, data: { status: "failed", errorCode: "not_available", completedAt: new Date() } });
      return reply.code(409).send({ message: "Companion could not prepare this file for streaming" });
    }
  });

  app.get("/api/stream-sessions/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = streamParamsSchema.parse(request.params);
    const session = await prisma.streamSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ message: "Stream session not found" });
    const expired = session.expiresAt <= new Date();
    return { session: { id: session.id, status: expired ? "expired" : session.status, expiresAt: session.expiresAt.toISOString(), mimeType: session.mimeType, sizeBytes: session.fileSizeBytes == null ? null : Number(session.fileSizeBytes) } };
  });

  app.delete("/api/stream-sessions/:id", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = streamParamsSchema.parse(request.params);
    const session = await prisma.streamSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ message: "Stream session not found" });
    await prisma.streamSession.update({ where: { id }, data: { status: "cancelled", completedAt: new Date() } });
    cancelCompanionStream(app, session.companionId, session.id, "client_closed");
    return { ok: true };
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/streams/:id/content",
    preHandler: requireWebAuth,
    handler: async (request, reply) => {
      const { id } = streamParamsSchema.parse(request.params);
      const session = await prisma.streamSession.findUnique({ where: { id } });
      if (!session || session.status === "cancelled" || session.status === "failed" || session.expiresAt <= new Date() || session.fileSizeBytes == null || !session.mimeType) {
        if (session?.expiresAt && session.expiresAt <= new Date()) cancelCompanionStream(app, session.companionId, session.id, "expired");
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
        const data = await readCompanionStreamRange(app, { companionId: session.companionId, sessionId: session.id, offset: range.start, length });
        if (data.length !== length) throw new Error("Unexpected range length");
        await prisma.streamSession.update({ where: { id }, data: { status: "streaming", lastAccessedAt: new Date() } });
        return reply.send(data);
      } catch {
        cancelCompanionStream(app, session.companionId, session.id, "error");
        await prisma.streamSession.update({ where: { id }, data: { status: "failed", errorCode: "read_failed", completedAt: new Date() } });
        return reply.code(502).send({ message: "Companion stream became unavailable" });
      }
    }
  });
}
