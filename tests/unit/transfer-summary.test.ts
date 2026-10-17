import assert from "node:assert/strict";
import test from "node:test";

import { diskMovement, stagingBytes, transferNeeds, type SummaryItem } from "../../apps/server/src/lib/transfer-summary.ts";

function item(overrides: Partial<SummaryItem>): SummaryItem {
  return { state: "pending", sourceDiskId: "f", targetDiskId: "e", sizeBytes: 100, jobStatus: "active", error: null, updatedAt: new Date(0), ...overrides };
}

test("needs group files by drive and put freeing space first", () => {
  const needs = transferNeeds([
    item({ state: "pending", sizeBytes: 10 }),
    item({ state: "staged", sizeBytes: 20 }),
    item({ state: "source_removed", sizeBytes: 300 }),
    item({ state: "delivering", sizeBytes: 50 }),
    item({ state: "blocked_space", targetDiskId: "g", sizeBytes: 5, error: "old", updatedAt: new Date(1) }),
    item({ state: "blocked_space", targetDiskId: "g", sizeBytes: 5, error: "Faltan 2 GB", updatedAt: new Date(2) }),
    item({ state: "done", sizeBytes: 999 })
  ], new Set(["f"])).map(({ movement: _movement, ...need }) => need);
  assert.deepEqual(needs, [
    { kind: "free_space", diskId: "g", files: 2, bytes: 10, connected: false, detail: "Faltan 2 GB" },
    { kind: "connect_target", diskId: "e", files: 2, bytes: 350, connected: false, detail: null },
    { kind: "connect_source", diskId: "f", files: 2, bytes: 30, connected: true, detail: null }
  ]);
});

test("paused transfers do not ask for their source drive", () => {
  assert.deepEqual(transferNeeds([item({ jobStatus: "paused" }), item({ jobStatus: "cancelled" })], new Set()), []);
  // A file already in staging still needs its destination even if the transfer was paused.
  assert.equal(transferNeeds([item({ state: "source_removed", jobStatus: "paused" })], new Set())[0]?.kind, "connect_target");
});

test("staging bytes count only files whose copy lives in the staging folder", () => {
  const states = ["pending", "staging", "staged", "source_removed", "blocked_space", "delivering", "delivered", "done"] as const;
  assert.equal(stagingBytes(states.map((state) => item({ state, sizeBytes: 1 }))), 5);
});

test("files heading to a drive without room by its last scan ask to free space, without blocking anything", () => {
  const items = [
    item({ state: "source_removed", targetDiskId: "e", sizeBytes: 600 }),
    item({ state: "pending", targetDiskId: "e", sizeBytes: 300 }),
    item({ state: "pending", targetDiskId: "e", sizeBytes: 999, jobStatus: "paused" }),
    item({ state: "delivered", targetDiskId: "e", sizeBytes: 5000 })
  ];
  const short = transferNeeds(items, new Set(), [{ diskId: "e", roomBytes: 700 }]).find((need) => need.kind === "space_short");
  assert.deepEqual(short && [short.files, short.bytes, short.shortBytes], [2, 900, 200], "paused pending and delivered files do not count");
  assert.equal(transferNeeds(items, new Set(), [{ diskId: "e", roomBytes: 900 }]).some((need) => need.kind === "space_short"), false);
  assert.equal(transferNeeds(items, new Set(), [{ diskId: "e", roomBytes: null }]).some((need) => need.kind === "space_short"), false, "unscanned drives are measured when connected");
  // A live "free space" request for the same drive already covers it.
  const blocked = [...items, item({ state: "blocked_space", targetDiskId: "e", sizeBytes: 10 })];
  assert.deepEqual(transferNeeds(blocked, new Set(), [{ diskId: "e", roomBytes: 0 }]).map((need) => need.kind), ["free_space", "connect_target", "connect_source"]);
});

test("each drive shows what is still to be copied onto it and what will leave it", () => {
  const items = [
    item({ state: "pending", sourceDiskId: "f", targetDiskId: "e", sizeBytes: 10, filename: "chico.mp4" }),
    item({ state: "staged", sourceDiskId: "f", targetDiskId: "e", sizeBytes: 30, filename: "grande.mp4" }),
    item({ state: "source_removed", sourceDiskId: "f", targetDiskId: "e", sizeBytes: 20, filename: "en-temporal.mp4" }),
    item({ state: "pending", sourceDiskId: "f", targetDiskId: "e", sizeBytes: 99, jobStatus: "paused", filename: "pausado.mp4" }),
    item({ state: "delivered", sourceDiskId: "f", targetDiskId: "e", sizeBytes: 5, filename: "ya.mp4" })
  ];
  const source = diskMovement(items, "f");
  assert.deepEqual([source.outgoing.files, source.outgoing.bytes, source.outgoing.names], [2, 40, ["grande.mp4", "chico.mp4"]], "largest first; paused and already gone files are not counted");
  assert.equal(source.incoming.files, 0);
  const target = diskMovement(items, "e");
  assert.deepEqual([target.incoming.files, target.incoming.bytes], [3, 60], "staging and pending files still have to be copied there");
  assert.equal(target.outgoing.files, 0);
  assert.ok(transferNeeds(items, new Set()).every((need) => need.movement), "every need carries its drive's movement");
});
