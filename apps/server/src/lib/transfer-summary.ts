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
  filename?: string;
};

export type TransferNeed = {
  // free_space: the destination is connected and full (live). space_short: by its last scan, the files
  // on their way will not fit; they still wait in staging, nothing is refused.
  kind: "free_space" | "space_short" | "connect_target" | "connect_source";
  diskId: string;
  files: number;
  bytes: number;
  // The Companion reports this drive as connected: the work is already under way.
  connected: boolean;
  detail: string | null;
  // space_short only: how much has to be freed on that drive.
  shortBytes?: number;
  // What is still due on that drive: files to copy onto it and files that will leave it.
  movement?: DiskMovement;
};

export type MovementSide = { files: number; bytes: number; names: string[] };
export type DiskMovement = { incoming: MovementSide; outgoing: MovementSide };

const movementNames = 6;

// What is left for one drive: files on their way to it (still to be copied there) and files that
// will leave it (their source copy is removed once the staging copy is verified).
export function diskMovement(items: SummaryItem[], diskId: string): DiskMovement {
  const side = (list: SummaryItem[]): MovementSide => ({
    files: list.length,
    bytes: list.reduce((sum, item) => sum + item.sizeBytes, 0),
    names: [...list].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, movementNames).flatMap((item) => (item.filename ? [item.filename] : []))
  });
  return {
    incoming: side(items.filter((item) => item.targetDiskId === diskId && headedToTarget.includes(item.state) && (item.jobStatus === "active" || item.state !== "pending"))),
    outgoing: side(items.filter((item) => item.sourceDiskId === diskId && ["pending", "staging", "staged"].includes(item.state) && (item.jobStatus === "active" || item.state !== "pending")))
  };
}

export type DiskRoom = { diskId: string; roomBytes: number | null };

const kindOrder: Record<TransferNeed["kind"], number> = { free_space: 0, space_short: 1, connect_target: 2, connect_source: 3 };

// Files that still have to reach their destination folder (delivered ones already did).
const headedToTarget: TransferState[] = ["pending", "staging", "staged", "source_removed", "blocked_space", "delivering"];

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
export function transferNeeds(items: SummaryItem[], connectedDiskIds: ReadonlySet<string>, disks: DiskRoom[] = []): TransferNeed[] {
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
  for (const disk of disks) {
    // A live "free space" request for that drive already says it.
    if (disk.roomBytes === null || needs.has(`free_space|${disk.diskId}`)) continue;
    const waiting = items.filter((item) => item.targetDiskId === disk.diskId && headedToTarget.includes(item.state) && (item.jobStatus === "active" || item.state !== "pending"));
    const bytes = waiting.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (waiting.length === 0 || bytes <= disk.roomBytes) continue;
    needs.set(`space_short|${disk.diskId}`, {
      kind: "space_short",
      diskId: disk.diskId,
      files: waiting.length,
      bytes,
      connected: connectedDiskIds.has(disk.diskId),
      detail: null,
      shortBytes: bytes - Math.max(0, disk.roomBytes),
      latest: 0
    });
  }
  return [...needs.values()]
    .map(({ latest: _latest, ...need }) => ({ ...need, movement: diskMovement(items, need.diskId) }))
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || right.bytes - left.bytes);
}

// Bytes that live in the Companion staging folder right now.
export function stagingBytes(items: SummaryItem[]): number {
  return items
    .filter((item) => ["staged", "source_removed", "blocked_space", "delivering", "delivered"].includes(item.state))
    .reduce((sum, item) => sum + item.sizeBytes, 0);
}
