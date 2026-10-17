import assert from "node:assert/strict";
import test from "node:test";
import { clearMountedDisks, connectedWork, mountedSinceByIdentifier, noteMountedDisks, type WorkItem } from "../../apps/server/src/lib/connected-work.ts";

const since = Date.parse("2026-10-17T10:00:00Z");
const before = new Date(since - 60_000);
const after = new Date(since + 60_000);

function item(state: WorkItem["state"], source: string, target: string, sizeBytes: number, extra: Partial<WorkItem> = {}): WorkItem {
  return { state, jobStatus: "active", sourceDiskId: source, targetDiskId: target, sizeBytes, stagedAt: null, deliveredAt: null, updatedAt: after, ...extra };
}

test("a connected source drive: faltan the files still to copy off it, de everything since it was connected", () => {
  const items = [
    item("pending", "A", "Z", 10),
    item("staging", "A", "Z", 20),
    item("staged", "A", "Z", 30),
    item("source_removed", "A", "Z", 40, { stagedAt: after }),
    item("source_removed", "A", "Z", 50, { stagedAt: before }),
    item("pending", "A", "Z", 60, { jobStatus: "paused" }),
    item("pending", "B", "Z", 70)
  ];
  const work = connectedWork(items, new Map([["A", since]]));
  const disk = work.disks[0];
  assert.deepEqual(disk.remaining, { files: 3, bytes: 60 });
  assert.deepEqual(disk.done, { files: 1, bytes: 40 }, "only what left it after it was connected");
  assert.deepEqual(disk.total, { files: 4, bytes: 100 });
  assert.equal(disk.canDisconnect, false);
  assert.deepEqual(work.remaining, { files: 3, bytes: 60 });
});

test("a connected destination counts what is in staging for it, and blocked files do not hold it", () => {
  const items = [
    item("source_removed", "A", "Z", 10),
    item("delivering", "A", "Z", 20),
    item("blocked_space", "A", "Z", 30),
    item("done", "A", "Z", 40, { deliveredAt: after }),
    item("pending", "A", "Z", 50)
  ];
  const work = connectedWork(items, new Map([["Z", since]]));
  const disk = work.disks[0];
  assert.deepEqual(disk.incoming, { files: 2, bytes: 30 }, "a file still on a disconnected source cannot arrive now");
  assert.deepEqual(disk.blocked, { files: 1, bytes: 30 });
  assert.deepEqual(disk.total, { files: 3, bytes: 70 });

  const finished = connectedWork([item("blocked_space", "A", "Z", 30), item("done", "A", "Z", 40, { deliveredAt: after })], new Map([["Z", since]]));
  assert.equal(finished.disks[0].canDisconnect, true);
  assert.deepEqual(finished.remaining, { files: 0, bytes: 0 });
  assert.deepEqual(finished.total, { files: 1, bytes: 40 });
});

test("with both drives connected a file counts for each drive but once overall", () => {
  const work = connectedWork([item("pending", "A", "Z", 10), item("done", "A", "Z", 5, { stagedAt: after, deliveredAt: after })], new Map([["A", since], ["Z", since]]));
  assert.deepEqual(work.disks.map((disk) => [disk.diskId, disk.remaining.files, disk.total.files]), [["A", 1, 2], ["Z", 1, 2]]);
  assert.deepEqual(work.remaining, { files: 1, bytes: 10 });
  assert.deepEqual(work.total, { files: 2, bytes: 15 });
});

test("queued downloads keep a drive from being ready to disconnect", () => {
  const work = connectedWork([], new Map([["A", since]]), new Map([["A", 2]]));
  assert.equal(work.disks[0].canDisconnect, false);
  assert.equal(work.disks[0].downloads, 2);
});

test("a drive keeps its first connection time until a heartbeat stops reporting it", () => {
  clearMountedDisks();
  noteMountedDisks("c1", ["vol-a", "vol-b"], 1000);
  noteMountedDisks("c1", ["vol-a"], 2000);
  noteMountedDisks("c1", ["vol-a", "vol-b"], 3000);
  assert.deepEqual([...mountedSinceByIdentifier()].sort(), [["vol-a", 1000], ["vol-b", 3000]]);
  clearMountedDisks();
});
