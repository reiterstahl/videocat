import assert from "node:assert/strict";
import test from "node:test";

import { activitiesSchema, liveActivity, resetActivity, storeActivity } from "../../apps/server/src/lib/companion-activity.ts";
import { ActivityReporter } from "../../apps/agent-windows/src/activity.ts";

const copying = { kind: "transfer" as const, phase: "staging" as const, filename: "clip.mp4", bytesDone: 10, bytesTotal: 100, startedAt: 1 };

test("live activity expires when a Companion stops reporting", () => {
  resetActivity();
  storeActivity("a", "PC", [copying], 1_000);
  storeActivity("b", "Laptop", [], 1_000);
  assert.deepEqual(liveActivity(10_000).map((entry) => entry.companionId), ["a"], "idle Companions are not listed");
  assert.deepEqual(liveActivity(40_000), []);
});

test("reported activity is bounded", () => {
  assert.equal(activitiesSchema.safeParse([copying]).success, true);
  assert.equal(activitiesSchema.safeParse([{ ...copying, kind: "format_disk" }]).success, false);
  assert.equal(activitiesSchema.safeParse([{ ...copying, filename: "x".repeat(301) }]).success, false);
  assert.equal(activitiesSchema.safeParse(Array.from({ length: 21 }, () => copying)).success, false);
});

test("the Companion reporter measures speed and sends once per interval", async () => {
  let now = 0;
  const sent: unknown[][] = [];
  const reporter = new ActivityReporter(async (activities) => { sent.push(activities); }, 60_000, () => now);
  reporter.set("t", { kind: "transfer", phase: "staging", filename: "a", bytesDone: 0, bytesTotal: 100 });
  now = 2000;
  reporter.set("t", { kind: "transfer", phase: "staging", filename: "a", bytesDone: 50, bytesTotal: 100 });
  const [current] = reporter.snapshot();
  assert.equal(current.bytesPerSecond, 25);
  assert.equal(current.startedAt, 0, "the same phase keeps its start");
  await reporter.flush();
  assert.equal(sent.length, 1);
  await reporter.flush();
  assert.equal(sent.length, 1, "nothing new, nothing sent");
  reporter.set("t", { kind: "transfer", phase: "verifying_staging", filename: "a", bytesDone: 0, bytesTotal: 100 });
  assert.equal(reporter.snapshot()[0].bytesPerSecond, null, "a new phase restarts the speed");
  reporter.clear("t");
  await reporter.flush();
  assert.deepEqual(sent.at(-1), []);
});
