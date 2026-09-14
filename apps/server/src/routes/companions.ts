import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireWebAuth } from "../lib/auth.js";
import {
  displayPairingCode,
  generateAgentCredential,
  generatePairingCode,
  hashAgentSecret,
  normalizePairingCode
} from "../lib/agent-credentials.js";
import { prisma } from "../lib/prisma.js";
import { clearRateLimit, rateLimit } from "../lib/security.js";

const pairingLifetimeMs = 10 * 60 * 1000;
const pairingBodySchema = z.object({
  code: z.string().trim().min(1).max(32),
  companionId: z.string().uuid(),
  companionName: z.string().trim().min(1).max(120).optional(),
  version: z.number().int().nonnegative().optional()
});
const companionParamsSchema = z.object({ id: z.string().uuid() });

async function enforcePairingRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = `companion-pair:${request.ip}`;
  const current = rateLimit(key, 8, 15 * 60 * 1000);
  if (!current.allowed) {
    await reply
      .code(429)
      .header("Retry-After", String(current.retryAfterSeconds))
      .send({ message: "Too many pairing attempts. Try again later." });
  }
}

export async function companionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/agent/pair", { preHandler: enforcePairingRateLimit }, async (request, reply) => {
    if (reply.sent) return;
    const body = pairingBodySchema.parse(request.body ?? {});
    const normalizedCode = normalizePairingCode(body.code);
    if (normalizedCode.length !== 10) {
      return reply.code(401).send({ message: "Invalid or expired pairing code" });
    }

    const now = new Date();
    const codeHash = hashAgentSecret(`pair:${normalizedCode}`);
    const credential = generateAgentCredential();
    const credentialHash = hashAgentSecret(credential);

    const paired = await prisma.$transaction(async (transaction) => {
      const claim = await transaction.companionPairingCode.updateMany({
        where: { codeHash, claimedAt: null, expiresAt: { gt: now } },
        data: { claimedAt: now, claimedById: body.companionId }
      });
      if (claim.count !== 1) return false;

      await transaction.companionAgent.upsert({
        where: { installationId: body.companionId },
        create: {
          installationId: body.companionId,
          name: body.companionName,
          version: body.version ?? 0,
          credentialHash,
          credentialIssuedAt: now,
          authMode: "paired"
        },
        update: {
          name: body.companionName,
          version: body.version ?? 0,
          credentialHash,
          credentialIssuedAt: now,
          authMode: "paired",
          revokedAt: null
        }
      });
      return true;
    });

    if (!paired) return reply.code(401).send({ message: "Invalid or expired pairing code" });
    clearRateLimit(`companion-pair:${request.ip}`);
    return { ok: true, credential, companionId: body.companionId, issuedAt: now.toISOString() };
  });

  app.post("/api/companions/pairing-code", { preHandler: requireWebAuth }, async () => {
    const now = new Date();
    await prisma.companionPairingCode.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { claimedAt: { not: null } }
        ]
      }
    });

    const code = generatePairingCode();
    const expiresAt = new Date(now.getTime() + pairingLifetimeMs);
    await prisma.companionPairingCode.create({
      data: { codeHash: hashAgentSecret(`pair:${code}`), expiresAt }
    });
    return { code: displayPairingCode(code), expiresAt: expiresAt.toISOString() };
  });

  app.get("/api/companions", { preHandler: requireWebAuth }, async () => {
    const companions = await prisma.companionAgent.findMany({
      orderBy: { lastSeenAt: "desc" },
      select: {
        installationId: true,
        name: true,
        version: true,
        mountedDiskCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        revokedAt: true,
        credentialIssuedAt: true,
        authMode: true
      }
    });
    return {
      companions: companions.map((companion) => ({
        ...companion,
        firstSeenAt: companion.firstSeenAt.toISOString(),
        lastSeenAt: companion.lastSeenAt.toISOString(),
        revokedAt: companion.revokedAt?.toISOString() ?? null,
        credentialIssuedAt: companion.credentialIssuedAt?.toISOString() ?? null
      }))
    };
  });

  app.post("/api/companions/:id/revoke", { preHandler: requireWebAuth }, async (request, reply) => {
    const { id } = companionParamsSchema.parse(request.params);
    const result = await prisma.companionAgent.updateMany({
      where: { installationId: id },
      data: { revokedAt: new Date() }
    });
    if (result.count !== 1) return reply.code(404).send({ message: "Companion not found" });
    return { ok: true };
  });
}
