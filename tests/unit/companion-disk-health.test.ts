import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HealthMonitor, healthDebounceMs, healthForDrives, healthIntervalMs, readCollectedHealth, type CollectedHealth } from "../../apps/agent-windows/src/disk-health.ts";

const report = (serial: string, reallocated: number) => JSON.stringify({
  model_name: `Disk ${serial}`, serial_number: serial, smart_status: { passed: true },
  ata_smart_attributes: { table: [{ id: 5, name: "Reallocated_Sector_Ct", raw: { value: reallocated } }] }
});

// What smart-collect.ps1 writes: C: on disk 0, E: and F: on disk 1, G: on disk 2 (behind a
// device name smartctl does not number), H: on disk 3 (an adapter that blocks SMART).
const collected: CollectedHealth = {
  collectedAt: "2026-10-23T12:00:00.000Z",
  volumes: [
    { driveLetter: "C", diskNumber: 0 }, { driveLetter: "E", diskNumber: 1 }, { driveLetter: "F", diskNumber: 1 },
    { driveLetter: "G", diskNumber: 2 }, { driveLetter: "H", diskNumber: 3 }
  ],
  physicalDisks: [{ number: 0, serialNumber: "SYS" }, { number: 1, serialNumber: "WX12" }, { number: 2, serialNumber: " nvme-77 " }, { number: 3, serialNumber: null }],
  disks: [
    { device: "/dev/sda", diskNumber: 0, report: report("SYS", 0) },
    { device: "/dev/sdb", diskNumber: 1, report: report("WX12", 8) },
    { device: "/dev/csmi0,1", diskNumber: null, report: report("NVME-77", 0) },
    { device: "/dev/sdd", diskNumber: 3, report: "not json" }
  ]
};

test("each connected drive gets the report of the disk its letter is on", () => {
  const disks = healthForDrives(collected, [
    { diskId: "elements", root: "E:\\" },
    { diskId: "elements", root: "F:\\Videos" },
    { diskId: "samsung", root: "g:\\" },
    { diskId: "lacie", root: "H:\\" },
    { diskId: "network", root: "\\\\nas\\videos" }
  ]);
  assert.deepEqual(disks.map((disk) => [disk.diskId, disk.report?.serial ?? null]), [["elements", "WX12"], ["samsung", "NVME-77"], ["lacie", null]]);
  assert.equal(disks[0].report?.attributes[0].raw, 8);
  assert.equal(disks[0].checkedAt, "2026-10-23T12:00:00.000Z");
});

test("the results file is read with or without a byte order mark, and a broken one is ignored", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-health-"));
  try {
    const file = path.join(dir, "smart.json");
    await fs.writeFile(file, `\uFEFF${JSON.stringify(collected)}`);
    assert.equal((await readCollectedHealth(file))?.disks.length, 4);
    await fs.writeFile(file, "{ half");
    assert.equal(await readCollectedHealth(file), null);
    assert.equal(await readCollectedHealth(path.join(dir, "missing.json")), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a check starts when a drive connects, waits a little for others, and repeats every 6 hours", () => {
  const monitor = new HealthMonitor();
  const start = 1_000_000_000;
  monitor.observe([]);
  assert.equal(monitor.shouldRun(start), false, "nothing connected, nothing to check");
  monitor.observe(["a"]);
  assert.equal(monitor.shouldRun(start), true);
  monitor.started(start);
  monitor.observe(["a", "b"]);
  assert.equal(monitor.shouldRun(start + 30_000), false, "a second drive right after waits");
  assert.equal(monitor.shouldRun(start + healthDebounceMs), true);
  monitor.started(start + healthDebounceMs);
  monitor.observe(["a", "b"]);
  assert.equal(monitor.shouldRun(start + healthDebounceMs + 60_000), false);
  assert.equal(monitor.shouldRun(start + healthDebounceMs + healthIntervalMs), true);
  // Unplugged and plugged in again: checked again.
  monitor.started(start + healthDebounceMs + healthIntervalMs);
  monitor.observe(["a"]);
  monitor.observe(["a", "b"]);
  assert.equal(monitor.shouldRun(start + 2 * healthDebounceMs + healthIntervalMs), true);
});

test("each collection is sent once", () => {
  const monitor = new HealthMonitor();
  assert.equal(monitor.isNew(collected), true);
  monitor.sent(collected);
  assert.equal(monitor.isNew(collected), false);
  assert.equal(monitor.isNew({ ...collected, collectedAt: "2026-10-23T18:00:00.000Z" }), true);
});
