import assert from "node:assert/strict";
import test from "node:test";
import { groupNeeds, needGroupTotals } from "../../apps/web/src/lib/transfers.ts";
import type { TransferNeed } from "../../apps/web/src/types.ts";

function need(kind: TransferNeed["kind"], diskName: string, bytes: number, connected = false): TransferNeed {
  return { kind, diskId: `id-${diskName}`, diskName, driveLetter: null, files: 1, bytes, connected, detail: null };
}

const needs = [
  need("connect_source", "RQR-08E", 50),
  need("connect_target", "RQR-ARI", 10, true),
  need("connect_source", "RQR-LUI", 300, true),
  need("connect_target", "RQR-MSD", 400),
  need("space_short", "RQR-NIN", 100),
  need("connect_target", "RQR-NIN", 200)
];

test("drives that receive files come apart from the ones that copy to staging", () => {
  const { receiving, sending } = groupNeeds(needs, "data");
  assert.deepEqual(sending.map((item) => item.diskName), ["RQR-LUI", "RQR-08E"]);
  assert.equal(receiving.every((item) => item.kind !== "connect_source"), true);
});

test("by default the drive that has to receive the most data comes first, its notices together", () => {
  const { receiving } = groupNeeds(needs, "data");
  // RQR-NIN counts its largest notice (200): its notices overlap.
  assert.deepEqual(receiving.map((item) => `${item.diskName}:${item.kind}`), [
    "RQR-MSD:connect_target",
    "RQR-NIN:space_short",
    "RQR-NIN:connect_target",
    "RQR-ARI:connect_target"
  ]);
});

test("group totals count each drive once", () => {
  const { receiving, sending } = groupNeeds(needs, "data");
  assert.deepEqual(needGroupTotals(receiving), { disks: 3, bytes: 610 });
  assert.deepEqual(needGroupTotals(sending), { disks: 2, bytes: 350 });
});

test("other orders: connected drives first, or by name", () => {
  assert.deepEqual(groupNeeds(needs, "connected").receiving.map((item) => item.diskName), ["RQR-ARI", "RQR-MSD", "RQR-NIN", "RQR-NIN"]);
  assert.deepEqual(groupNeeds(needs, "name").sending.map((item) => item.diskName), ["RQR-08E", "RQR-LUI"]);
});
