import assert from "node:assert/strict";
import test from "node:test";

import { canCompanionTransition, driveNeeded, isTransferState, stagingOnlyStates, transferStates } from "../../apps/server/src/lib/transfer-states.ts";

test("a file only leaves its source after a verified staging copy", () => {
  assert.equal(canCompanionTransition("pending", "source_removed"), false);
  assert.equal(canCompanionTransition("staging", "source_removed"), false);
  assert.equal(canCompanionTransition("staged", "source_removed"), true);
});

test("a staging copy is only removed after the destination copy is verified", () => {
  for (const state of stagingOnlyStates) assert.equal(canCompanionTransition(state, "done"), false, state);
  assert.equal(canCompanionTransition("delivering", "delivered"), true);
  assert.equal(canCompanionTransition("delivered", "done"), true);
});

test("steps that removed nothing can go back; finished states are final", () => {
  assert.equal(canCompanionTransition("staging", "pending"), true);
  assert.equal(canCompanionTransition("staged", "pending"), true);
  assert.equal(canCompanionTransition("source_removed", "pending"), false);
  for (const state of ["done", "duplicate", "cancelled"] as const) {
    for (const to of transferStates) assert.equal(canCompanionTransition(state, to), false, `${state} -> ${to}`);
  }
  assert.equal(canCompanionTransition("pending", "cancelled"), false, "only the web cancels");
});

test("states tell which drive the Companion needs", () => {
  assert.equal(driveNeeded("pending"), "source");
  assert.equal(driveNeeded("staged"), "source");
  assert.equal(driveNeeded("blocked_space"), "target");
  assert.equal(driveNeeded("delivered"), "none");
  assert.equal(isTransferState("lost"), false);
});
