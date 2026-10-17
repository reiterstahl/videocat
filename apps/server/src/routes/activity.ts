import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireWebAuth } from "../lib/auth.js";
import { companionTransfers, liveActivity, transfersWaitingForDownloads } from "../lib/companion-activity.js";
import { pendingTransferOrder, requestTransfers, transferOrders } from "../lib/transfer-control.js";
import { recordAction } from "../lib/action-audit.js";
import { unfinishedStates, type TransferState } from "../lib/transfer-states.js";
import { connectedWork, mountedSinceByIdentifier } from "../lib/connected-work.js";
import { disksByAgentIdentifiers } from "../lib/disk-identifiers.js";

const companionOnlineMs = 45_000;

// What is left to move with the drives connected now, so the person knows whether a drive can go.
async function connectedDrivesWork() {
  const companions = await prisma.companionAgent.findMany({
    where: { revokedAt: null, lastSeenAt: { gte: new Date(Date.now() - companionOnlineMs) } },
    select: { mountedDiskIds: true }
  });
  const identifiers = [...new Set(companions.flatMap((companion) => Array.isArray(companion.mountedDiskIds) ? companion.mountedDiskIds.filter((value): value is string => typeof value === "string") : []))];
  if (identifiers.length === 0) return null;
  const disks = await prisma.disk.findMany({ where: disksByAgentIdentifiers(identifiers), select: { id: true, volumeId: true, name: true, driveLetter: true } });
  if (disks.length === 0) return null;
  const sinceByIdentifier = mountedSinceByIdentifier();
  const now = Date.now();
  const connected = new Map(disks.map((disk) => {
    const seen = [sinceByIdentifier.get(disk.id), disk.volumeId ? sinceByIdentifier.get(disk.volumeId) : undefined].filter((value): value is number => value != null);
    return [disk.id, seen.length > 0 ? Math.min(...seen) : now] as const;
  }));
  const ids = [...connected.keys()];
  const earliest = new Date(Math.min(...connected.values()));
  const [items, downloads] = await Promise.all([
    prisma.transferItem.findMany({
      where: {
        OR: [{ sourceDiskId: { in: ids } }, { targetDiskId: { in: ids } }],
        AND: [{ OR: [{ state: { in: unfinishedStates } }, { updatedAt: { gte: earliest } }] }],
        state: { not: "cancelled" }
      },
      select: { state: true, sourceDiskId: true, targetDiskId: true, sizeBytes: true, stagedAt: true, deliveredAt: true, updatedAt: true, job: { select: { status: true } } }
    }),
    prisma.downloadQueue.findMany({
      where: { status: { in: ["queued", "downloading"] }, videoFile: { diskId: { in: ids } } },
      select: { videoFile: { select: { diskId: true } } }
    })
  ]);
  const downloadsByDisk = new Map<string, number>();
  for (const entry of downloads) downloadsByDisk.set(entry.videoFile.diskId, (downloadsByDisk.get(entry.videoFile.diskId) ?? 0) + 1);
  const work = connectedWork(items.map((item) => ({
    state: item.state as TransferState,
    jobStatus: item.job.status,
    sourceDiskId: item.sourceDiskId,
    targetDiskId: item.targetDiskId,
    sizeBytes: Number(item.sizeBytes),
    stagedAt: item.stagedAt,
    deliveredAt: item.deliveredAt,
    updatedAt: item.updatedAt
  })), connected, downloadsByDisk);
  const byId = new Map(disks.map((disk) => [disk.id, disk]));
  return {
    remaining: work.remaining,
    total: work.total,
    disks: work.disks.map((disk) => ({
      ...disk,
      since: new Date(disk.since).toISOString(),
      diskName: byId.get(disk.diskId)?.name ?? "",
      driveLetter: byId.get(disk.diskId)?.driveLetter ?? null
    }))
  };
}

const recentLimit = 12;

// The header activity indicator: what every Companion is doing now, what is waiting and what just happened.
// What the header needs for "Detener traslados": a Companion to tell, what its transfers are doing
// and an order it has not acted on yet.
async function transfersControl() {
  const { live, mode } = companionTransfers();
  const orders = await transferOrders();
  return { live, mode, pending: live ? pendingTransferOrder(orders, mode) : null };
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  // "Detener traslados": the Companion finishes the file in progress and starts no other transfer;
  // downloads go on. It lasts until "Reanudar traslados" or until the Companion restarts.
  for (const order of ["stop", "resume"] as const) {
    app.post(`/api/transfers/companion/${order}`, { preHandler: requireWebAuth }, async () => {
      await requestTransfers(order);
      await recordAction({ action: order === "stop" ? "transfers.stop" : "transfers.resume", actorType: "web", actorId: "admin", target: "Companion" });
      return { ok: true, transfers: await transfersControl() };
    });
  }

  app.get("/api/activity", { preHandler: requireWebAuth }, async () => {
    const [transfersWaiting, downloadsQueued, delivered, downloads, deletions, scans, connected] = await Promise.all([
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
      }),
      connectedDrivesWork()
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
      companions: liveActivity().map((entry) => ({ companionId: entry.companionId, companionName: entry.companionName, activities: entry.activities, reportedAt: entry.reportedAt, transfersWaiting: entry.transfersWaiting })),
      transfersWaitingForDownloads: transfersWaitingForDownloads(),
      transfers: await transfersControl(),
      waiting: { transfers: transfersWaiting, downloads: downloadsQueued },
      connected,
      recent
    };
  });
}
