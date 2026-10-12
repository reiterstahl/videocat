import assert from "node:assert/strict";
import test from "node:test";

import { stagingBytes, transferNeeds, type SummaryItem } from "../../apps/server/src/lib/transfer-summary.ts";

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
  ], new Set(["f"]));
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
