import assert from "node:assert/strict";
import test from "node:test";
import { companionRestartDelayMs, companionRunWasStable } from "../../apps/agent-windows/src/companion-supervisor.ts";

test("backs off repeated Companion restarts and caps the delay", () => {
  assert.deepEqual(
    Array.from({ length: 7 }, (_value, index) => companionRestartDelayMs(index)),
    [2_000, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000]
  );
});

test("resets restart backoff after a stable Companion run", () => {
  assert.equal(companionRunWasStable(1_000, 300_999), false);
  assert.equal(companionRunWasStable(1_000, 301_000), true);
});
