import assert from "node:assert/strict";
import test from "node:test";

import { compactSmartReport, evaluateSmartReport } from "../../packages/shared/src/disk-health.ts";

// Shapes of `smartctl -x -j` (smartmontools 7.x JSON output), trimmed to what matters.
function ataReport(raws: Record<number, number>, passed = true, temperature = 38) {
  return {
    smartctl: { version: [7, 5], exit_status: 0, messages: [] },
    device: { name: "/dev/sdb", type: "sat", protocol: "ATA" },
    model_family: "Western Digital Elements / My Passport (USB, AF)",
    model_name: "WDC WD40NMZW-11GX6S1",
    serial_number: "WX12A3456789",
    smart_status: { passed },
    temperature: { current: temperature },
    power_on_time: { hours: 21_345 },
    ata_smart_attributes: {
      table: [
        { id: 1, name: "Raw_Read_Error_Rate", raw: { value: 0, string: "0" } },
        ...Object.entries(raws).map(([id, value]) => ({ id: Number(id), name: `Attr_${id}`, raw: { value, string: String(value) } }))
      ]
    }
  };
}

test("a healthy drive is good and keeps its counters", () => {
  const evaluation = evaluateSmartReport(compactSmartReport(ataReport({ 5: 0, 197: 0, 198: 0, 199: 0 })));
  assert.equal(evaluation.status, "good");
  assert.deepEqual(evaluation.items, []);
  assert.deepEqual(evaluation.counters, { reallocated: 0, pending: 0, uncorrectable: 0 });
  assert.equal(evaluation.model, "WDC WD40NMZW-11GX6S1");
  assert.equal(evaluation.powerOnHours, 21_345);
});

test("reallocated or pending sectors, cable errors and heat call for attention", () => {
  const evaluation = evaluateSmartReport(compactSmartReport(ataReport({ 5: 8, 197: 2, 199: 14 }, true, 57)));
  assert.equal(evaluation.status, "attention");
  assert.deepEqual(evaluation.items.map((item) => item.key), ["reallocated", "pending", "crc", "temperature"]);
});

test("uncorrectable sectors or a failed SMART verdict mean a probable failure", () => {
  assert.equal(evaluateSmartReport(compactSmartReport(ataReport({ 198: 1 }))).status, "failing");
  assert.equal(evaluateSmartReport(compactSmartReport(ataReport({ 187: 3 }))).status, "failing");
  const failed = evaluateSmartReport(compactSmartReport(ataReport({}, false)));
  assert.equal(failed.status, "failing");
  assert.equal(failed.items[0].key, "smart");
});

test("damaged sectors that grew since the previous check mean a probable failure", () => {
  const growing = evaluateSmartReport(compactSmartReport(ataReport({ 5: 12, 197: 0 })), { reallocated: 8, pending: 0 });
  assert.equal(growing.status, "failing");
  assert.ok(growing.items.some((item) => item.key === "reallocatedGrowing" && item.value === "8 → 12"));
  assert.equal(evaluateSmartReport(compactSmartReport(ataReport({ 5: 8 })), { reallocated: 8 }).status, "attention");
});

test("NVMe drives are judged by their health log", () => {
  const nvme = (log: Record<string, number>) => compactSmartReport({
    device: { name: "/dev/sda", type: "nvme", protocol: "NVMe" },
    model_name: "Samsung SSD 980 1TB",
    smart_status: { passed: true },
    nvme_smart_health_information_log: { critical_warning: 0, available_spare: 100, available_spare_threshold: 10, percentage_used: 3, media_errors: 0, ...log }
  });
  assert.equal(evaluateSmartReport(nvme({})).status, "good");
  assert.equal(evaluateSmartReport(nvme({ percentage_used: 93 })).status, "attention");
  assert.equal(evaluateSmartReport(nvme({ media_errors: 2 })).status, "attention");
  assert.equal(evaluateSmartReport(nvme({ critical_warning: 4 })).status, "failing");
  assert.equal(evaluateSmartReport(nvme({ available_spare: 5 })).status, "failing");
});

test("a USB adapter that does not pass SMART through leaves the drive without data", () => {
  const blocked = compactSmartReport({
    smartctl: { exit_status: 1, messages: [{ string: "/dev/sdc: Unknown USB bridge [0x0bc2:0x2344 (0x1101)]", severity: "error" }] },
    device: { name: "/dev/sdc", type: "scsi", protocol: "SCSI" }
  });
  assert.deepEqual(blocked.messages, ["/dev/sdc: Unknown USB bridge [0x0bc2:0x2344 (0x1101)]"]);
  assert.equal(evaluateSmartReport(blocked).status, "unavailable");
});
