import assert from "node:assert/strict";
import test from "node:test";
import { orderTransferWork, stagingRoom } from "../../apps/server/src/lib/transfer-order.ts";

const item = (name: string, state: string, sizeBytes: number) => ({ name, state, sizeBytes });

test("files leave their drives before anything is delivered, and stop once off their drive", () => {
  const work = orderTransferWork([
    item("deliver-1", "source_removed", 10),
    item("pending-1", "pending", 10),
    item("cleanup", "delivered", 10),
    item("half-copied", "staging", 10),
    item("blocked", "blocked_space", 10),
    item("pending-2", "pending", 10)
  ], 100, 50);
  assert.deepEqual(work.map(({ item: entry, stopAt }) => `${entry.name}${stopAt ? "|stop" : ""}`), [
    "cleanup",
    "half-copied|stop",
    "pending-1|stop",
    "pending-2|stop",
    "deliver-1",
    "blocked"
  ]);
});

test("when the staging folder is full, deliveries go first and what does not fit waits behind them", () => {
  const work = orderTransferWork([
    item("big", "pending", 80),
    item("small", "pending", 15),
    item("deliver", "source_removed", 40)
  ], 30, 50);
  assert.deepEqual(work.map(({ item: entry, stopAt }) => `${entry.name}${stopAt ? "|stop" : ""}`), ["small|stop", "deliver", "big"]);
  const full = orderTransferWork([item("pending", "pending", 5), item("deliver", "delivering", 5)], 0, 50);
  assert.deepEqual(full.map(({ item: entry }) => entry.name), ["deliver", "pending"]);
});

test("bigint sizes, unknown room and the work limit", () => {
  const work = orderTransferWork([item("a", "pending", 1), { name: "b", state: "pending", sizeBytes: 2n }, item("c", "pending", 3)], null, 2);
  assert.deepEqual(work.map(({ item: entry, stopAt }) => [entry.name, stopAt]), [["a", "source_removed"], ["b", "source_removed"]]);
  assert.equal(stagingRoom({ freeBytes: 100, totalBytes: 1000 }), 50);
  assert.equal(stagingRoom({ freeBytes: "x" }), null);
  assert.equal(stagingRoom(null), null);
});
