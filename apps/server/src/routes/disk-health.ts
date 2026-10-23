import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { diskHealthUploadSchema, type DiskHealthEvaluation } from "@videocat/shared";
import { requireAgentAuth, requireWebAuth } from "../lib/auth.js";
import { recordAction } from "../lib/action-audit.js";
import { prisma } from "../lib/prisma.js";
import { alertKey, healthSummary, saveDiskHealth } from "../lib/disk-health.js";

export async function diskHealthRoutes(app: FastifyInstance): Promise<void> {
  // SMART checks of the drives connected to a Companion (Companion 0.2.23 or later).
  app.post("/api/agent/disk-health", { preHandler: requireAgentAuth }, async (request) => {
    const body = diskHealthUploadSchema.parse(request.body);
    let saved = 0;
    for (const item of body.disks) {
      const disk = await prisma.disk.findFirst({
        where: { OR: [...(z.string().uuid().safeParse(item.diskId).success ? [{ id: item.diskId }] : []), { volumeId: item.diskId }] },
        select: { id: true }
      });
      if (!disk) continue;
      await saveDiskHealth(disk.id, new Date(item.checkedAt), item.report);
      saved += 1;
    }
    return { saved };
  });

  // Drives with a probable failure whose alert was not dismissed for their current state.
  app.get("/api/disk-health/alerts", { preHandler: requireWebAuth }, async () => {
    const rows = await prisma.diskHealth.findMany({
      where: { status: "failing" },
      include: { disk: { select: { name: true } } },
      orderBy: { checkedAt: "desc" }
    });
    return {
      alerts: rows
        .filter((row) => row.alertDismissedKey !== alertKey(row.evaluation as unknown as DiskHealthEvaluation))
        .map((row) => ({ diskId: row.diskId, diskName: row.disk.name, ...healthSummary(row) }))
    };
  });

  app.post("/api/disk-health/:diskId/dismiss", { preHandler: requireWebAuth }, async (request, reply) => {
    const { diskId } = z.object({ diskId: z.string().uuid() }).parse(request.params);
    const row = await prisma.diskHealth.findUnique({ where: { diskId } });
    if (!row) return reply.code(404).send({ message: "Disk health not found" });
    const key = alertKey(row.evaluation as unknown as DiskHealthEvaluation);
    await prisma.diskHealth.update({ where: { diskId }, data: { alertDismissedKey: key } });
    await recordAction({ action: "disk.health_alert_dismiss", actorType: "web", actorId: "admin", requestId: request.id, diskId, target: row.status, result: { key } });
    return { ok: true };
  });
}
