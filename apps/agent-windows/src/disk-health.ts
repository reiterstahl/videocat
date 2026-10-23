import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { compactSmartReport, type DiskHealthUpload } from "@videocat/shared";

// Drive health (SMART). Windows only lets administrators read SMART, so "Salud de discos" in the
// Companion settings installs, once and with the user's consent (UAC), a scheduled task that runs
// smartctl with the highest privileges from Program Files (smart/smart-setup.ps1). The Companion
// never runs elevated: it starts that task and reads what it leaves in ProgramData.

const execFileAsync = promisify(execFile);

export const healthTask = "\\VideoCAT\\Salud de discos";
// Checked when a drive connects and then every 6 hours while it stays connected.
export const healthIntervalMs = 6 * 60 * 60 * 1000;
// A drive that connects right after a check waits a little, so plugging several in starts one.
export const healthDebounceMs = 2 * 60 * 1000;

export function healthResultsPath(): string {
  return path.join(process.env.ProgramData ?? "C:\\ProgramData", "VideoCAT", "smart", "smart.json");
}

// What smart-collect.ps1 writes: each drive's `smartctl -x -j` output as text, and how Windows
// numbers the drives and their letters, to tell which VideoCAT drive each report belongs to.
const collectedSchema = z.object({
  collectedAt: z.string(),
  volumes: z.array(z.object({ driveLetter: z.string(), diskNumber: z.number() })).default([]),
  physicalDisks: z.array(z.object({ number: z.number(), serialNumber: z.string().nullable().optional() })).default([]),
  disks: z.array(z.object({ device: z.string(), diskNumber: z.number().nullable(), report: z.string() })).default([])
});

export type CollectedHealth = z.infer<typeof collectedSchema>;

export async function readCollectedHealth(file = healthResultsPath()): Promise<CollectedHealth | null> {
  try {
    const text = (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "");
    return collectedSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function serialOf(report: unknown): string | null {
  const serial = (report as { serial_number?: unknown } | null)?.serial_number;
  return typeof serial === "string" && serial.trim() ? serial.trim().toLowerCase() : null;
}

// The report of each connected VideoCAT drive: its letter gives Windows' disk number, and that
// number (or, for devices smartctl names otherwise, the serial number) gives its report. A drive
// without one gets null: its adapter did not let SMART through.
export function healthForDrives(collected: CollectedHealth, drives: Array<{ diskId: string; root: string }>): DiskHealthUpload["disks"] {
  const reports = collected.disks.flatMap((disk) => {
    try {
      return [{ ...disk, parsed: JSON.parse(disk.report) as unknown }];
    } catch {
      return [];
    }
  });
  const seen = new Set<string>();
  const result: DiskHealthUpload["disks"] = [];
  for (const drive of drives) {
    if (seen.has(drive.diskId)) continue;
    seen.add(drive.diskId);
    const letter = path.win32.parse(drive.root).root.replace(/[:\\/]+$/, "").toUpperCase();
    const diskNumber = collected.volumes.find((volume) => volume.driveLetter.toUpperCase() === letter)?.diskNumber;
    if (diskNumber == null) continue;
    const serial = collected.physicalDisks.find((disk) => disk.number === diskNumber)?.serialNumber?.trim().toLowerCase() || null;
    const match = reports.find((report) => report.diskNumber === diskNumber)
      ?? (serial ? reports.find((report) => serialOf(report.parsed) === serial) : undefined);
    result.push({ diskId: drive.diskId, checkedAt: new Date(collected.collectedAt).toISOString(), report: match ? compactSmartReport(match.parsed) : null });
  }
  return result;
}

export async function healthTaskInstalled(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("schtasks.exe", ["/Query", "/TN", healthTask], { windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

// Starts a check; the task runs in the background and leaves its results in healthResultsPath().
export async function runHealthTask(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("schtasks.exe", ["/Run", "/TN", healthTask], { windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

// Decides when to start a check and which results are new, from the drives on each heartbeat.
export class HealthMonitor {
  private lastRunAt = 0;
  private mounted = new Set<string>();
  private connected = false;
  private lastSentAt: string | null = null;

  // The drives connected now; one that was not there on the previous heartbeat asks for a check.
  observe(diskIds: string[]): void {
    if (diskIds.some((id) => !this.mounted.has(id))) this.connected = true;
    this.mounted = new Set(diskIds);
  }

  shouldRun(now = Date.now()): boolean {
    if (this.mounted.size === 0) return false;
    const elapsed = now - this.lastRunAt;
    return (this.connected && elapsed >= healthDebounceMs) || elapsed >= healthIntervalMs;
  }

  started(now = Date.now()): void {
    this.lastRunAt = now;
    this.connected = false;
  }

  // Results not sent yet (each collection once).
  isNew(collected: CollectedHealth): boolean {
    return collected.collectedAt !== this.lastSentAt;
  }

  sent(collected: CollectedHealth): void {
    this.lastSentAt = collected.collectedAt;
  }
}
