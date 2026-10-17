import type { TransferState } from "./transfer-states.js";

// Since when each drive identifier is reported as connected, per Companion. Kept in memory:
// after a server restart, "since" starts again at the first heartbeat.
const mountedSince = new Map<string, Map<string, number>>();

export function noteMountedDisks(companionKey: string, identifiers: readonly string[], now = Date.now()): void {
  const previous = mountedSince.get(companionKey) ?? new Map<string, number>();
  const next = new Map<string, number>();
  for (const identifier of identifiers) next.set(identifier, previous.get(identifier) ?? now);
  mountedSince.set(companionKey, next);
}

// The earliest time any Companion has reported each identifier without a break.
export function mountedSinceByIdentifier(): Map<string, number> {
  const result = new Map<string, number>();
  for (const identifiers of mountedSince.values()) {
    for (const [identifier, since] of identifiers) result.set(identifier, Math.min(result.get(identifier) ?? since, since));
  }
  return result;
}

export function clearMountedDisks(): void {
  mountedSince.clear();
}

export type WorkItem = {
  state: TransferState;
  jobStatus: string;
  sourceDiskId: string;
  targetDiskId: string;
  sizeBytes: number;
  stagedAt: Date | null;
  deliveredAt: Date | null;
  updatedAt: Date;
};

export type WorkAmount = { files: number; bytes: number };

export type ConnectedDiskWork = {
  diskId: string;
  since: number;
  // Still to do with this drive: files to copy off it and files to copy onto it.
  remaining: WorkAmount;
  outgoing: WorkAmount;
  incoming: WorkAmount;
  // Done with this drive since it was connected; total = remaining + done.
  done: WorkAmount;
  total: WorkAmount;
  // Waiting in staging because this drive has no room: safe to disconnect, they stay in staging.
  blocked: WorkAmount;
  // Downloads still queued from this drive.
  downloads: number;
  canDisconnect: boolean;
};

const leavesSource: TransferState[] = ["pending", "staging", "staged"];
const leftSource: TransferState[] = ["source_removed", "blocked_space", "delivering", "delivered", "done", "duplicate"];
const ontoTarget: TransferState[] = ["source_removed", "delivering"];
const reachedTarget: TransferState[] = ["delivered", "done", "duplicate"];

function add(amount: WorkAmount, item: WorkItem): void {
  amount.files += 1;
  amount.bytes += item.sizeBytes;
}

function empty(): WorkAmount {
  return { files: 0, bytes: 0 };
}

// What can still move with the drives connected right now, per drive and overall: "faltan x de y".
// A file counts for its source drive until it leaves it (verified in staging and removed there), and
// for its destination once it can be copied there: already in staging, or its source is connected too.
export function connectedWork(
  items: readonly WorkItem[],
  connected: ReadonlyMap<string, number>,
  downloadsByDisk: ReadonlyMap<string, number> = new Map()
): { disks: ConnectedDiskWork[]; remaining: WorkAmount; total: WorkAmount } {
  const perDisk = new Map<string, ConnectedDiskWork>();
  for (const [diskId, since] of connected) {
    perDisk.set(diskId, { diskId, since, remaining: empty(), outgoing: empty(), incoming: empty(), done: empty(), total: empty(), blocked: empty(), downloads: downloadsByDisk.get(diskId) ?? 0, canDisconnect: false });
  }
  const overallRemaining = empty();
  const overallDone = empty();

  for (const item of items) {
    const runnable = item.jobStatus === "active" || item.state !== "pending";
    const source = perDisk.get(item.sourceDiskId);
    const target = perDisk.get(item.targetDiskId);
    let remains = false;
    let done = false;

    if (source) {
      if (leavesSource.includes(item.state) && runnable) {
        add(source.outgoing, item);
        add(source.remaining, item);
        remains = true;
      } else if (leftSource.includes(item.state) && (item.stagedAt ?? item.updatedAt).getTime() >= source.since) {
        add(source.done, item);
        done = true;
      }
    }
    if (target) {
      const onItsWay = ontoTarget.includes(item.state) || (Boolean(source) && leavesSource.includes(item.state) && runnable);
      if (onItsWay) {
        add(target.incoming, item);
        add(target.remaining, item);
        remains = true;
      } else if (item.state === "blocked_space") {
        add(target.blocked, item);
      } else if (reachedTarget.includes(item.state) && (item.deliveredAt ?? item.updatedAt).getTime() >= target.since) {
        add(target.done, item);
        done = true;
      }
    }
    // Overall, a file counts once even when both of its drives are connected.
    if (remains) add(overallRemaining, item);
    else if (done) add(overallDone, item);
  }

  const disks = [...perDisk.values()].map((disk) => ({
    ...disk,
    total: { files: disk.remaining.files + disk.done.files, bytes: disk.remaining.bytes + disk.done.bytes },
    canDisconnect: disk.remaining.files === 0 && disk.downloads === 0
  }));
  disks.sort((left, right) => right.remaining.bytes - left.remaining.bytes || right.total.bytes - left.total.bytes);
  return {
    disks,
    remaining: overallRemaining,
    total: { files: overallRemaining.files + overallDone.files, bytes: overallRemaining.bytes + overallDone.bytes }
  };
}
