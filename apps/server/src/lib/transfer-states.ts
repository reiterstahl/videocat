// A transferred file moves source drive -> Companion staging folder -> destination folder.
// Every transition is reported by the Companion that holds the file, after the step is done
// and verified, so the server state always describes where verified copies exist.

export const transferStates = [
  "pending", // Waiting for its source drive.
  "staging", // The Companion is copying it to the staging folder; the source is untouched.
  "staged", // Verified copy in staging; the source still exists.
  "source_removed", // Only the verified staging copy remains; waiting for the destination drive.
  "blocked_space", // Destination connected but without room; waiting for space.
  "delivering", // Copying from staging to the destination folder.
  "delivered", // Verified at the destination and the catalog points there; staging copy still kept.
  "done", // Staging copy removed.
  "duplicate", // An identical file already existed at the destination; staging copy removed.
  "cancelled" // Cancelled before anything was copied.
] as const;

export type TransferState = (typeof transferStates)[number];

const companionTransitions: Record<TransferState, TransferState[]> = {
  pending: ["staging", "pending"],
  // Back to pending when the copy failed or the source changed: nothing was removed yet.
  staging: ["staged", "pending"],
  // Back to pending when the source changed after the copy; the staging copy is discarded.
  staged: ["source_removed", "pending"],
  // Straight to duplicate when an identical file is already at the destination.
  source_removed: ["delivering", "blocked_space", "source_removed", "duplicate"],
  blocked_space: ["delivering", "blocked_space", "duplicate"],
  // Back to source_removed when a delivery attempt fails; the staging copy is still there.
  delivering: ["delivered", "duplicate", "source_removed"],
  delivered: ["done"],
  done: [],
  duplicate: [],
  cancelled: []
};

export function isTransferState(value: string): value is TransferState {
  return (transferStates as readonly string[]).includes(value);
}

export function canCompanionTransition(from: TransferState, to: TransferState): boolean {
  return companionTransitions[from].includes(to);
}

// States in which the file is not where the catalog says it was; scans must not hide it.
export const inTransitStates: TransferState[] = ["staging", "staged", "source_removed", "blocked_space", "delivering"];

// States that still need work; one active item per file at a time.
export const unfinishedStates: TransferState[] = ["pending", "staging", "staged", "source_removed", "blocked_space", "delivering", "delivered"];

// States in which the only copy lives in the Companion staging folder.
export const stagingOnlyStates: TransferState[] = ["source_removed", "blocked_space", "delivering"];

// The Companion needs the source drive for these states and the destination drive for the rest.
export function driveNeeded(state: TransferState): "source" | "target" | "none" {
  if (state === "pending" || state === "staging" || state === "staged") return "source";
  if (state === "source_removed" || state === "blocked_space" || state === "delivering") return "target";
  if (state === "delivered") return "none";
  return "none";
}

export function isFinished(state: TransferState): boolean {
  return state === "done" || state === "duplicate" || state === "cancelled";
}
