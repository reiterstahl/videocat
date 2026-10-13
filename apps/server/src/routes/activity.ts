import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireWebAuth } from "../lib/auth.js";
import { liveActivity } from "../lib/companion-activity.js";
import { unfinishedStates } from "../lib/transfer-states.js";

const recentLimit = 12;

// The header activity indicator: what every Companion is doing now, what is waiting and what just happened.
export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/activity", { preHandler: requireWebAuth }, async () => {
    const [transfersWaiting, downloadsQueued, delivered, downloads, deletions, scans] = await Promise.all([
      prisma.transferItem.count({ where: { state: { in: unfinishedStates } } }),
      prisma.downloadQueue.count({ where: { status: { in: ["queued", "downloading"] } } }),
      prisma.actionAudit.findMany({
        where: { action: { in: ["transfer.delivered", "transfer.duplicate"] } },
        orderBy: { createdAt: "desc" },
        take: recentLimit,
        select: { action: true, target: true, result: true, createdAt: true }
      }),
      prisma.downloadQueue.findMany({
        where: { status: "done", completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: recentLimit,
        select: { completedAt: true, destinationPath: true, videoFile: { select: { filename: true, sizeBytes: true } } }
      }),
      prisma.deletionRecord.findMany({
        where: { status: "deleted", completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: recentLimit,
        select: { completedAt: true, filename: true, diskName: true, sizeBytes: true }
      }),
      prisma.actionAudit.findMany({
        where: { action: "scan.finish" },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { createdAt: true, diskId: true }
      })
    ]);
    const scanDisks = await prisma.disk.findMany({ where: { id: { in: scans.flatMap((scan) => (scan.diskId ? [scan.diskId] : [])) } }, select: { id: true, name: true } });

    const resultBytes = (result: unknown): number | null => {
      const bytes = result && typeof result === "object" ? (result as { bytes?: unknown }).bytes : null;
      return typeof bytes === "number" ? bytes : null;
    };
    const recent = [
      ...delivered.map((entry) => ({
        kind: entry.action === "transfer.delivered" ? "transfer" as const : "duplicate" as const,
        label: (entry.target ?? "").split("/").pop() ?? "",
        detail: entry.target ?? null,
        bytes: resultBytes(entry.result),
        at: entry.createdAt
      })),
      ...downloads.map((entry) => ({ kind: "download" as const, label: entry.videoFile.filename, detail: entry.destinationPath, bytes: Number(entry.videoFile.sizeBytes), at: entry.completedAt! })),
      ...deletions.map((entry) => ({ kind: "delete" as const, label: entry.filename, detail: entry.diskName, bytes: Number(entry.sizeBytes), at: entry.completedAt! })),
      ...scans.map((entry) => ({ kind: "scan" as const, label: scanDisks.find((disk) => disk.id === entry.diskId)?.name ?? "", detail: null, bytes: null, at: entry.createdAt }))
    ]
      .sort((left, right) => right.at.getTime() - left.at.getTime())
      .slice(0, recentLimit);

    return {
      companions: liveActivity().map((entry) => ({ companionId: entry.companionId, companionName: entry.companionName, activities: entry.activities, reportedAt: entry.reportedAt })),
      waiting: { transfers: transfersWaiting, downloads: downloadsQueued },
      recent
    };
  });
}
