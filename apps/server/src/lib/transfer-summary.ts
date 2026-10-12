import type { TransferState } from "./transfer-states.js";

// AppSetting where the heartbeat keeps the Companion staging folder status.
export const companionStagingKey = "companion_staging";

export type SummaryItem = {
  state: TransferState;
  sourceDiskId: string;
  targetDiskId: string;
  sizeBytes: number;
  jobStatus: string;
  error: string | null;
  updatedAt: Date;
};

export type TransferNeed = {
  kind: "free_space" | "connect_target" | "connect_source";
  diskId: string;
  files: number;
  bytes: number;
  // The Companion reports this drive as connected: the work is already under way.
  connected: boolean;
  detail: string | null;
};

const kindOrder: Record<TransferNeed["kind"], number> = { free_space: 0, connect_target: 1, connect_source: 2 };

function needFor(item: SummaryItem): { kind: TransferNeed["kind"]; diskId: string } | null {
  switch (item.state) {
    case "pending":
      // Paused or cancelled transfers do not start new files.
      return item.jobStatus === "active" ? { kind: "connect_source", diskId: item.sourceDiskId } : null;
    case "staging":
    case "staged":
      return { kind: "connect_source", diskId: item.sourceDiskId };
    case "source_removed":
    case "delivering":
      return { kind: "connect_target", diskId: item.targetDiskId };
    case "blocked_space":
      return { kind: "free_space", diskId: item.targetDiskId };
    default:
      return null;
  }
}

// What the person has to do next, one entry per drive: free space, connect the destination
// (files already waiting in staging) or connect a source.
export function transferNeeds(items: SummaryItem[], connectedDiskIds: ReadonlySet<string>): TransferNeed[] {
  const needs = new Map<string, TransferNeed & { latest: number }>();
  for (const item of items) {
    const need = needFor(item);
    if (!need) continue;
    const key = `${need.kind}|${need.diskId}`;
    const current = needs.get(key) ?? { ...need, files: 0, bytes: 0, connected: connectedDiskIds.has(need.diskId), detail: null, latest: 0 };
    current.files += 1;
    current.bytes += item.sizeBytes;
    if (item.error && item.updatedAt.getTime() >= current.latest) {
      current.detail = item.error;
      current.latest = item.updatedAt.getTime();
    }
    needs.set(key, current);
  }
  return [...needs.values()]
    .map(({ latest: _latest, ...need }) => need)
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || right.bytes - left.bytes);
}

// Bytes that live in the Companion staging folder right now.
export function stagingBytes(items: SummaryItem[]): number {
  return items
    .filter((item) => ["staged", "source_removed", "blocked_space", "delivering", "delivered"].includes(item.state))
    .reduce((sum, item) => sum + item.sizeBytes, 0);
}
