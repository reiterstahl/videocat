export type WorkCandidate = {
  state: string;
  sizeBytes: number | bigint;
};

export type OrderedWork<T> = { item: T; stopAt?: "source_removed" };

// The Companion always leaves this share of the staging drive free.
export const stagingReserveRatio = 0.05;

// Room left in the staging folder by the Companion's last report, keeping its reserve; null when unknown.
export function stagingRoom(staging: { freeBytes?: unknown; totalBytes?: unknown } | null): number | null {
  if (!staging || typeof staging.freeBytes !== "number" || typeof staging.totalBytes !== "number") return null;
  return staging.freeBytes - staging.totalBytes * stagingReserveRatio;
}

// Order of the Companion's work: files leave their drives first, so those drives get room for the
// files headed to them; deliveries come after. When the staging folder is full, deliveries go first
// to make room, and the files that did not fit wait until then.
//
// 1. finished deliveries whose staging copy only has to be removed (frees staging at once);
// 2. files already copied or being copied to staging (they hold room already);
// 3. files still on their drive that fit in the staging room left;
// 4. deliveries from staging to their destination;
// 5. files that did not fit, in case the deliveries made room.
// Groups 2 and 3 stop once off their drive: their delivery comes in the next round, after the rest left.
export function orderTransferWork<T extends WorkCandidate>(items: readonly T[], room: number | null, limit: number): Array<OrderedWork<T>> {
  const cleanups = items.filter((item) => item.state === "delivered");
  const inStaging = items.filter((item) => item.state === "staging" || item.state === "staged");
  const deliveries = items.filter((item) => item.state === "source_removed" || item.state === "blocked_space" || item.state === "delivering");
  const fitting: T[] = [];
  const waiting: T[] = [];
  let left = room ?? Number.POSITIVE_INFINITY;
  for (const item of items.filter((candidate) => candidate.state === "pending")) {
    const size = Number(item.sizeBytes);
    if (size <= left) {
      fitting.push(item);
      left -= size;
    } else {
      waiting.push(item);
    }
  }
  return [
    ...cleanups.map((item) => ({ item })),
    ...inStaging.map((item) => ({ item, stopAt: "source_removed" as const })),
    ...fitting.map((item) => ({ item, stopAt: "source_removed" as const })),
    ...deliveries.map((item) => ({ item })),
    ...waiting.map((item) => ({ item }))
  ].slice(0, limit);
}
