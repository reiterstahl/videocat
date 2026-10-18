import assert from "node:assert/strict";
import test from "node:test";
import { clearRisky, fileTimeoutSeconds, isRiskyNow, markRisky, withDeadline, type RiskyFiles } from "../../apps/agent-windows/src/scan-watchdog.ts";

test("a file that never answers is left behind after its deadline, and its work is told to stop", async () => {
  let aborted = false;
  const result = await withDeadline((signal) => new Promise<string>(() => {
    signal.addEventListener("abort", () => {
      aborted = true;
    });
  }), 30);
  assert.deepEqual(result, { done: false });
  assert.equal(aborted, true);
});

test("a file that answers in time keeps its result, errors included", async () => {
  assert.deepEqual(await withDeadline(async () => "ok", 1000), { done: true, value: "ok" });
  await assert.rejects(withDeadline(async () => {
    throw new Error("ffprobe failed");
  }, 1000), /ffprobe failed/);
});

test("files at risk are skipped until their retry time passes, and leave the list once read again", () => {
  const risky: RiskyFiles = {};
  const now = Date.parse("2026-10-18T10:00:00Z");
  markRisky(risky, "Videos/bad.mp4", "no respondió", now);
  assert.equal(isRiskyNow(risky, "Videos/bad.mp4", now + 29 * 24 * 3600 * 1000), true);
  assert.equal(isRiskyNow(risky, "Videos/bad.mp4", now + 31 * 24 * 3600 * 1000), false, "retried after 30 days");
  assert.equal(isRiskyNow(risky, "Videos/other.mp4", now), false);
  assert.equal(isRiskyNow(undefined, "Videos/bad.mp4", now), false);
  clearRisky(risky, "Videos/bad.mp4");
  assert.deepEqual(risky, {});
});

test("the per-file deadline from the settings stays within sensible bounds", () => {
  assert.equal(fileTimeoutSeconds(undefined), 180);
  assert.equal(fileTimeoutSeconds("5"), 30);
  assert.equal(fileTimeoutSeconds("99999"), 3600);
  assert.equal(fileTimeoutSeconds("abc"), 180);
  assert.equal(fileTimeoutSeconds("240"), 240);
});
