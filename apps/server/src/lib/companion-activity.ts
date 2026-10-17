import { z } from "zod";

// What each Companion reports it is doing right now. Kept in memory: it is live information,
// it expires quickly and nothing depends on it surviving a restart.

const label = z.string().trim().max(300).nullable().optional();
const count = z.number().nonnegative().max(1e15).nullable().optional();

export const activitySchema = z.object({
  kind: z.enum(["transfer", "download", "scan", "delete"]),
  phase: z.enum(["staging", "verifying_staging", "delivering", "verifying_target", "downloading", "scanning", "deleting"]),
  filename: label,
  from: label,
  to: label,
  bytesDone: count,
  bytesTotal: count,
  filesDone: count,
  filesTotal: count,
  bytesPerSecond: count,
  startedAt: z.number().nonnegative().max(1e15)
});

export const activitiesSchema = z.array(activitySchema).max(20);

export type CompanionActivity = z.infer<typeof activitySchema>;

// transfersWaiting: the Companion's transfers stepped aside while its download queue runs.
// transfersMode: running, stopping (finishing its file after "Detener traslados") or stopped.
type Entry = {
  companionId: string;
  companionName: string | null;
  activities: CompanionActivity[];
  reportedAt: number;
  transfersWaiting: boolean;
  transfersMode: "running" | "stopping" | "stopped";
};

// A Companion that stops reporting (closed, asleep, offline) stops showing activity after this.
export const activityTtlMs = 30_000;

const entries = new Map<string, Entry>();

export function storeActivity(
  companionId: string,
  companionName: string | null,
  activities: CompanionActivity[],
  now = Date.now(),
  transfersWaiting = false,
  transfersMode: Entry["transfersMode"] = "running"
): void {
  entries.set(companionId, { companionId, companionName, activities, reportedAt: now, transfersWaiting, transfersMode });
}

export function liveActivity(now = Date.now()): Entry[] {
  const live: Entry[] = [];
  for (const [id, entry] of entries) {
    if (now - entry.reportedAt > activityTtlMs) entries.delete(id);
    else if (entry.activities.length > 0 || entry.transfersWaiting || entry.transfersMode !== "running") live.push(entry);
  }
  return live.sort((left, right) => (left.companionName ?? "").localeCompare(right.companionName ?? ""));
}

// What the reporting Companions' transfers are doing (stopped wins over stopping over running),
// and whether any Companion reported recently at all.
export function companionTransfers(now = Date.now()): { live: boolean; mode: Entry["transfersMode"] } {
  let live = false;
  let mode: Entry["transfersMode"] = "running";
  for (const [id, entry] of entries) {
    if (now - entry.reportedAt > activityTtlMs) {
      entries.delete(id);
      continue;
    }
    live = true;
    if (entry.transfersMode === "stopped" || (entry.transfersMode === "stopping" && mode === "running")) mode = entry.transfersMode;
  }
  return { live, mode };
}

// Transfers wait for downloads on some live Companion.
export function transfersWaitingForDownloads(now = Date.now()): boolean {
  return liveActivity(now).some((entry) => entry.transfersWaiting);
}

export function resetActivity(): void {
  entries.clear();
}
