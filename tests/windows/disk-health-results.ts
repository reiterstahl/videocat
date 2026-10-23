// Run by CI on a Windows runner after the drive health task wrote its results: reads them with the
// Companion's own code and evaluates them like the server does.
import assert from "node:assert/strict";
import { evaluateSmartReport } from "../../packages/shared/src/disk-health.ts";
import { healthForDrives, healthResultsPath, readCollectedHealth } from "../../apps/agent-windows/src/disk-health.ts";

const collected = await readCollectedHealth();
assert.ok(collected, `No readable results in ${healthResultsPath()}`);
assert.ok(collected.volumes.some((volume) => volume.driveLetter.toUpperCase() === "C"), "The results map drive C: to a disk number");
console.log(`Collected ${collected.disks.length} device(s) at ${collected.collectedAt}: ${collected.disks.map((disk) => `${disk.device} (disk ${disk.diskNumber})`).join(", ")}`);

const [system] = healthForDrives(collected, [{ diskId: "system", root: "C:\\" }]);
assert.ok(system, "Drive C: has an entry");
const evaluation = system.report ? evaluateSmartReport(system.report) : null;
console.log(`C: ${evaluation ? `${evaluation.status} · ${evaluation.model ?? "unknown model"}` : "no SMART data through this disk's controller"}`);
if (system.report?.messages.length) console.log(`smartctl: ${system.report.messages.join(" | ")}`);
