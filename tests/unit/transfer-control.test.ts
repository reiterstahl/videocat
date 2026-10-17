import assert from "node:assert/strict";
import test from "node:test";
import { pendingTransferOrder, transferOrderPendingMs } from "../../apps/server/src/lib/transfer-control.ts";
import { companionTransfers, resetActivity, storeActivity } from "../../apps/server/src/lib/companion-activity.ts";

test("an order is pending until the Companion reports it, and only for a while", () => {
  const now = 1_000_000;
  assert.equal(pendingTransferOrder({ stopRequestedAt: now - 1000, resumeRequestedAt: 0 }, "running", now), "stop");
  assert.equal(pendingTransferOrder({ stopRequestedAt: now - 1000, resumeRequestedAt: 0 }, "stopping", now), null);
  assert.equal(pendingTransferOrder({ stopRequestedAt: now - 5000, resumeRequestedAt: now - 1000 }, "stopped", now), "resume");
  assert.equal(pendingTransferOrder({ stopRequestedAt: now - 5000, resumeRequestedAt: now - 1000 }, "running", now), null);
  assert.equal(pendingTransferOrder({ stopRequestedAt: now - transferOrderPendingMs - 1, resumeRequestedAt: 0 }, "running", now), null, "an order never confirmed stops showing");
  assert.equal(pendingTransferOrder({ stopRequestedAt: 0, resumeRequestedAt: 0 }, "running", now), null);
});

test("the header shows what the reporting Companions' transfers are doing", () => {
  resetActivity();
  assert.deepEqual(companionTransfers(1000), { live: false, mode: "running" });
  storeActivity("a", "PC", [], 1000, false, "running");
  storeActivity("b", "Laptop", [], 1000, false, "stopping");
  assert.deepEqual(companionTransfers(2000), { live: true, mode: "stopping" });
  storeActivity("b", "Laptop", [], 1500, false, "stopped");
  assert.deepEqual(companionTransfers(2000), { live: true, mode: "stopped" });
  assert.deepEqual(companionTransfers(1500 + 31_000), { live: false, mode: "running" }, "a Companion that left no longer counts");
  resetActivity();
});
