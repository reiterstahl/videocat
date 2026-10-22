#!/usr/bin/env node
import fs from "node:fs/promises";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AgentErrorInput,
  AgentFileInput,
  companionDefaultPort,
  riskyMediaMessage,
  companionPortCandidates,
  formatBytes,
  isVideoExtension,
  streamMimeType,
  type VisualFingerprintFrame
} from "@videocat/shared";
import { copyHasStalled, uniqueDestinationPath } from "./file-transfer.js";
import { analyzeMedia, compactToolError, extractVisualHash, type MediaTools } from "@videocat/shared/media";
import { loadOrCreateCompanionIdentity } from "./identity.js";
import { startCompanionControlTunnel, type CompanionControlTunnel } from "./control-tunnel.js";
import { canonicalPathInsideRoot, cleanRelativePath, safePathInsideRoot } from "./path-security.js";
import { boundedErrorMessage, boundedText } from "./error-reporting.js";
import { isLocalRequestAuthorized } from "./local-auth.js";
import { processTransferItem, staleStagingFiles, statfsSpace, type TransferState, type TransferWorkItem } from "./transfer-engine.js";
import { DownloadPriority } from "./work-priority.js";
import { trayStatusLine } from "./tray-animation.js";
import { clearRisky, fileTimeoutSeconds, isRiskyNow, markRisky, riskyRetryDays, withDeadline, type RiskyFiles } from "./scan-watchdog.js";
import { ActivityReporter } from "./activity.js";
import { renameDiskMarker } from "./disk-marker.js";
import { MoveCandidates, resolveMoves } from "./move-detection.js";
import {
  deletionFingerprintFrameIndexes,
  validateDeletionFingerprint,
  validateDeletionMetadata
} from "./deletion-identity.js";

const execFileAsync = promisify(execFile);
// Work rounds per review: files leave their drives in one round, their deliveries come in the next.
const maxTransferRounds = 4;

type Args = {
  command: string;
  path?: string;
  diskName?: string;
  diskId?: string;
  volumeLabel?: string;
  volumeId?: string;
  rootAsPath: boolean;
  scanRoots: string[];
  batchSize: number;
  thumbnails: boolean;
  repairThumbnails?: boolean;
};

type DiskMarker = {
  schemaVersion: 1;
  diskId: string;
  diskName: string;
  createdAt: string;
  scanRoots: string[];
  notes?: string;
};

type ScanTarget = {
  scanPath: string;
};

type MountedDisk = {
  root: string;
  marker: DiskMarker | null;
};

type CompanionTarget = {
  id: string;
  name: string;
  path: string;
  enabled?: boolean;
};

type ThumbResult = {
  kind: string;
  timestampSeconds: number;
  filePath: string;
};

type ProcessedFile = {
  record: AgentFileInput;
  thumbnails: ThumbResult[];
};

type PendingScanFile = {
  filePath: string;
  createThumbnails: boolean;
  createFingerprint: boolean;
  // What the walk already read, so a file that stops answering can still be catalogued as at risk.
  stats: { size: number; mtime: Date; birthtime: Date };
};

type PendingAgentError = AgentErrorInput;

type State = {
  completed: Record<string, number | { modifiedAtMs: number; sizeBytes: number }>;
  // Files whose reading stopped answering: later scans skip them until the retry time passes.
  risky?: RiskyFiles;
};

type CountResult = {
  total: number;
  pending: number;
  skipped: number;
};

type ScanCompleteness = {
  complete: boolean;
};

function completedStateMatches(state: State, relativePathValue: string, modifiedAtMs: number, sizeBytes: number): boolean {
  const entry = state.completed[relativePathValue];
  if (typeof entry === "number") return entry === modifiedAtMs;
  return Boolean(entry && entry.modifiedAtMs === modifiedAtMs && entry.sizeBytes === sizeBytes);
}

function setCompletedState(state: State, relativePathValue: string, modifiedAtMs: number, sizeBytes: number): void {
  state.completed[relativePathValue] = { modifiedAtMs, sizeBytes };
}

type CompanionOpenRequest = {
  diskId?: string;
  absolutePath?: string;
  relativePath?: string;
};

type CompanionThumbnailRepairRequest = {
  diskIds?: string[];
};

type CompanionResult =
  | { ok: true }
  | { ok: false; reason: "bad_request" | "forbidden" | "not_available" | "open_failed"; detail?: string };

type DeleteQueueFile = {
  id: string;
  filename: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt?: string | null;
  durationSeconds?: number | null;
  visualFingerprint?: string | null;
};

type DeleteQueueResponse = {
  disk: {
    id: string;
    name: string;
  };
  files: DeleteQueueFile[];
};

type DownloadQueueFile = {
  id: string;
  fileId: string;
  diskId: string;
  diskName: string;
  filename: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt?: string | null;
  requestedAt: string;
};

type DownloadQueueResponse = {
  paused?: boolean;
  files: DownloadQueueFile[];
};

type ThumbnailRepairQueueResponse = {
  files: Array<{
    relativePath: string;
    missingKinds: string[];
  }>;
};

type FingerprintRepairQueueResponse = {
  files: Array<{ relativePath: string }>;
};

type ScanIndexResponse = {
  files: Array<{
    relativePath: string;
    sizeBytes: number;
    modifiedAt?: string | null;
  }>;
};

type CompanionHeartbeatResponse = {
  ok: boolean;
  // The accent chosen in the web (Tema), for the tray icon while the Companion works.
  appearance?: { accent?: string | null };
  // Names chosen in the web for the connected drives, to keep in their .videocat-disk.json.
  diskNames?: Array<{ diskId: string; name: string }>;
  commands?: {
    processDeletesRequestedAt?: number;
    processDownloadsRequestedAt?: number;
    transfersStopRequestedAt?: number;
    transfersResumeRequestedAt?: number;
  };
};


async function resolveCompanionStreamFile(input: { diskId: string; relativePath: string }): Promise<{ path: string; sizeBytes: number; mimeType: string } | null> {
  const filePath = await resolveCompanionPath({ diskId: input.diskId, relativePath: input.relativePath });
  if (!filePath || !isVideoExtension(path.extname(filePath))) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    return { path: filePath, sizeBytes: stat.size, mimeType: streamMimeType(path.extname(filePath)) };
  } catch {
    return null;
  }
}

const markerFileName = ".videocat-disk.json";
const skippedDirectoryNames = new Set(["$recycle.bin", "system volume information"]);
const loadedEnvFiles: string[] = [];
const envSources = new Map<string, string>();
const companionAppName = "videocat-companion";
const companionVersion = 21;
let downloadProcessingRunning = false;
// Downloads come before transfers; see work-priority.ts.
const downloadPriority = new DownloadPriority();
// Set by the watcher: starts transfers again once downloads gave the drives back.
let resumeTransfers: (() => void) | null = null;
let deleteProcessingRunning = false;
let companionScanRunning = false;
let companionControlTunnel: CompanionControlTunnel | null = null;
let companionInstallationId: string | null = null;
let fingerprintRepairEndpointAvailable: boolean | null = null;

class AgentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

class AgentRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly statusCode: number) {
    super(message);
    this.name = "AgentRequestError";
  }
}

function envSource(name: string): string {
  if (envSources.has(name)) return envSources.get(name)!;
  return process.env[name] ? "variables de entorno de PowerShell/sistema" : "no configurado";
}

function agentTokenHint(): string {
  const files = loadedEnvFiles.length > 0 ? loadedEnvFiles.join(", ") : "ningun .env leido";
  return [
    "El servidor rechazo las credenciales del agente.",
    process.env.VIDEOCAT_AGENT_CREDENTIAL
      ? "El Companion esta usando su credencial individual emparejada. Vuelve a emparejarlo si fue revocada."
      : `AGENT_TOKEN usado por el agente: ${envSource("AGENT_TOKEN")}.`,
    `Archivos .env leidos: ${files}.`,
    process.env.VIDEOCAT_AGENT_CREDENTIAL
      ? "Genera un codigo nuevo en Administracion y vuelve a emparejar este equipo."
      : "Verifica que ese valor coincida exactamente con AGENT_TOKEN en el .env del servidor Docker."
  ].join(" ");
}

function agentCredential(): string | undefined {
  return process.env.VIDEOCAT_AGENT_CREDENTIAL || process.env.AGENT_TOKEN;
}

async function loadEnvFile(): Promise<void> {
  const initCwd = process.env.INIT_CWD;
  const candidates = [
    path.join(process.cwd(), ".env"),
    initCwd ? path.join(initCwd, "apps", "agent-windows", ".env") : "",
    path.resolve(process.cwd(), "../../.env"),
    initCwd ? path.join(initCwd, ".env") : ""
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      loadedEnvFiles.push(candidate);
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const equalsAt = trimmed.indexOf("=");
        if (equalsAt <= 0) continue;
        const key = trimmed.slice(0, equalsAt).trim();
        const value = trimmed.slice(equalsAt + 1).trim().replace(/^["']|["']$/g, "");
        if (process.env[key] == null) {
          process.env[key] = value;
          envSources.set(key, candidate);
        }
      }
    } catch {
      // Env files are optional; PowerShell environment variables still work.
    }
  }
}

function parseArgs(argv: string[]): Args {
  const [command = "scan", ...rest] = argv;
  const values = new Map<string, Array<string | boolean>>();
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = rest[index + 1];
    const current = values.get(key) ?? [];
    if (!next || next.startsWith("--")) {
      current.push(true);
    } else {
      current.push(next);
      index += 1;
    }
    values.set(key, current);
  }

  if (!["scan", "init-disk", "add-root", "discover", "wizard", "companion", "process-deletes"].includes(command)) {
    printUsage();
    process.exit(1);
  }

  return {
    command,
    path: optionalPath(firstValue(values, "path")),
    diskName: firstString(values, "disk-name") ?? firstString(values, "diskName"),
    diskId: firstString(values, "disk-id") ?? firstString(values, "diskId"),
    volumeLabel: firstString(values, "volume-label"),
    volumeId: firstString(values, "volume-id"),
    rootAsPath: firstValue(values, "root-as-path") === true,
    scanRoots: stringValues(values, "scan-root"),
    batchSize: Number(firstValue(values, "batch-size") ?? 50),
    thumbnails: firstValue(values, "no-thumbnails") !== true,
    repairThumbnails: firstValue(values, "no-thumbnail-repair") !== true
  };
}

function printUsage(): void {
  console.error(`
Uso:
  npm run init-disk -- --path "E:" --disk-name "WD 6TB Video 01" --scan-root "Videos"
  npm run add-root -- --path "E:" --scan-root "Proyectos/2024"
  npm run scan -- --path "E:"
  npm run scan -- --path "\\\\NAS\\Videos" --disk-name "NAS Videos" --disk-id "UUID" --volume-id "UUID" --root-as-path
  npm run scan -- --disk-id "UUID_DEL_DISCO"
  npm run scan -- --disk-name "WD 6TB Video 01"
  npm run companion
  npm run process-deletes
  npm run wizard
  npm run discover
`);
}

function firstValue(values: Map<string, Array<string | boolean>>, key: string): string | boolean | undefined {
  return values.get(key)?.[0];
}

function firstString(values: Map<string, Array<string | boolean>>, key: string): string | undefined {
  return stringValue(firstValue(values, key));
}

function stringValues(values: Map<string, Array<string | boolean>>, key: string): string[] {
  return (values.get(key) ?? []).flatMap((value) => {
    const text = stringValue(value);
    return text ? [text] : [];
  });
}

function optionalPath(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? normalizeScanPath(value) : undefined;
}

function normalizeScanPath(value: string): string {
  if (/^[A-Za-z]:$/.test(value)) return `${value}\\`;
  return path.resolve(value);
}

function stringValue(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function volumeRootFromPath(scanPath: string): string {
  const parsed = path.parse(scanPath);
  return parsed.root || scanPath;
}

function normalizeScanRoot(root: string): string {
  const cleaned = root.trim().replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
  return cleaned === "" || cleaned === "." ? "." : cleaned;
}

function markerPathForRoot(root: string): string {
  return path.join(root, markerFileName);
}

async function readMarkerAtRoot(root: string): Promise<DiskMarker | null> {
  try {
    const raw = await fs.readFile(markerPathForRoot(root), "utf8");
    const parsed = JSON.parse(raw) as Partial<DiskMarker>;
    if (parsed.schemaVersion !== 1 || !parsed.diskId || !parsed.diskName) return null;
    return {
      schemaVersion: 1,
      diskId: parsed.diskId,
      diskName: parsed.diskName,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      scanRoots: Array.isArray(parsed.scanRoots) && parsed.scanRoots.length > 0
        ? parsed.scanRoots.map(normalizeScanRoot)
        : ["."],
      notes: parsed.notes
    };
  } catch {
    return null;
  }
}

async function writeMarker(root: string, marker: DiskMarker): Promise<void> {
  const destination = markerPathForRoot(root);
  try {
    await fs.access(destination);
    throw new Error(`Ya existe ${destination}. No lo sobreescribo automaticamente.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await fs.writeFile(destination, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
}

async function saveMarker(root: string, marker: DiskMarker): Promise<void> {
  await fs.writeFile(markerPathForRoot(root), `${JSON.stringify(marker, null, 2)}\n`);
}

async function discoverMountedDisks(): Promise<MountedDisk[]> {
  const roots: string[] = [];

  if (os.platform() === "win32") {
    for (const letter of "BCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = `${letter}:\\`;
      try {
        await fs.access(root);
        roots.push(root);
      } catch {
        // Drive letter is not mounted or not accessible.
      }
    }
  } else {
    for (const mountBase of ["/mnt", "/media", "/Volumes"]) {
      try {
        const entries = await fs.readdir(mountBase, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) roots.push(path.join(mountBase, entry.name));
        }
      } catch {
        // Ignore mount locations that do not exist on this OS.
      }
    }
  }

  const disks: MountedDisk[] = [];
  for (const root of roots) {
    disks.push({ root, marker: await readMarkerAtRoot(root) });
  }

  return disks;
}

async function discoverMountedMarkers(): Promise<Array<{ root: string; marker: DiskMarker }>> {
  const disabled = disabledCompanionDiskIds();
  return (await discoverMountedDisks()).flatMap((disk) =>
    disk.marker && !disabled.has(disk.marker.diskId) ? [{ root: disk.root, marker: disk.marker }] : []
  );
}

function disabledCompanionDiskIds(): Set<string> {
  return new Set((process.env.COMPANION_DISABLED_DISK_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean));
}

function monitoredCompanionTargets(): CompanionTarget[] {
  const raw = process.env.COMPANION_MONITORED_TARGETS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<CompanionTarget>>;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((target) => {
      if (!target.id || !target.name || !target.path || target.enabled === false) return [];
      const normalizedPath = normalizeScanPath(target.path);
      const key = `${target.id}:${normalizedPath.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: target.id,
        name: target.name,
        path: normalizedPath,
        enabled: true
      }];
    });
  } catch (error) {
    console.warn(`No pude leer COMPANION_MONITORED_TARGETS: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function discoverCompanionTargets(): Promise<Array<{ root: string; marker: DiskMarker }>> {
  const markerTargets = await discoverMountedMarkers();
  const manualTargets: Array<{ root: string; marker: DiskMarker }> = [];
  const markerKeys = new Set(markerTargets.map(({ root, marker }) => `${marker.diskId}@${root.toLowerCase()}`));

  for (const target of monitoredCompanionTargets()) {
    try {
      const kind = await existingPath(target.path);
      if (kind !== "directory") continue;
      const key = `${target.id}@${target.path.toLowerCase()}`;
      if (markerKeys.has(key)) continue;
      manualTargets.push({
        root: target.path,
        marker: {
          schemaVersion: 1,
          diskId: target.id,
          diskName: target.name,
          createdAt: new Date().toISOString(),
          scanRoots: ["."]
        }
      });
    } catch {
      // Unavailable monitored folders are simply skipped until they come back.
    }
  }

  return [...markerTargets, ...manualTargets];
}

async function logMountedCompanionDisks(): Promise<void> {
  const mounted = await discoverMountedMarkers();
  if (mounted.length === 0) {
    console.log("Discos VideoCAT montados: ninguno detectado.");
    return;
  }

  console.log("Discos VideoCAT montados:");
  for (const { root, marker } of mounted) {
    console.log(`- ${root} -> ${marker.diskName} (${marker.diskId})`);
  }
}

function companionDiskPollMs(): number {
  const value = Number(process.env.COMPANION_DISK_POLL_MS ?? 5000);
  return Number.isFinite(value) ? Math.max(2000, value) : 5000;
}

function companionDeletePollMs(): number {
  const value = Number(process.env.COMPANION_DELETE_POLL_MS ?? 60000);
  return Number.isFinite(value) ? Math.max(10000, value) : 60000;
}

function companionDownloadPollMs(): number {
  const value = Number(process.env.COMPANION_DOWNLOAD_POLL_MS ?? 60000);
  return Number.isFinite(value) ? Math.max(10000, value) : 60000;
}

function companionDownloadStallMs(): number {
  const value = Number(process.env.COMPANION_DOWNLOAD_STALL_MS ?? 30000);
  return Number.isFinite(value) ? Math.max(5000, value) : 30000;
}

function companionHeartbeatMs(): number {
  const value = Number(process.env.COMPANION_HEARTBEAT_MS ?? 15000);
  return Number.isFinite(value) ? Math.max(5000, value) : 15000;
}

function companionName(): string | undefined {
  const value = process.env.COMPANION_NAME?.trim();
  return value || undefined;
}

async function ensureCompanionIdentity(): Promise<string> {
  const injected = process.env.VIDEOCAT_COMPANION_ID?.trim();
  if (injected && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(injected)) {
    companionInstallationId = injected;
    return injected;
  }
  if (!companionInstallationId) companionInstallationId = await loadOrCreateCompanionIdentity(agentStateRoot());
  return companionInstallationId;
}

function companionScanPollMs(): number {
  const value = Number(process.env.COMPANION_SCAN_POLL_MS ?? 900000);
  return Number.isFinite(value) ? Math.max(60000, value) : 900000;
}

async function startCompanionDiskWatcher(): Promise<void> {
  activityReporter = new ActivityReporter(async (activities, status) => {
    if (trayBusy) emitTrayStatus(activities);
    if (!companionAgentApiEnabled()) return;
    await companionAgentApi("/api/agent/companion/activity", {
      method: "POST",
      body: JSON.stringify({ companionId: await ensureCompanionIdentity(), activities, transfersWaiting: status.transfersWaiting, transfersMode: status.transfersMode })
    });
  });
  downloadPriority.onWaitingChange = (waiting) => activityReporter?.setTransfersWaiting(waiting);
  // The tray animates its icon while anything runs, in the accent chosen in the web.
  let trayBusy = false;
  let trayAccent: string | null = null;
  // The first activity also feeds the tray tooltip (what it does, how far, about how long is left).
  const emitTrayStatus = (activities = activityReporter?.snapshot() ?? []) => console.log(trayStatusLine({
    busy: trayBusy,
    accent: trayAccent,
    activity: activities[0] ?? null,
    more: Math.max(0, activities.length - 1)
  }));
  activityReporter.onBusyChange = (busy) => {
    trayBusy = busy;
    emitTrayStatus();
  };
  const pollMs = companionDiskPollMs();
  const scanPollMs = companionScanPollMs();
  const deletePollMs = companionDeletePollMs();
  const downloadPollMs = companionDownloadPollMs();
  const heartbeatMs = companionHeartbeatMs();
  let seen = new Set<string>();
  let running = false;
  let deleteReviewRunning = false;
  let downloadReviewRunning = false;
  let transferReviewRunning = false;
  let heartbeatRunning = false;
  let lastHandledDeleteRequestAt = 0;
  let lastHandledDownloadRequestAt = 0;
  // "Detener traslados" from the web: no new transfer file starts until "Reanudar". Only in memory:
  // a restart goes back to normal transfers, so a forgotten stop never leaves files waiting.
  let transfersStopped = false;
  // The latest stop/resume order already seen; orders from before this start are ignored.
  let transferOrdersSeen: number | null = null;
  const reportTransfersMode = () => activityReporter?.setTransfersMode(
    !transfersStopped ? "running" : downloadPriority.transferInProgress() ? "stopping" : "stopped"
  );

  async function scanTarget(root: string, marker: DiskMarker, repairThumbnails: boolean): Promise<void> {
    await runScan({
      command: "scan",
      path: root,
      diskName: marker.diskName,
      diskId: marker.diskId,
      volumeId: marker.diskId,
      volumeLabel: undefined,
      rootAsPath: true,
      scanRoots: marker.scanRoots,
      batchSize: 50,
      thumbnails: true,
      repairThumbnails
    });
  }

  async function checkMountedDisks(initial = false): Promise<void> {
    if (running || companionScanRunning) return;
    running = true;
    companionScanRunning = true;
    try {
      const mounted = await discoverCompanionTargets();
      const current = new Set(mounted.map(({ root, marker }) => `${marker.diskId}@${root}`));
      const changed = current.size !== seen.size || [...current].some((key) => !seen.has(key));

      if (initial) {
        await logMountedCompanionDisks();
      } else if (changed) {
        console.log("Cambio detectado en discos VideoCAT montados:");
        for (const { root, marker } of mounted) {
          console.log(`- ${root} -> ${marker.diskName} (${marker.diskId})`);
        }
      }

      for (const { root, marker } of mounted) {
        const key = `${marker.diskId}@${root}`;
        if (!initial && seen.has(key)) continue;
        console.log(`Revision automatica de disco VideoCAT: ${root} -> ${marker.diskName}`);
        await scanTarget(root, marker, true);
        await processMarkedDeletesForDisk(root, marker);
        await processDownloadQueueForDisk(root, marker);
      }

      seen = current;
    } finally {
      running = false;
      companionScanRunning = false;
    }
  }

  async function reviewKnownTargets(): Promise<void> {
    if (running || companionScanRunning) return;
    running = true;
    companionScanRunning = true;
    try {
      const mounted = await discoverCompanionTargets();
      for (const { root, marker } of mounted) {
        console.log(`Revision periodica de ruta VideoCAT: ${root} -> ${marker.diskName}`);
        await scanTarget(root, marker, true);
      }
    } finally {
      running = false;
      companionScanRunning = false;
    }
  }

  async function reviewPendingDeletes(): Promise<void> {
    if (deleteReviewRunning) return;
    deleteReviewRunning = true;
    try {
      const mounted = await discoverCompanionTargets();
      for (const { root, marker } of mounted) {
        await processMarkedDeletesForDisk(root, marker, { quietWhenEmpty: true });
      }
    } finally {
      deleteReviewRunning = false;
    }
  }

  async function reviewPendingDownloads(): Promise<void> {
    if (downloadReviewRunning) return;
    downloadReviewRunning = true;
    // Every drive's queue in one turn: transfers wait until the whole queue is done.
    downloadPriority.hold();
    try {
      const mounted = await discoverCompanionTargets();
      for (const { root, marker } of mounted) {
        await processDownloadQueueForDisk(root, marker, { quietWhenEmpty: true });
      }
    } finally {
      downloadReviewRunning = false;
      if (downloadPriority.release()) {
        console.log("Cola de descargas terminada o pausada: los traslados siguen.");
        resumeTransfers?.();
      }
    }
  }

  // Moves files between drives through the local staging folder (Traslados). One file at a time;
  // every step is verified and reported, so it can always resume after a stop.
  async function reviewTransfers(): Promise<void> {
    const stagingDir = process.env.COMPANION_STAGING_DIR?.trim();
    if (transferReviewRunning || !stagingDir || !companionAgentApiEnabled()) return;
    if (transfersStopped || !downloadPriority.transfersMayRun()) return;
    transferReviewRunning = true;
    try {
      const mounted = await discoverCompanionTargets();
      const roots = new Map(mounted.map(({ root, marker }) => [marker.diskId, root]));
      // Several rounds: the server sends files off their drives first and holds their delivery
      // for the next round, so every source drive frees room before anything is copied onto them.
      for (let round = 0; round < maxTransferRounds; round += 1) {
        const work = await companionAgentApi<{ items: TransferWorkItem[] }>(
          `/api/agent/transfers/work?mounted=${encodeURIComponent([...roots.keys()].join(","))}`
        );
        let heldInStaging = 0;
        let steppedAside = false;
        for (const item of work.items) {
          if (transfersStopped) {
            console.log("Traslados detenidos desde la web: no se empieza otro archivo hasta reanudar.");
            steppedAside = true;
            break;
          }
          if (!downloadPriority.transfersMayRun()) {
            console.log("Traslados en espera: hay descargas pendientes. Siguen cuando termine la cola de descargas o se pause.");
            steppedAside = true;
            break;
          }
          try {
            const reached = await downloadPriority.runTransferItem(() => processTransferItem({
              stagingDir,
              resolveRoot: (identifiers) => identifiers.map((identifier) => roots.get(identifier)).find(Boolean) ?? null,
              progress: ({ item: current, phase, bytesDone, bytesTotal }) => activityReporter?.set("transfer", {
                kind: "transfer",
                phase,
                filename: current.filename,
                from: phase === "staging" || phase === "verifying_staging" ? current.source.name : "Carpeta temporal",
                to: phase === "staging" || phase === "verifying_staging" ? "Carpeta temporal" : current.target.name,
                bytesDone,
                bytesTotal
              }),
              log: (level, message) => (level === "warn" ? console.warn(message) : console.log(message)),
              transition: async (current, to, extra) => {
                try {
                  await companionAgentApi(`/api/agent/transfers/items/${current.id}/transition`, {
                    method: "POST",
                    body: JSON.stringify({ from: current.state, to, ...extra })
                  });
                  return "ok";
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  if (message.startsWith("409")) return message.includes("path_taken") ? "path_taken" : "conflict";
                  throw error;
                }
              }
            }, item));
            if (item.stopAt === "source_removed" && reached === "source_removed") heldInStaging += 1;
          } catch (error) {
            console.warn(`Traslado de ${item.filename} detenido: ${error instanceof Error ? error.message : String(error)}. Se reintentará.`);
          } finally {
            activityReporter?.clear("transfer");
            // A stop asked during this file becomes "stopped" now that it is finished.
            if (transfersStopped) reportTransfersMode();
          }
        }
        if (steppedAside || heldInStaging === 0) break;
      }
      const stale = await staleStagingFiles(stagingDir, async (ids) => {
        const response = await companionAgentApi<{ items: Array<{ id: string; state: TransferState }> }>("/api/agent/transfers/lookup", {
          method: "POST",
          body: JSON.stringify({ ids })
        });
        return new Map(response.items.map((entry) => [entry.id.toLowerCase(), entry.state]));
      });
      for (const file of stale) await fs.rm(file, { force: true }).catch(() => undefined);
    } finally {
      transferReviewRunning = false;
    }
  }

  async function stagingStatus(): Promise<{ configured: boolean; path: string | null; freeBytes: number | null; totalBytes: number | null; error: string | null }> {
    const stagingDir = process.env.COMPANION_STAGING_DIR?.trim();
    if (!stagingDir) return { configured: false, path: null, freeBytes: null, totalBytes: null, error: null };
    try {
      await fs.mkdir(stagingDir, { recursive: true });
      const space = await statfsSpace(stagingDir);
      return { configured: true, path: stagingDir, ...space, error: null };
    } catch (error) {
      return { configured: true, path: stagingDir, freeBytes: null, totalBytes: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
    }
  }

  async function mountedDiskSpace(mounted: Awaited<ReturnType<typeof discoverCompanionTargets>>) {
    const disks = new Map<string, { diskId: string; freeBytes: number; totalBytes: number }>();
    for (const { root, marker } of mounted) {
      if (disks.has(marker.diskId)) continue;
      try {
        disks.set(marker.diskId, { diskId: marker.diskId, ...(await statfsSpace(root)) });
      } catch {
        // A drive that cannot be measured keeps the free space of its last scan.
      }
    }
    return [...disks.values()].slice(0, 100);
  }

  // A drive renamed in the web gets the new name in its marker. A drive that refuses the write
  // (read-only) is reported once per name, not on every heartbeat.
  const markerRenameFailures = new Map<string, string>();
  async function applyChosenDiskNames(names: Array<{ diskId: string; name: string }>): Promise<void> {
    if (names.length === 0) return;
    // Only drives with a real marker file: folders added by hand have nothing to write.
    for (const { root, marker } of await discoverMountedMarkers()) {
      const chosen = names.find((entry) => entry.diskId === marker.diskId);
      if (!chosen || chosen.name === marker.diskName || markerRenameFailures.get(marker.diskId) === chosen.name) continue;
      try {
        const result = await renameDiskMarker(root, marker.diskId, chosen.name);
        markerRenameFailures.delete(marker.diskId);
        if (result.changed) console.log(`Nombre del disco elegido en la web: ${root} «${result.previous}» -> «${result.next}» (guardado en el marcador).`);
      } catch (error) {
        markerRenameFailures.set(marker.diskId, chosen.name);
        console.warn(`No pude guardar el nombre «${chosen.name}» en el marcador de ${root}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async function sendHeartbeat(): Promise<void> {
    if (heartbeatRunning || !companionAgentApiEnabled()) return;
    heartbeatRunning = true;
    try {
      const mounted = await discoverCompanionTargets();
      const response = await companionAgentApi<CompanionHeartbeatResponse>("/api/agent/companion/heartbeat", {
        method: "POST",
        body: JSON.stringify({
          version: companionVersion,
          companionId: await ensureCompanionIdentity(),
          companionName: companionName(),
          mountedDiskCount: mounted.length,
          mountedDiskIds: [...new Set(mounted.map(({ marker }) => marker.diskId))],
          staging: await stagingStatus(),
          // Live free space of every connected drive, so "free space" warnings follow what you delete.
          disks: await mountedDiskSpace(mounted),
          activities: activityReporter?.snapshot() ?? [],
          transfersWaiting: activityReporter?.transfersWaiting() ?? false,
          transfersMode: activityReporter?.transfersMode() ?? "running"
        })
      });
      const requestedAt = response.commands?.processDeletesRequestedAt ?? 0;
      if (requestedAt > lastHandledDeleteRequestAt) {
        lastHandledDeleteRequestAt = requestedAt;
        if (Date.now() - requestedAt <= 10 * 60 * 1000) {
          console.log("Orden web recibida: procesando borrados pendientes ahora.");
          await reviewPendingDeletes();
        }
      }
      await applyChosenDiskNames(response.diskNames ?? []);
      const accent = response.appearance?.accent ?? null;
      if (accent !== trayAccent) {
        trayAccent = accent;
        emitTrayStatus();
      }
      const stopAt = response.commands?.transfersStopRequestedAt ?? 0;
      const resumeAt = response.commands?.transfersResumeRequestedAt ?? 0;
      const latestOrder = Math.max(stopAt, resumeAt);
      if (transferOrdersSeen === null) {
        transferOrdersSeen = latestOrder;
      } else if (latestOrder > transferOrdersSeen) {
        transferOrdersSeen = latestOrder;
        if (stopAt >= resumeAt && !transfersStopped) {
          transfersStopped = true;
          console.log("Orden web: detener traslados. El archivo en curso termina y no se empieza otro; las descargas siguen.");
        } else if (resumeAt > stopAt && transfersStopped) {
          transfersStopped = false;
          console.log("Orden web: reanudar traslados.");
          resumeTransfers?.();
        }
        reportTransfersMode();
      }
      const downloadRequestedAt = response.commands?.processDownloadsRequestedAt ?? 0;
      if (downloadRequestedAt > lastHandledDownloadRequestAt) {
        lastHandledDownloadRequestAt = downloadRequestedAt;
        if (Date.now() - downloadRequestedAt <= 10 * 60 * 1000) {
          console.log("Orden web recibida: procesando descargas pendientes ahora.");
          // In the background: a long queue must not hold the heartbeat (the server would think we left).
          void reviewPendingDownloads().catch((error) => {
            console.warn(`Fallo revisando descargas pendientes: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      }
    } catch (error) {
      console.warn(`Fallo enviando heartbeat del companion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      heartbeatRunning = false;
    }
  }

  await sendHeartbeat();
  setInterval(() => {
    void sendHeartbeat();
  }, heartbeatMs);
  await checkMountedDisks(true);
  setInterval(() => {
    void checkMountedDisks(false).catch((error) => {
      console.warn(`Fallo revisando discos conectados: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, pollMs);
  setInterval(() => {
    void reviewKnownTargets().catch((error) => {
      console.warn(`Fallo reescaneando rutas monitoreadas: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, scanPollMs);
  setInterval(() => {
    void reviewPendingDeletes().catch((error) => {
      console.warn(`Fallo revisando borrados pendientes: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, deletePollMs);
  setInterval(() => {
    void reviewPendingDownloads().catch((error) => {
      console.warn(`Fallo revisando descargas pendientes: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, downloadPollMs);
  resumeTransfers = () => {
    void reviewTransfers().catch((error) => {
      console.warn(`Fallo revisando traslados: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  const transferPollMs = Math.max(15_000, Number(process.env.COMPANION_TRANSFER_POLL_MS ?? 60_000) || 60_000);
  setInterval(() => {
    void reviewTransfers().catch((error) => {
      console.warn(`Fallo revisando traslados: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, transferPollMs);
  console.log(`Detector de discos VideoCAT activo cada ${pollMs}ms.`);
  console.log(`Reescaneo de rutas monitoreadas activo cada ${scanPollMs}ms.`);
  console.log(`Revision de borrados pendientes activa cada ${deletePollMs}ms.`);
  console.log(`Revision de descargas pendientes activa cada ${downloadPollMs}ms.`);
  console.log(process.env.COMPANION_STAGING_DIR?.trim()
    ? `Traslados activos cada ${transferPollMs}ms con carpeta temporal ${process.env.COMPANION_STAGING_DIR.trim()}.`
    : "Traslados inactivos: falta la carpeta temporal (COMPANION_STAGING_DIR) en la configuracion.");
  console.log(`Heartbeat del companion activo cada ${heartbeatMs}ms.`);
}

async function repairMountedThumbnailsNow(diskIds: string[]): Promise<number> {
  companionScanRunning = true;
  try {
    const requested = new Set(diskIds.filter(Boolean));
    const mounted = (await discoverCompanionTargets()).filter(({ marker }) =>
      requested.size === 0 || requested.has(marker.diskId)
    );
    for (const { root, marker } of mounted) {
      console.log(`Regeneracion manual de miniaturas: ${root} -> ${marker.diskName}`);
      await runScan({
        command: "scan",
        path: root,
        diskName: marker.diskName,
        diskId: marker.diskId,
        volumeId: marker.diskId,
        volumeLabel: undefined,
        rootAsPath: true,
        scanRoots: marker.scanRoots,
        batchSize: 50,
        thumbnails: true,
        repairThumbnails: true
      });
    }
    return mounted.length;
  } finally {
    companionScanRunning = false;
  }
}

function requestMountedThumbnailRepair(diskIds: string[]): { accepted: boolean; busy: boolean } {
  if (companionScanRunning) return { accepted: false, busy: true };
  void repairMountedThumbnailsNow(diskIds).then((processedDisks) => {
    console.log(`Regeneracion manual finalizada en ${processedDisks} disco(s).`);
  }).catch((error) => {
    console.error(`Fallo en regeneracion manual de miniaturas: ${compactToolError(error)}`);
  });
  return { accepted: true, busy: false };
}

function jsonResponse(response: http.ServerResponse, statusCode: number, body: unknown, origin?: string): void {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-VideoCat-Companion-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function companionAllowedOrigins(): Set<string> {
  const configured = process.env.COMPANION_ALLOWED_ORIGINS;
  const configuredValues = configured
    ? configured.split(",").map((item) => item.trim()).filter(Boolean)
    : ["https://cat.example.com", "http://localhost:5173", "http://127.0.0.1:5173"];
  const values = [...configuredValues];
  if (process.env.SERVER_URL) {
    try {
      values.push(new URL(process.env.SERVER_URL).origin);
    } catch {
      // SERVER_URL is validated elsewhere when scanning; the companion can ignore malformed values.
    }
  }
  if (process.env.WEB_URL) {
    try {
      values.push(new URL(process.env.WEB_URL).origin);
    } catch {
      // WEB_URL is optional; malformed values should not prevent the companion from starting.
    }
  }
  return new Set(values);
}

function companionOrigin(request: http.IncomingMessage): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin ? origin : undefined;
}

function isCompanionOriginAllowed(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  return !origin || allowedOrigins.has(origin);
}

function isCompanionTokenAllowed(request: http.IncomingMessage): boolean {
  return isLocalRequestAuthorized(process.env.COMPANION_TOKEN, request.headers);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error("Body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function existingPath(value: string): Promise<"file" | "directory" | null> {
  try {
    const stat = await fs.stat(value);
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return null;
  } catch {
    return null;
  }
}

async function resolveCompanionPath(body: CompanionOpenRequest): Promise<string | null> {
  if (!body.diskId) return null;
  const relative = cleanRelativePath(body.relativePath);
  if (!relative) return null;

  const mounted = await discoverCompanionTargets();
  const match = mounted.find(({ marker }) => marker.diskId === body.diskId);
  if (match) {
    return canonicalPathInsideRoot(match.root, relative);
  }

  if (body.absolutePath) {
    const root = volumeRootFromPath(normalizeScanPath(body.absolutePath));
    const marker = await readMarkerAtRoot(root);
    if (marker?.diskId === body.diskId) return canonicalPathInsideRoot(root, relative);
    const manual = monitoredCompanionTargets().find((target) => target.id === body.diskId);
    if (manual) return canonicalPathInsideRoot(manual.path, relative);
  }

  return null;
}

async function openLocalFile(filePath: string): Promise<void> {
  if (os.platform() === "win32") {
    await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", filePath]);
    return;
  }

  const opener = os.platform() === "darwin" ? "open" : "xdg-open";
  await execFileAsync(opener, [filePath]);
}

async function openLocalFolder(targetPath: string, kind: "file" | "directory"): Promise<void> {
  if (os.platform() === "win32") {
    const folder = kind === "directory" ? targetPath : path.dirname(targetPath);
    await execFileAsync("explorer.exe", [folder]);
    return;
  }

  const folder = kind === "directory" ? targetPath : path.dirname(targetPath);
  const opener = os.platform() === "darwin" ? "open" : "xdg-open";
  await execFileAsync(opener, [folder]);
}

async function deleteLocalFile(filePath: string): Promise<void> {
  await fs.unlink(filePath);
}

function companionAgentApiEnabled(): boolean {
  return Boolean(process.env.SERVER_URL && agentCredential());
}

async function companionAgentApi<T>(url: string, init: RequestInit = {}): Promise<T> {
  const credential = agentCredential();
  if (!process.env.SERVER_URL || !credential) {
    throw new Error("SERVER_URL y una credencial emparejada o AGENT_TOKEN son requeridos para la revision automatica.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${credential}`);
  if (companionInstallationId) headers.set("X-VideoCat-Companion-Id", companionInstallationId);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${process.env.SERVER_URL}${url}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function reportDeletionResult(
  fileId: string,
  status: "deleted" | "missing" | "failed" | "identity_mismatch",
  errorMessage?: string
): Promise<void> {
  await companionAgentApi(`/api/agent/files/${fileId}/deletion-result`, {
    method: "POST",
    body: JSON.stringify({
      status,
      ...(status === "failed" || status === "identity_mismatch"
        ? { errorMessage: boundedErrorMessage(errorMessage, 4000, "Deletion failed") }
        : {})
    })
  });
}

async function verifyDeletionIdentity(target: string, file: DeleteQueueFile): Promise<{ ok: true } | { ok: false; reason: string }> {
  const before = await fs.stat(target);
  const metadata = validateDeletionMetadata(file, {
    sizeBytes: before.size,
    modifiedAtMs: before.mtime.getTime()
  });
  if (!metadata.ok) return metadata;

  if (file.visualFingerprint) {
    if (!file.durationSeconds || file.durationSeconds <= 0) {
      return { ok: false, reason: "existe una huella visual pero falta la duracion necesaria para verificarla" };
    }
    const frameIndexes = deletionFingerprintFrameIndexes(file.visualFingerprint);
    if (frameIndexes.length === 0) {
      return { ok: false, reason: "la huella visual catalogada no se puede verificar" };
    }

    const temporaryRoot = path.join(agentStateRoot(), "delete-verification", crypto.randomUUID());
    const observedFrames: VisualFingerprintFrame[] = [];
    try {
      for (const index of frameIndexes) {
        const rawDestination = path.join(temporaryRoot, `${String(index).padStart(2, "0")}.raw`);
        const seconds = Math.max(0.1, file.durationSeconds * (index / 16));
        const extracted = await extractVisualHash(target, mediaTools(), rawDestination, seconds);
        observedFrames.push({ index, hash: extracted.hash });
      }
    } catch (error) {
      return {
        ok: false,
        reason: `no se pudo verificar la huella visual: ${boundedErrorMessage(error, 1000, "fingerprint verification failed")}`
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }

    const fingerprint = validateDeletionFingerprint(file.visualFingerprint, observedFrames);
    if (!fingerprint.ok) return fingerprint;
  }

  const after = await fs.stat(target);
  return validateDeletionMetadata(file, {
    sizeBytes: after.size,
    modifiedAtMs: after.mtime.getTime()
  });
}

async function processMarkedDeletesForDisk(root: string, marker: DiskMarker, options: { quietWhenEmpty?: boolean } = {}): Promise<void> {
  if (deleteProcessingRunning) {
    if (!options.quietWhenEmpty) console.log("Borrados pendientes omitidos: ya hay otra revision en proceso.");
    return;
  }
  deleteProcessingRunning = true;
  try {
    await processMarkedDeletesForDiskUnlocked(root, marker, options);
  } finally {
    deleteProcessingRunning = false;
  }
}

async function processMarkedDeletesForDiskUnlocked(root: string, marker: DiskMarker, options: { quietWhenEmpty?: boolean } = {}): Promise<void> {
  if (process.env.COMPANION_AUTO_DELETE_MARKED === "false") return;
  if (!companionAgentApiEnabled()) {
    console.log("Revision automatica sin borrar: faltan SERVER_URL o credenciales del agente.");
    return;
  }

  let queue: DeleteQueueResponse;
  try {
    queue = await companionAgentApi<DeleteQueueResponse>(`/api/agent/disks/${marker.diskId}/delete-queue`);
  } catch (error) {
    console.warn(`No pude consultar marcados para borrar en ${marker.diskName}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (queue.files.length === 0) {
    if (!options.quietWhenEmpty) {
      console.log(`Revision ${root} (${marker.diskName}): sin archivos marcados para borrar.`);
    }
    return;
  }

  console.log(`Revision ${root} (${marker.diskName}): ${queue.files.length} archivo(s) marcados para borrar.`);
  let deleted = 0;
  let missing = 0;
  let failed = 0;

  for (const file of queue.files) {
    const target = safePathInsideRoot(root, file.relativePath);
    if (!target) {
      failed += 1;
      await reportDeletionResult(file.id, "failed", `Ruta insegura omitida: ${file.relativePath}`).catch(() => undefined);
      console.warn(`Ruta insegura omitida: ${file.relativePath}`);
      continue;
    }

    try {
      const kind = await existingPath(target);
      if (kind === "file") {
        const canonicalTarget = await canonicalPathInsideRoot(root, file.relativePath);
        if (!canonicalTarget) {
          failed += 1;
          await reportDeletionResult(file.id, "failed", `Ruta fuera de la unidad omitida: ${file.relativePath}`).catch(() => undefined);
          console.warn(`Ruta fuera de la unidad omitida: ${file.relativePath}`);
          continue;
        }
        const identity = await verifyDeletionIdentity(canonicalTarget, file);
        if (!identity.ok) {
          const message = `Identidad del archivo modificada; borrado cancelado: ${identity.reason}`;
          failed += 1;
          await reportDeletionResult(file.id, "identity_mismatch", message).catch(() => undefined);
          console.warn(`${message}. Ruta: ${file.relativePath}`);
          continue;
        }
        activityReporter?.set(`delete:${marker.diskId}`, { kind: "delete", phase: "deleting", filename: path.basename(file.relativePath), from: marker.diskName });
        await deleteLocalFile(canonicalTarget);
        await reportDeletionResult(file.id, "deleted");
        deleted += 1;
        console.log(`Borrado automatico: ${file.relativePath}`);
      } else if (!kind) {
        await reportDeletionResult(file.id, "missing");
        missing += 1;
        console.log(`Archivo ya no existe; catalogo limpiado: ${file.relativePath}`);
      } else {
        failed += 1;
        await reportDeletionResult(file.id, "failed", `No es un archivo: ${file.relativePath}`).catch(() => undefined);
        console.warn(`No borro porque no es archivo: ${file.relativePath}`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await reportDeletionResult(file.id, "failed", message).catch(() => undefined);
      console.warn(`Fallo borrando ${file.relativePath}: ${message}`);
    }
  }

  activityReporter?.clear(`delete:${marker.diskId}`);
  console.log(`Borrado automatico terminado en ${marker.diskName}: borrados ${deleted}, ya ausentes ${missing}, fallos ${failed}.`);
}

async function processMarkedDeletesForMountedDisks(): Promise<{ processedDisks: number }> {
  const mounted = await discoverCompanionTargets();
  for (const { root, marker } of mounted) {
    await processMarkedDeletesForDisk(root, marker);
  }
  return { processedDisks: mounted.length };
}

async function updateDownloadStatus(
  queueId: string,
  status: "downloading" | "done" | "failed",
  values: { progressBytes?: number; destinationPath?: string; errorMessage?: string } = {}
): Promise<void> {
  const boundedValues = {
    ...values,
    ...(values.errorMessage !== undefined
      ? { errorMessage: boundedErrorMessage(values.errorMessage, 2000, "Download failed") }
      : {})
  };
  await companionAgentApi(`/api/agent/downloads/${queueId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...boundedValues })
  });
}

async function copyFileWithProgress(source: string, destination: string, file: DownloadQueueFile, fromLabel?: string): Promise<void> {
  const activityKey = `download:${file.id}`;
  const showActivity = (bytesDone: number) => activityReporter?.set(activityKey, {
    kind: "download",
    phase: "downloading",
    filename: file.filename,
    from: fromLabel ?? null,
    to: path.dirname(destination),
    bytesDone,
    bytesTotal: file.sizeBytes
  });
  showActivity(0);
  try {
    await copyFileWithProgressUnreported(source, destination, file, showActivity);
  } finally {
    activityReporter?.clear(activityKey);
  }
}

async function copyFileWithProgressUnreported(source: string, destination: string, file: DownloadQueueFile, showActivity: (bytesDone: number) => void): Promise<void> {
  let copiedBytes = 0;
  let lastReportAt = 0;
  let lastReportedBytes = 0;
  let lastProgressAt = Date.now();
  let finished = false;
  const minReportBytes = 16 * 1024 * 1024;
  const minReportMs = 1200;
  const stallMs = companionDownloadStallMs();

  async function reportProgress(force = false): Promise<void> {
    const now = Date.now();
    if (
      !force &&
      copiedBytes < file.sizeBytes &&
      now - lastReportAt < minReportMs &&
      copiedBytes - lastReportedBytes < minReportBytes
    ) {
      return;
    }
    lastReportAt = now;
    lastReportedBytes = copiedBytes;
    await updateDownloadStatus(file.id, "downloading", { progressBytes: copiedBytes }).catch(() => undefined);
  }

  const sourceStream = createReadStream(source);
  const destinationStream = createWriteStream(destination, { flags: "wx" });
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      copiedBytes += chunk.length;
      lastProgressAt = Date.now();
      showActivity(copiedBytes);
      void reportProgress();
      callback(null, chunk);
    }
  });

  const watchdog = setInterval(() => {
    if (finished) return;
    if (!copyHasStalled(lastProgressAt, Date.now(), stallMs)) return;
    const error = new Error(`Descarga sin progreso durante ${Math.round(stallMs / 1000)}s; archivo cancelado para continuar con la cola.`);
    sourceStream.destroy(error);
    progress.destroy(error);
    destinationStream.destroy(error);
  }, Math.min(5000, Math.max(1000, Math.floor(stallMs / 3))));

  try {
    await pipeline(sourceStream, progress, destinationStream);
    copiedBytes = file.sizeBytes;
    await reportProgress(true);
  } finally {
    finished = true;
    clearInterval(watchdog);
  }
}

async function processDownloadQueueForDisk(root: string, marker: DiskMarker, options: { quietWhenEmpty?: boolean } = {}): Promise<void> {
  if (downloadProcessingRunning) {
    if (!options.quietWhenEmpty) console.log("Descargas automaticas omitidas: ya hay una descarga en proceso.");
    return;
  }
  downloadProcessingRunning = true;
  let claimed = false;
  try {
    const downloadDir = process.env.COMPANION_DOWNLOAD_DIR?.trim();
    if (!downloadDir) {
      if (!options.quietWhenEmpty) console.log("Descargas automaticas inactivas: falta COMPANION_DOWNLOAD_DIR en la configuracion del companion.");
      return;
    }
    if (!companionAgentApiEnabled()) {
      console.log("Revision automatica sin descargar: faltan SERVER_URL o credenciales del agente.");
      return;
    }

    const staleMs = companionDownloadStallMs();
    let copied = 0;
    let failed = 0;
    let checked = 0;

    while (true) {
      let queue: DownloadQueueResponse;
      try {
        queue = await companionAgentApi<DownloadQueueResponse>(
          `/api/agent/downloads/queue?diskId=${encodeURIComponent(marker.diskId)}&staleMs=${staleMs}`
        );
      } catch (error) {
        console.warn(`No pude consultar descargas pendientes en ${marker.diskName}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      if (queue.paused) {
        if (!options.quietWhenEmpty || checked > 0) console.log(`Revision ${root} (${marker.diskName}): cola de descargas pausada.`);
        return;
      }

      const file = queue.files[0];
      if (!file) {
        if (checked === 0 && !options.quietWhenEmpty) console.log(`Revision ${root} (${marker.diskName}): sin descargas pendientes.`);
        break;
      }

      if (!claimed) {
        claimed = true;
        await downloadPriority.claim(() => console.log("Descarga pendiente: el traslado en curso termina su archivo y después sigue la cola de descargas."));
      }
      checked += 1;
      console.log(`Revision ${root} (${marker.diskName}): descargando 1 archivo pendiente.`);

      const source = safePathInsideRoot(root, file.relativePath);
      if (!source) {
        failed += 1;
        await updateDownloadStatus(file.id, "failed", { errorMessage: `Ruta insegura omitida: ${file.relativePath}` }).catch(() => undefined);
        console.warn(`Descarga omitida por ruta insegura: ${file.relativePath}`);
        continue;
      }

      let destination = "";
      try {
        const kind = await existingPath(source);
        if (kind !== "file") {
          failed += 1;
          await updateDownloadStatus(file.id, "failed", { errorMessage: "Archivo no disponible en el disco conectado." }).catch(() => undefined);
          console.warn(`No se descarga porque no esta disponible como archivo: ${file.relativePath}`);
          continue;
        }

        const canonicalSource = await canonicalPathInsideRoot(root, file.relativePath);
        if (!canonicalSource) {
          failed += 1;
          await updateDownloadStatus(file.id, "failed", { errorMessage: `Ruta fuera de la unidad omitida: ${file.relativePath}` }).catch(() => undefined);
          console.warn(`Descarga omitida porque la ruta sale de la unidad: ${file.relativePath}`);
          continue;
        }

        await updateDownloadStatus(file.id, "downloading", { progressBytes: 0 });
        destination = await uniqueDestinationPath(downloadDir, marker.diskName, file.filename);
        await copyFileWithProgress(canonicalSource, destination, file, marker.diskName);
        await updateDownloadStatus(file.id, "done", { destinationPath: destination });
        copied += 1;
        console.log(`Descarga completada: ${file.relativePath} -> ${destination}`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (destination) await fs.rm(destination, { force: true }).catch(() => undefined);
        await updateDownloadStatus(file.id, "failed", { errorMessage: message.slice(0, 1000) }).catch(() => undefined);
        console.warn(`Fallo descargando ${file.relativePath}: ${message}`);
      }
    }

    if (checked > 0) console.log(`Descargas automaticas terminadas en ${marker.diskName}: copiados ${copied}, fallos ${failed}.`);
  } finally {
    downloadProcessingRunning = false;
    if (claimed && downloadPriority.release()) {
      console.log("Cola de descargas terminada o pausada: los traslados siguen.");
      resumeTransfers?.();
    }
  }
}

async function processDownloadQueueForMountedDisks(): Promise<{ processedDisks: number }> {
  const mounted = await discoverCompanionTargets();
  downloadPriority.hold();
  try {
    for (const { root, marker } of mounted) {
      await processDownloadQueueForDisk(root, marker);
    }
  } finally {
    if (downloadPriority.release()) resumeTransfers?.();
  }
  return { processedDisks: mounted.length };
}

async function handleCompanionAction(action: "open-file" | "open-folder" | "delete-file", body: CompanionOpenRequest): Promise<CompanionResult> {
  const resolved = await resolveCompanionPath(body);
  if (!resolved) return { ok: false, reason: "not_available" };

  const kind = await existingPath(resolved);
  if (!kind) return { ok: false, reason: "not_available" };

  try {
    if (action === "open-file") {
      if (kind !== "file") return { ok: false, reason: "not_available" };
      await openLocalFile(resolved);
    } else if (action === "delete-file") {
      if (kind !== "file") return { ok: false, reason: "not_available" };
      await deleteLocalFile(resolved);
    } else {
      await openLocalFolder(resolved, kind);
    }
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const label = action === "open-file" ? "archivo" : action === "delete-file" ? "archivo para borrar" : "carpeta";
    console.error(`No se pudo procesar ${label} local: ${detail}`);
    return { ok: false, reason: "open_failed", detail: detail.slice(0, 500) };
  }
}

async function companionHealthCheck(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    const body = await response.json().catch(() => null) as { ok?: boolean; app?: string } | null;
    return response.ok && body?.ok === true && body.app === companionAppName;
  } catch {
    return false;
  }
}

async function shutdownExistingCompanion(port: number): Promise<boolean> {
  try {
    const headers = new Headers();
    if (process.env.COMPANION_TOKEN) headers.set("X-VideoCat-Companion-Token", process.env.COMPANION_TOKEN);
    const response = await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function windowsListeningPids(port: number): Promise<string[]> {
  if (os.platform() !== "win32") return [];
  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano"]);
    const pids = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const normalized = line.trim().replace(/\s+/g, " ");
      if (!normalized.includes(" LISTENING ")) continue;
      const parts = normalized.split(" ");
      const localAddress = parts[1] ?? "";
      const pid = parts.at(-1) ?? "";
      if (
        pid &&
        (
          localAddress === `127.0.0.1:${port}` ||
          localAddress === `0.0.0.0:${port}` ||
          localAddress === `[::1]:${port}` ||
          localAddress === `[::]:${port}`
        )
      ) {
        pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

async function killWindowsPids(pids: string[]): Promise<void> {
  for (const pid of pids) {
    if (pid === String(process.pid)) continue;
    try {
      await execFileAsync("taskkill.exe", ["/PID", pid, "/F"]);
    } catch {
      // If it already exited, starting the new companion can continue.
    }
  }
}

type CompanionListenResult = "listening" | "occupied" | "unavailable";

async function listenCompanion(server: http.Server, port: number, host: string): Promise<CompanionListenResult> {
  return new Promise<CompanionListenResult>((resolve) => {
    const cleanup = () => {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      resolve(error.code === "EADDRINUSE" ? "occupied" : "unavailable");
    };
    const onListening = () => {
      cleanup();
      resolve("listening");
    };

    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(port, host);
    } catch {
      cleanup();
      resolve("unavailable");
    }
  });
}

// Started by the tray (VIDEOCAT_PARENT_WATCH=1): if the tray is gone (closed by force, an installer,
// a crash), this agent leaves too instead of running on as an orphan that blocks updates.
function watchParentTray(): void {
  if (process.env.VIDEOCAT_PARENT_WATCH !== "1") return;
  const parent = process.ppid;
  const leave = (reason: string) => {
    console.log(`La bandeja del Companion ya no está (${reason}): el agente se cierra.`);
    process.exit(0);
  };
  process.stdin.on("end", () => leave("se cerró su canal"));
  process.stdin.resume();
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      leave("su proceso terminó");
    }
  }, 5000).unref();
}

async function runCompanion(): Promise<void> {
  const host = "127.0.0.1";
  const configuredPort = Number(process.env.COMPANION_PORT ?? companionDefaultPort);
  const requestedPort = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : companionDefaultPort;
  const allowedOrigins = companionAllowedOrigins();

  let activeServer: http.Server | null = null;
  const requestHandler: http.RequestListener = (request, response) => {
    void (async () => {
      const origin = companionOrigin(request);
      const responseOrigin = origin && allowedOrigins.has(origin) ? origin : undefined;

      if (request.url === "/health" && request.method === "GET") {
        jsonResponse(response, 200, { ok: true, app: companionAppName, version: companionVersion }, responseOrigin);
        return;
      }

      if (request.url === "/health" && request.method === "OPTIONS") {
        jsonResponse(response, 204, {}, responseOrigin);
        return;
      }

      if (!isCompanionOriginAllowed(origin, allowedOrigins)) {
        jsonResponse(response, 403, { ok: false, reason: "forbidden" }, responseOrigin);
        return;
      }

      if (request.method === "OPTIONS") {
        jsonResponse(response, 204, {}, responseOrigin);
        return;
      }

      if (!isCompanionTokenAllowed(request)) {
        jsonResponse(response, 401, { ok: false, reason: "forbidden" }, responseOrigin);
        return;
      }

      if (request.url === "/shutdown" && request.method === "POST") {
        jsonResponse(response, 200, { ok: true }, responseOrigin);
        setTimeout(() => activeServer?.close(() => process.exit(0)), 50);
        return;
      }

      if (request.url === "/mounted-disks" && request.method === "GET") {
        const mounted = await discoverCompanionTargets();
        jsonResponse(response, 200, {
          ok: true,
          disks: mounted.map(({ root, marker }) => ({
            root,
            diskId: marker.diskId,
            diskName: marker.diskName,
            scanRoots: marker.scanRoots
          }))
        }, responseOrigin);
        return;
      }

      if (request.url === "/process-deletes" && request.method === "POST") {
        const result = await processMarkedDeletesForMountedDisks();
        jsonResponse(response, 200, { ok: true, ...result }, responseOrigin);
        return;
      }

      if (request.url === "/process-downloads" && request.method === "POST") {
        const result = await processDownloadQueueForMountedDisks();
        jsonResponse(response, 200, { ok: true, ...result }, responseOrigin);
        return;
      }

      if (request.url === "/repair-thumbnails" && request.method === "POST") {
        let body: CompanionThumbnailRepairRequest;
        try {
          body = await readJsonBody(request) as CompanionThumbnailRepairRequest;
        } catch {
          jsonResponse(response, 400, { ok: false, reason: "bad_request" }, responseOrigin);
          return;
        }
        const diskIds = Array.isArray(body.diskIds)
          ? [...new Set(body.diskIds.filter((value): value is string => typeof value === "string"))].slice(0, 100)
          : [];
        const result = requestMountedThumbnailRepair(diskIds);
        jsonResponse(response, 200, { ok: true, ...result }, responseOrigin);
        return;
      }

      if ((request.url === "/open-file" || request.url === "/open-folder" || request.url === "/delete-file") && request.method === "POST") {
        let body: CompanionOpenRequest;
        try {
          body = await readJsonBody(request) as CompanionOpenRequest;
        } catch {
          jsonResponse(response, 400, { ok: false, reason: "bad_request" }, responseOrigin);
          return;
        }

        const result = await handleCompanionAction(request.url.slice(1) as "open-file" | "open-folder" | "delete-file", body);
        jsonResponse(response, 200, result, responseOrigin);
        return;
      }

      jsonResponse(response, 404, { ok: false, reason: "not_available" }, responseOrigin);
    })().catch(() => {
      jsonResponse(response, 500, { ok: false, reason: "open_failed" });
    });
  };

  async function tryPort(port: number): Promise<CompanionListenResult> {
    const candidateServer = http.createServer(requestHandler);
    const result = await listenCompanion(candidateServer, port, host);
    if (result === "listening") {
      activeServer = candidateServer;
    } else {
      candidateServer.removeAllListeners();
    }
    return result;
  }

  let selectedPort: number | null = null;
  const firstListen = await tryPort(requestedPort);
  if (firstListen === "listening") {
    selectedPort = requestedPort;
  } else if (firstListen === "occupied") {
    const healthOk = await companionHealthCheck(requestedPort);
    if (healthOk) {
      console.log(`El puerto ${requestedPort} pertenece a otro Companion. Intentando reemplazarlo...`);
      await shutdownExistingCompanion(requestedPort);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const pids = await windowsListeningPids(requestedPort);
      if (pids.length > 0) {
        console.log(`Cerrando Companion anterior en puerto ${requestedPort}: PID ${pids.join(", ")}`);
        await killWindowsPids(pids);
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
      if (await tryPort(requestedPort) === "listening") selectedPort = requestedPort;
    } else {
      console.warn(`El puerto ${requestedPort} esta ocupado por otra aplicacion; se dejara intacta.`);
    }
  } else {
    console.warn(`Windows no permitio abrir el puerto ${requestedPort}.`);
  }

  if (selectedPort == null) {
    console.log("Buscando un puerto local alternativo...");
    for (const fallbackPort of companionPortCandidates(requestedPort)) {
      if (fallbackPort === requestedPort) continue;
      if (await tryPort(fallbackPort) === "listening") {
        selectedPort = fallbackPort;
        break;
      }
    }
  }

  if (selectedPort == null) {
    console.error(`No pude iniciar el companion. Puertos probados: ${companionPortCandidates(requestedPort).join(", ")}.`);
    return;
  }

  console.log(`VideoCAT Companion escuchando en http://${host}:${selectedPort}${selectedPort === requestedPort ? "" : ` (puerto alternativo; el solicitado fue ${requestedPort})`}.`);
  console.log(`Origenes permitidos: ${[...allowedOrigins].join(", ")}`);
  console.log(process.env.COMPANION_TOKEN?.trim()
    ? "Token local requerido por este companion; configúralo en Perfil del navegador, no en el servidor."
    : "COMPANION_TOKEN no configurado: el listener local solo responde /health y rechaza todas las acciones.");
  await reportMediaToolAvailability();
  await startCompanionDiskWatcher();
  const credential = process.env.VIDEOCAT_AGENT_CREDENTIAL?.trim();
  if (credential && process.env.SERVER_URL) {
    companionControlTunnel?.stop();
    companionControlTunnel = startCompanionControlTunnel({
      serverUrl: process.env.SERVER_URL,
      credential,
      companionId: await ensureCompanionIdentity(),
      companionName: companionName(),
      version: companionVersion,
      logInfo: (message) => console.log(message),
      logWarn: (message) => console.warn(message),
      resolveStreamFile: resolveCompanionStreamFile
    });
  } else {
    console.log("Canal remoto no iniciado: empareja este Companion con una credencial individual para habilitarlo.");
  }
}

async function runProcessDeletes(): Promise<void> {
  const result = await processMarkedDeletesForMountedDisks();
  if (result.processedDisks === 0) {
    console.log(`No encontre discos o rutas monitoreadas disponibles.`);
  }
}

async function resolveDisk(args: Args): Promise<{ diskRoot: string; marker: DiskMarker | null; diskName: string; volumeId?: string }> {
  if (args.path) {
    const diskRoot = args.rootAsPath ? args.path : volumeRootFromPath(args.path);
    const marker = await readMarkerAtRoot(diskRoot);
    const diskName = args.diskName ?? marker?.diskName;
    if (!diskName) {
      console.error(`No encontre ${markerFileName} en ${diskRoot} y tampoco recibí --disk-name.`);
      printUsage();
      process.exit(1);
    }
    return {
      diskRoot,
      marker,
      diskName,
      volumeId: args.volumeId ?? marker?.diskId
    };
  }

  const mounted = await discoverCompanionTargets();
  const matches = mounted.filter(({ marker }) => {
    if (args.diskId) return marker.diskId === args.diskId;
    if (args.diskName) return marker.diskName.toLowerCase() === args.diskName.toLowerCase();
    return false;
  });

  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.error("Hay mas de un disco montado que coincide. Usa --disk-id para desambiguar.");
    } else {
      console.error("No encontre un disco montado que coincida. Ejecuta npm run discover para ver marcadores disponibles.");
    }
    process.exit(1);
  }

  const match = matches[0];
  return {
    diskRoot: match.root,
    marker: match.marker,
    diskName: match.marker.diskName,
    volumeId: match.marker.diskId
  };
}

function scanTargetsFor(args: Args, diskRoot: string, marker: DiskMarker | null): ScanTarget[] {
  if (args.path && args.path !== diskRoot) return [{ scanPath: args.path }];
  const roots = args.scanRoots.length > 0 ? args.scanRoots : marker?.scanRoots ?? ["."];
  return roots.map((root) => ({
    scanPath: root === "." ? diskRoot : path.join(diskRoot, root)
  }));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta variable de entorno ${name}`);
    process.exit(1);
  }
  return value;
}

function authHeaders(): HeadersInit {
  const credential = agentCredential();
  if (!credential) {
    console.error("Falta una credencial emparejada o AGENT_TOKEN");
    process.exit(1);
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential}`,
    "Content-Type": "application/json"
  };
  if (companionInstallationId) headers["X-VideoCat-Companion-Id"] = companionInstallationId;
  return headers;
}

async function api<T>(url: string, init: RequestInit): Promise<T> {
  const retries = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${requiredEnv("SERVER_URL")}${url}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(60_000)
      });
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 401 && (body.includes("Invalid agent token") || body.includes("Invalid agent credentials"))) {
          throw new AgentAuthError(`${response.status} ${body}\n${agentTokenHint()}`);
        }
        throw new AgentRequestError(
          `${response.status} ${body}`,
          response.status === 408 || response.status === 429 || (response.status >= 500 && response.status !== 507),
          response.status
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof AgentAuthError || (error instanceof AgentRequestError && !error.retryable)) throw error;
      const waitMs = 800 * attempt;
      console.warn(`Intento ${attempt}/${retries} falló para ${url} (${boundedText(error instanceof Error ? error.message : String(error), 200)}). Reintentando en ${waitMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function shouldSkipDirectory(name: string): boolean {
  return skippedDirectoryNames.has(name.toLowerCase());
}

function errorCode(error: unknown): string | null {
  return typeof (error as NodeJS.ErrnoException).code === "string" ? (error as NodeJS.ErrnoException).code! : null;
}

function auditCategory(error: unknown, fallback = "agent"): string {
  const code = errorCode(error)?.toUpperCase();
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code === "EPERM" || code === "EACCES" || message.includes("permission")) return "permission";
  if (code === "ENOENT") return "missing_path";
  if (message.includes("ffprobe")) return "metadata";
  if (message.includes("ffmpeg")) return "thumbnail";
  return fallback;
}

function auditError(error: unknown, phase: string, absolutePath: string, diskRoot?: string): PendingAgentError {
  return {
    category: boundedText(auditCategory(error), 80),
    phase: boundedText(phase, 40),
    code: errorCode(error) ? boundedText(errorCode(error)!, 80) : null,
    message: boundedErrorMessage(error),
    absolutePath: boundedText(absolutePath, 2000),
    relativePath: diskRoot ? boundedText(relativePath(diskRoot, absolutePath), 2000) : null
  };
}

async function* walkVideos(
  root: string,
  errors?: PendingAgentError[],
  diskRoot?: string,
  completeness?: ScanCompleteness
): AsyncGenerator<string> {
  let entries: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    entries = await fs.opendir(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOENT") {
      console.warn(`Omitiendo carpeta no accesible: ${root}`);
      errors?.push(auditError(error, "walk", root, diskRoot));
      if (completeness) completeness.complete = false;
      return;
    }
    throw error;
  }

  for await (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        console.log(`Omitiendo carpeta de sistema: ${absolute}`);
        continue;
      }
      yield* walkVideos(absolute, errors, diskRoot, completeness);
    } else if (entry.isFile() && isVideoExtension(path.extname(entry.name))) {
      yield absolute;
    }
  }
}

async function loadState(statePath: string, legacyPaths: string[] = []): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8")) as State;
  } catch {
    for (const legacyPath of legacyPaths) {
      if (path.resolve(legacyPath) === path.resolve(statePath)) continue;
      try {
        const legacyState = JSON.parse(await fs.readFile(legacyPath, "utf8")) as State;
        await saveState(statePath, legacyState);
        console.log(`Estado anterior del agente migrado a ${statePath}`);
        return legacyState;
      } catch {
        // Try the next legacy location.
      }
    }
    return { completed: {} };
  }
}

async function saveState(statePath: string, state: State): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function compactFileLabel(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase() || "sin-extension";
  const name = path.basename(filePath, path.extname(filePath)).trim();
  const suffix = name.slice(-3) || "---";
  return `${extension} ...${suffix}`;
}

function agentStateRoot(): string {
  const configured = process.env.AGENT_STATE_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "VideoCAT", "agent-state");
  }
  return path.join(os.homedir(), ".local", "state", "videocat-agent");
}

function mediaToolPath(environmentKey: "FFMPEG_PATH" | "FFPROBE_PATH", fallback: "ffmpeg" | "ffprobe"): string {
  return process.env[environmentKey]?.trim() || fallback;
}

function mediaToolCandidates(environmentKey: "FFMPEG_PATH" | "FFPROBE_PATH", fallback: "ffmpeg" | "ffprobe"): string[] {
  const executable = `${fallback}.exe`;
  const candidates = [process.env[environmentKey]?.trim(), fallback];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const userProfile = process.env.USERPROFILE || os.homedir();
    candidates.push(
      path.join(localAppData, "Microsoft", "WinGet", "Links", executable),
      path.join(userProfile, "scoop", "apps", "ffmpeg", "current", "bin", executable),
      path.join("C:\\", "ffmpeg", "bin", executable),
      path.join("C:\\", "ProgramData", "chocolatey", "bin", executable)
    );
  }
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

async function discoverWinGetMediaTools(): Promise<Map<"ffmpeg" | "ffprobe", string>> {
  const discovered = new Map<"ffmpeg" | "ffprobe", string>();
  if (process.platform !== "win32") return discovered;

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  try {
    const packages = await fs.readdir(packagesRoot, { withFileTypes: true });
    const queue = packages
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes("ffmpeg"))
      .map((entry) => ({ directory: path.join(packagesRoot, entry.name), depth: 0 }));

    while (queue.length > 0 && discovered.size < 2) {
      const current = queue.shift()!;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(current.directory, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const absolute = path.join(current.directory, entry.name);
        const normalizedName = entry.name.toLowerCase();
        if ((entry.isFile() || entry.isSymbolicLink()) && (normalizedName === "ffmpeg.exe" || normalizedName === "ffprobe.exe")) {
          discovered.set(normalizedName === "ffmpeg.exe" ? "ffmpeg" : "ffprobe", absolute);
        } else if (entry.isDirectory() && current.depth < 6) {
          queue.push({ directory: absolute, depth: current.depth + 1 });
        }
      }
    }
  } catch {
    // WinGet is optional; the configured path and other known locations are still checked.
  }
  return discovered;
}

async function reportMediaToolAvailability(): Promise<void> {
  const winGetTools = await discoverWinGetMediaTools();
  for (const [environmentKey, fallback] of [["FFMPEG_PATH", "ffmpeg"], ["FFPROBE_PATH", "ffprobe"]] as const) {
    let lastError: unknown;
    let selected = "";
    const candidates = [...mediaToolCandidates(environmentKey, fallback), winGetTools.get(fallback)]
      .filter((candidate): candidate is string => Boolean(candidate));
    for (const executable of [...new Set(candidates)]) {
      try {
        await execFileAsync(executable, ["-version"], { maxBuffer: 1024 * 1024 });
        selected = executable;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (selected) {
      process.env[environmentKey] = selected;
      console.log(`${fallback} disponible: ${selected}`);
    } else {
      console.error(`${fallback} no disponible: ${compactToolError(lastError)}. Configura ${environmentKey} en Configuracion.`);
    }
  }
}

function thumbnailTempName(relativePathValue: string, kind: string): string {
  const digest = crypto.createHash("sha256").update(relativePathValue).digest("hex").slice(0, 32);
  return `${digest}-${kind}.jpg`;
}

function fingerprintTempName(relativePathValue: string, kind: string): string {
  return thumbnailTempName(relativePathValue, kind).replace(/\.jpg$/, ".gray");
}

async function countVideos(
  targets: ScanTarget[],
  diskRoot: string,
  state: State,
  errors: PendingAgentError[],
  processingPaths: Set<string>,
  completeness: ScanCompleteness
): Promise<CountResult> {
  let total = 0;
  let pending = 0;
  let skipped = 0;

  for (const target of targets) {
    console.log(`Contando videos en ${target.scanPath}`);
    for await (const filePath of walkVideos(target.scanPath, errors, diskRoot, completeness)) {
      total += 1;
      try {
        const stat = await fs.stat(filePath);
        const rel = relativePath(diskRoot, filePath);
        if (completedStateMatches(state, rel, stat.mtime.getTime(), stat.size) && !processingPaths.has(rel)) {
          skipped += 1;
        } else {
          pending += 1;
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOENT") {
          console.warn(`Omitiendo archivo no accesible durante conteo: ${filePath}`);
          errors.push(auditError(error, "count", filePath, diskRoot));
          completeness.complete = false;
          continue;
        }
        throw error;
      }
    }
  }

  return { total, pending, skipped };
}

async function folderSizeBytes(folderPathValue: string, cache: Map<string, number | null>, errors: PendingAgentError[], diskRoot: string): Promise<number | null> {
  if (cache.has(folderPathValue)) return cache.get(folderPathValue) ?? null;
  try {
    const entries = await fs.readdir(folderPathValue, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(path.join(folderPathValue, entry.name));
        total += stat.size;
      } catch (error) {
        errors.push(auditError(error, "folder_size", path.join(folderPathValue, entry.name), diskRoot));
      }
    }
    cache.set(folderPathValue, total);
    return total;
  } catch (error) {
    errors.push(auditError(error, "folder_size", folderPathValue, diskRoot));
    cache.set(folderPathValue, null);
    return null;
  }
}

async function inspectDisk(scanPath: string) {
  try {
    const stat = await fs.statfs(scanPath);
    return {
      totalBytes: Number(stat.blocks) * Number(stat.bsize),
      freeBytes: Number(stat.bavail) * Number(stat.bsize),
      fileSystem: os.platform() === "win32" ? "windows" : undefined
    };
  } catch {
    return {};
  }
}

// ffmpeg and ffprobe as configured or found (FFMPEG_PATH / FFPROBE_PATH, WinGet, PATH).
function mediaTools(): MediaTools {
  return { ffmpeg: mediaToolPath("FFMPEG_PATH", "ffmpeg"), ffprobe: mediaToolPath("FFPROBE_PATH", "ffprobe") };
}

async function processFile(
  scanRoot: string,
  filePath: string,
  scanId: string,
  createThumbnails: boolean,
  createFingerprint: boolean,
  folderSizeCache: Map<string, number | null>,
  errors: PendingAgentError[],
  signal?: AbortSignal
): Promise<ProcessedFile> {
  const stats = await fs.stat(filePath);
  const rel = relativePath(scanRoot, filePath);
  const extension = path.extname(filePath).toLowerCase();
  const folderTotal = await folderSizeBytes(path.dirname(filePath), folderSizeCache, errors, scanRoot);
  const baseRecord = {
    filename: path.basename(filePath),
    extension,
    absolutePath: filePath,
    relativePath: rel,
    sizeBytes: stats.size,
    folderSizeBytes: folderTotal,
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString()
  };

  const analyzed = await analyzeMedia(filePath, {
    tools: mediaTools(),
    label: compactFileLabel(filePath),
    createThumbnails,
    createFingerprint,
    thumbnailPath: (kind) => path.join(agentStateRoot(), "temporary-thumbnails", scanId, thumbnailTempName(rel, kind)),
    rawPath: (kind) => path.join(agentStateRoot(), "temporary-thumbnails", scanId, fingerprintTempName(rel, kind)),
    signal
  });
  return {
    record: {
      ...baseRecord,
      status: analyzed.status,
      errorMessage: analyzed.errorMessage,
      visualFingerprint: analyzed.visualFingerprint,
      fingerprintVersion: analyzed.fingerprintVersion,
      metadata: analyzed.metadata
    },
    thumbnails: analyzed.thumbnails
  };
}

async function uploadBatch(
  scanId: string,
  diskId: string,
  batch: ProcessedFile[],
  errors: PendingAgentError[]
): Promise<number> {
  if (batch.length === 0) return 0;
  await api("/api/agent/files/batch", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      scanId,
      diskId,
      // Moves were already decided by this scan (move-detection.ts): the server must not guess.
      movesReported: true,
      files: batch.map((item) => ({
        ...item.record,
        errorMessage: item.record.errorMessage == null
          ? item.record.errorMessage
          : boundedErrorMessage(item.record.errorMessage)
      }))
    })
  });

  let uploadFailures = 0;
  for (const item of batch) {
    for (const thumb of item.thumbnails) {
      try {
        await uploadThumbnail(diskId, item.record.relativePath, thumb);
      } catch (error) {
        uploadFailures += 1;
        const message = boundedErrorMessage(error);
        console.warn(`Falló la subida de la miniatura ${thumb.kind} para ${compactFileLabel(item.record.absolutePath)} (${boundedText(message, 200)}); continuando con el siguiente archivo.`);
        errors.push({
          category: auditCategory(error, "thumbnail"),
          phase: "thumbnail_upload",
          code: errorCode(error),
          message,
          absolutePath: item.record.absolutePath,
          relativePath: item.record.relativePath
        });
      } finally {
        await fs.rm(thumb.filePath, { force: true }).catch(() => undefined);
      }
    }
  }
  return uploadFailures;
}

async function uploadSeenPaths(scanId: string, paths: string[]): Promise<number> {
  let reactivated = 0;
  for (let index = 0; index < paths.length; index += 500) {
    const response = await api<{ reactivated: number }>(`/api/agent/scans/${scanId}/seen`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ paths: paths.slice(index, index + 500) })
    });
    reactivated += response.reactivated;
  }
  return reactivated;
}

async function thumbnailRepairPaths(diskId: string): Promise<Set<string>> {
  try {
    const response = await api<ThumbnailRepairQueueResponse>(`/api/agent/disks/${diskId}/thumbnail-repair-queue`, {
      method: "GET",
      headers: authHeaders()
    });
    return new Set(response.files.map((file) => file.relativePath));
  } catch (error) {
    console.warn(`No se pudo consultar la reparacion de miniaturas; el escaneo normal continuara: ${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
}

async function fingerprintRepairPaths(diskId: string): Promise<Set<string>> {
  if (fingerprintRepairEndpointAvailable === false) return new Set();
  try {
    const response = await api<FingerprintRepairQueueResponse>(`/api/agent/disks/${diskId}/fingerprint-repair-queue`, {
      method: "GET",
      headers: authHeaders()
    });
    fingerprintRepairEndpointAvailable = true;
    return new Set(response.files.map((file) => file.relativePath));
  } catch (error) {
    if (error instanceof AgentRequestError && error.statusCode === 404) {
      fingerprintRepairEndpointAvailable = false;
      console.log("El servidor actual no incluye la reparacion de huellas visuales. Actualiza el contenedor server y reinicia el Companion para activarla.");
      return new Set();
    }
    console.warn(`No se pudo consultar la cola de huellas visuales; el escaneo normal continuara: ${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
}

async function hydrateStateFromServer(diskId: string, state: State): Promise<number> {
  try {
    const response = await api<ScanIndexResponse>(`/api/agent/disks/${diskId}/scan-index`, {
      method: "GET",
      headers: authHeaders()
    });
    let restored = 0;
    for (const file of response.files) {
      if (!file.modifiedAt) continue;
      const modifiedAt = new Date(file.modifiedAt).getTime();
      const current = state.completed[file.relativePath];
      if (
        !Number.isFinite(modifiedAt)
        || (typeof current === "object" && current.modifiedAtMs === modifiedAt && current.sizeBytes === file.sizeBytes)
      ) continue;
      setCompletedState(state, file.relativePath, modifiedAt, file.sizeBytes);
      restored += 1;
    }
    return restored;
  } catch (error) {
    console.warn(`No se pudo reconstruir el estado desde el servidor; se usara el estado local: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

async function uploadThumbnail(diskId: string, relativePathValue: string, thumb: ThumbResult): Promise<void> {
  const form = new FormData();
  form.set("diskId", diskId);
  form.set("relativePath", relativePathValue);
  form.set("kind", thumb.kind);
  form.set("timestampSeconds", String(thumb.timestampSeconds));
  const buffer = await fs.readFile(thumb.filePath);
  form.set("file", new Blob([buffer], { type: "image/jpeg" }), path.basename(thumb.filePath));

  await api("/api/agent/thumbnails/upload", {
    method: "POST",
    headers: (() => {
      const headers = new Headers(authHeaders());
      headers.delete("Content-Type");
      return headers;
    })(),
    body: form
  });
}

async function uploadAuditErrors(scanId: string, diskId: string, errors: PendingAgentError[]): Promise<void> {
  if (errors.length === 0) return;
  await api("/api/agent/errors/batch", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      scanId,
      diskId,
      errors: errors.map((error) => ({
        category: boundedText(error.category, 80),
        phase: boundedText(error.phase, 40),
        code: error.code == null ? error.code : boundedText(error.code, 80),
        message: boundedErrorMessage(error.message),
        absolutePath: error.absolutePath == null ? error.absolutePath : boundedText(error.absolutePath, 2000),
        relativePath: error.relativePath == null ? error.relativePath : boundedText(error.relativePath, 2000)
      }))
    })
  });
}

function parseSelection(input: string, count: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "all" || trimmed === "todos") {
    return Array.from({ length: count }, (_value, index) => index);
  }

  const selected = new Set<number>();
  for (const part of trimmed.split(",")) {
    const value = Number(part.trim());
    if (Number.isInteger(value) && value >= 1 && value <= count) {
      selected.add(value - 1);
    }
  }
  return [...selected];
}

async function runWizard(args: Args): Promise<void> {
  const disks = await discoverMountedDisks();
  if (disks.length === 0) {
    console.log("No encontre discos montados accesibles.");
    return;
  }

  console.log("Discos detectados:");
  disks.forEach((disk, index) => {
    const label = disk.marker
      ? `${disk.marker.diskName}  diskId=${disk.marker.diskId}  scanRoots=${disk.marker.scanRoots.join(",")}`
      : "sin marcador";
    console.log(`  ${index + 1}. ${disk.root}  ${label}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Cuales quieres indexar? Usa numeros separados por coma o 'todos': ");
    const selectedIndexes = parseSelection(answer, disks.length);
    if (selectedIndexes.length === 0) {
      console.log("No se seleccionaron discos.");
      return;
    }

    for (const index of selectedIndexes) {
      const disk = disks[index];
      let marker = disk.marker;

      if (!marker) {
        const diskName = (await rl.question(`Nombre amigable para ${disk.root}: `)).trim();
        if (!diskName) {
          console.log(`Omitiendo ${disk.root}; no se indico nombre.`);
          continue;
        }

        const rootsAnswer = (await rl.question("Rutas internas a escanear separadas por coma, o Enter para todo el disco: ")).trim();
        const scanRoots = rootsAnswer
          ? rootsAnswer.split(",").map(normalizeScanRoot).filter(Boolean)
          : ["."];

        marker = {
          schemaVersion: 1,
          diskId: crypto.randomUUID(),
          diskName,
          createdAt: new Date().toISOString(),
          scanRoots
        };
        await writeMarker(disk.root, marker);
        console.log(`Marcador creado en ${markerPathForRoot(disk.root)}`);
      }

      await runScan({
        ...args,
        command: "scan",
        path: disk.root,
        diskName: marker.diskName,
        diskId: marker.diskId,
        scanRoots: args.scanRoots.length > 0 ? args.scanRoots : marker.scanRoots
      });
    }
  } finally {
    rl.close();
  }
}

// Live activity for the web indicator; only the tray Companion (paired, with the agent API) reports it.
let activityReporter: ActivityReporter | null = null;

async function runScan(args: Args): Promise<void> {
  const key = `scan:${args.diskId ?? args.path ?? "disk"}`;
  activityReporter?.set(key, { kind: "scan", phase: "scanning", from: args.diskName ?? args.path ?? null, filesDone: 0 });
  try {
    await runScanUnreported(args, key);
  } finally {
    activityReporter?.clear(key);
  }
}

async function runScanUnreported(args: Args, activityKey: string): Promise<void> {
  const concurrency = Number(process.env.AGENT_CONCURRENCY ?? 2);
  const resolved = await resolveDisk(args);
  const scanTargets = scanTargetsFor(args, resolved.diskRoot, resolved.marker);
  const diskInfo = await inspectDisk(resolved.diskRoot);

  const { disk } = await api<{ disk: { id: string } }>("/api/agent/register-disk", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: resolved.diskName,
      volumeLabel: args.volumeLabel,
      volumeId: resolved.volumeId,
      driveLetter: /^[A-Za-z]:/.test(resolved.diskRoot) ? resolved.diskRoot.slice(0, 2) : null,
      totalBytes: diskInfo.totalBytes,
      freeBytes: diskInfo.freeBytes,
      fileSystem: diskInfo.fileSystem
    })
  });

  const stateIdentifier = resolved.volumeId ?? disk.id;
  const statePath = path.join(agentStateRoot(), stateIdentifier, "scan-state.json");
  const state = await loadState(statePath, [
    path.join(process.cwd(), ".videocat-agent-state", stateIdentifier, "scan-state.json")
  ]);
  const restoredStateEntries = await hydrateStateFromServer(disk.id, state);
  if (restoredStateEntries > 0) {
    await saveState(statePath, state);
    console.log(`Estado de escaneo reconstruido desde el servidor: ${restoredStateEntries} archivo(s).`);
  }
  const repairPaths = args.thumbnails && args.repairThumbnails !== false
    ? await thumbnailRepairPaths(disk.id)
    : new Set<string>();
  const fingerprintPaths = await fingerprintRepairPaths(disk.id);
  const processingPaths = new Set([...repairPaths, ...fingerprintPaths]);

  if (repairPaths.size > 0) {
    console.log(`Reparacion automatica: ${repairPaths.size} video(s) tienen miniaturas faltantes y se volveran a procesar.`);
  }
  if (fingerprintPaths.size > 0) {
    console.log(`Analisis de duplicados: ${fingerprintPaths.size} video(s) necesitan una huella visual.`);
  }

  const { scan } = await api<{ scan: { id: string } }>("/api/agent/scan/start", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ diskId: disk.id, rootPath: resolved.diskRoot })
  });
  const auditErrors: PendingAgentError[] = [];
  const completeness: ScanCompleteness = { complete: true };
  const folderSizeCache = new Map<string, number | null>();
  const counts = await countVideos(scanTargets, resolved.diskRoot, state, auditErrors, processingPaths, completeness);
  if (auditErrors.length > 0) {
    await uploadAuditErrors(scan.id, disk.id, auditErrors.splice(0, auditErrors.length));
  }

  console.log(`Escaneo iniciado: ${scan.id}`);
  console.log(`Raiz del disco: ${resolved.diskRoot}`);
  console.log(`Rutas: ${scanTargets.map((target) => target.scanPath).join(", ")}`);
  console.log(`Disco: ${resolved.diskName}`);
  if (resolved.marker) console.log(`diskId marcador: ${resolved.marker.diskId}`);
  console.log(`Concurrencia: ${concurrency}`);
  console.log(`Videos encontrados: ${counts.total}. Pendientes: ${counts.pending}. Ya omitidos por estado local: ${counts.skipped}.`);

  let pendingPaths: PendingScanFile[] = [];
  let batch: ProcessedFile[] = [];
  let discovered = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let processedPending = 0;
  const seenRelativePaths = new Set<string>();
  // Folders renamed or files moved on this drive: their catalog entries follow them (see
  // move-detection.ts). Built after the state was rebuilt from the server, so it knows every file.
  const moveCandidates = new MoveCandidates(state.completed);
  const moveProposals: Array<{ to: string; gone: string[]; item: PendingScanFile }> = [];
  let relocatedCount = 0;
  let relocateAvailable = true;

  // Every file gets a deadline (COMPANION_FILE_TIMEOUT_SECONDS): past it the scan moves on and the
  // file is catalogued as at risk; see scan-watchdog.ts.
  const fileTimeoutMs = fileTimeoutSeconds(process.env.COMPANION_FILE_TIMEOUT_SECONDS) * 1000;
  const statTimeoutMs = Math.min(fileTimeoutMs, 30_000);
  state.risky ??= {};
  let riskySkipped = 0;

  // audit: only when the file is not catalogued (its stat hung); a catalogued one gets its
  // Auditoría entry from its record.
  function markAtRisk(rel: string, filePath: string, phase: string, seconds: number, audit: boolean): string {
    const message = riskyMediaMessage(seconds, riskyRetryDays);
    markRisky(state.risky!, rel, message);
    // Written at once: if the Companion is closed now, the next start still leaves this file alone.
    void saveState(statePath, state).catch(() => undefined);
    console.warn(`Archivo en riesgo ${compactFileLabel(filePath)}: no respondió en ${seconds} s con el disco conectado. Se sigue con el siguiente y no se vuelve a leer por ${riskyRetryDays} días.`);
    if (audit) auditErrors.push({ category: "at_risk_file", phase, code: "read_timeout", message, absolutePath: filePath, relativePath: rel });
    return message;
  }

  async function processGuarded(item: PendingScanFile): Promise<ProcessedFile> {
    const result = await withDeadline((signal) => processFile(
      resolved.diskRoot,
      item.filePath,
      scan.id,
      item.createThumbnails,
      item.createFingerprint,
      folderSizeCache,
      auditErrors,
      signal
    ), fileTimeoutMs);
    const rel = relativePath(resolved.diskRoot, item.filePath);
    if (result.done) {
      clearRisky(state.risky, rel);
      return result.value;
    }
    const message = markAtRisk(rel, item.filePath, "metadata", Math.round(fileTimeoutMs / 1000), false);
    return {
      record: {
        filename: path.basename(item.filePath),
        extension: path.extname(item.filePath).toLowerCase(),
        absolutePath: item.filePath,
        relativePath: rel,
        sizeBytes: item.stats.size,
        folderSizeBytes: null,
        createdAt: item.stats.birthtime.toISOString(),
        modifiedAt: item.stats.mtime.toISOString(),
        status: "metadata_failed",
        errorMessage: message,
        visualFingerprint: item.createFingerprint ? null : undefined,
        fingerprintVersion: item.createFingerprint ? null : undefined,
        metadata: null
      },
      thumbnails: []
    };
  }

  async function processGroup(paths: PendingScanFile[]) {
    const processed = await Promise.all(paths.map((item) => {
      processedPending += 1;
      const remaining = Math.max(counts.pending - processedPending, 0);
      console.log(`Procesando ${processedPending}/${counts.pending} (faltan ${remaining}): ${compactFileLabel(item.filePath)}`);
      activityReporter?.set(activityKey, {
        kind: "scan",
        phase: "scanning",
        from: args.diskName ?? args.path ?? null,
        filename: path.basename(item.filePath),
        filesDone: processedPending,
        filesTotal: counts.pending
      });
      return processGuarded(item);
    }));
    batch.push(...processed);
    failed += processed.filter((item) => item.record.status !== "scanned").length;
    if (batch.length >= args.batchSize) {
      failed += await uploadBatch(scan.id, disk.id, batch, auditErrors);
      for (const item of batch) {
        setCompletedState(
          state,
          item.record.relativePath,
          new Date(item.record.modifiedAt ?? 0).getTime(),
          item.record.sizeBytes
        );
      }
      uploaded += batch.length;
      console.log(`Subidos ${uploaded} archivos. Fallos acumulados: ${failed}. Ultimo lote: ${formatBytes(processed.reduce((sum, item) => sum + item.record.sizeBytes, 0))}.`);
      batch = [];
      await saveState(statePath, state);
      if (auditErrors.length > 0) {
        await uploadAuditErrors(scan.id, disk.id, auditErrors.splice(0, auditErrors.length));
      }
    }
  }

  // Old paths with the same size, time and extension as the file at rel that are gone from the
  // drive (a rename or a move, not a copy). An old path that does not answer counts as present.
  async function gonePaths(rel: string, size: number, modifiedAtMs: number): Promise<string[]> {
    const gone: string[] = [];
    for (const candidate of moveCandidates.candidates(rel, size, modifiedAtMs)) {
      const oldPath = safePathInsideRoot(resolved.diskRoot, candidate);
      if (!oldPath) continue;
      try {
        const read = await withDeadline(() => fs.stat(oldPath), statTimeoutMs);
        if (!read.done) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") gone.push(candidate);
      }
    }
    return gone;
  }

  // Decided once the whole drive was walked (see resolveMoves), so a copy found first never takes
  // the catalog entry of the file that was really moved.
  async function applyMoves(): Promise<void> {
    if (moveProposals.length === 0) return;
    const decided = resolveMoves(moveProposals);
    const moves = moveProposals.flatMap(({ to, item }) => {
      const from = decided.get(to);
      return from ? [{ from, to, item }] : [];
    });
    const relocated = new Set<string>();
    const deferred = new Set<string>();
    for (let index = 0; index < moves.length && relocateAvailable; index += 100) {
      const chunk = moves.slice(index, index + 100);
      try {
        const body = await Promise.all(chunk.map(async ({ from, to, item }) => ({
          from,
          to,
          absolutePath: item.filePath,
          sizeBytes: item.stats.size,
          modifiedAt: item.stats.mtime.toISOString(),
          folderSizeBytes: await folderSizeBytes(path.dirname(item.filePath), folderSizeCache, auditErrors, resolved.diskRoot)
        })));
        const response = await api<{ relocated: string[] }>(`/api/agent/scans/${scan.id}/relocate`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ moves: body })
        });
        for (const to of response.relocated) relocated.add(to);
      } catch (error) {
        if (error instanceof AgentRequestError && error.statusCode === 404 && error.message.includes("Route")) {
          relocateAvailable = false;
          console.log("El servidor actual no reconoce carpetas renombradas: esos videos se procesan como nuevos. Actualiza el contenedor server a la 0.2.45 o posterior.");
        } else {
          // Left for the next scan: the old path is still gone then and the move is tried again.
          for (const { to } of chunk) deferred.add(to);
          console.warn(`No se pudieron mover en el catálogo ${chunk.length} archivo(s); se intentará en el próximo escaneo: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    for (const { from, to, item } of moves) {
      if (!relocated.has(to)) continue;
      delete state.completed[from];
      setCompletedState(state, to, item.stats.mtime.getTime(), item.stats.size);
    }
    relocatedCount = relocated.size;
    counts.pending = Math.max(counts.pending - relocated.size - deferred.size, 0);
    if (relocated.size > 0) {
      await saveState(statePath, state);
      console.log(`Movidos en el catálogo sin volver a procesarlos: ${relocated.size} archivo(s).`);
    }
    // Everything else (ambiguous, rejected, old server): read as a new file, as before.
    for (const { to, item } of moveProposals) {
      if (relocated.has(to) || deferred.has(to)) continue;
      pendingPaths.push(item);
      if (pendingPaths.length >= concurrency) {
        await processGroup(pendingPaths);
        pendingPaths = [];
      }
    }
  }

  for (const target of scanTargets) {
    console.log(`Escaneando ${target.scanPath}`);
    for await (const filePath of walkVideos(target.scanPath, auditErrors, resolved.diskRoot, completeness)) {
      discovered += 1;
      const riskyRel = relativePath(resolved.diskRoot, filePath);
      // A file that stopped answering before is not touched again, not even its size, until its
      // retry time passes; it still counts as present.
      if (isRiskyNow(state.risky, riskyRel)) {
        seenRelativePaths.add(riskyRel);
        skipped += 1;
        riskySkipped += 1;
        continue;
      }
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        const read = await withDeadline(() => fs.stat(filePath), statTimeoutMs);
        if (!read.done) {
          markAtRisk(riskyRel, filePath, "stat", Math.round(statTimeoutMs / 1000), true);
          seenRelativePaths.add(riskyRel);
          continue;
        }
        stat = read.value;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOENT") {
          console.warn(`Omitiendo archivo no accesible: ${filePath}`);
          auditErrors.push(auditError(error, "stat", filePath, resolved.diskRoot));
          completeness.complete = false;
          continue;
        }
        throw error;
      }
      const rel = relativePath(resolved.diskRoot, filePath);
      seenRelativePaths.add(rel);
      const unchanged = completedStateMatches(state, rel, stat.mtime.getTime(), stat.size);
      if (unchanged && !processingPaths.has(rel)) {
        skipped += 1;
        continue;
      }

      const item: PendingScanFile = {
        filePath,
        createThumbnails: args.thumbnails && (!unchanged || repairPaths.has(rel)),
        createFingerprint: !unchanged || fingerprintPaths.has(rel) || repairPaths.has(rel),
        stats: { size: stat.size, mtime: stat.mtime, birthtime: stat.birthtime }
      };
      // A path this drive never had may be a file that only changed folder.
      if (state.completed[rel] === undefined) {
        const gone = await gonePaths(rel, stat.size, stat.mtime.getTime());
        if (gone.length > 0) {
          moveProposals.push({ to: rel, gone, item });
          continue;
        }
      }
      pendingPaths.push(item);
      if (pendingPaths.length >= concurrency) {
        await processGroup(pendingPaths);
        pendingPaths = [];
      }
    }
  }

  await applyMoves();
  if (pendingPaths.length > 0) await processGroup(pendingPaths);
  if (batch.length > 0) {
    failed += await uploadBatch(scan.id, disk.id, batch, auditErrors);
    for (const item of batch) {
      setCompletedState(
        state,
        item.record.relativePath,
        new Date(item.record.modifiedAt ?? 0).getTime(),
        item.record.sizeBytes
      );
    }
    uploaded += batch.length;
    await saveState(statePath, state);
  }
  // Keeps the at-risk list even when the last files were skipped or stopped answering.
  await saveState(statePath, state);
  if (auditErrors.length > 0) {
    await uploadAuditErrors(scan.id, disk.id, auditErrors.splice(0, auditErrors.length));
  }

  const reactivated = await uploadSeenPaths(scan.id, [...seenRelativePaths]);
  const scanRoots = scanTargets.map((target) => {
    const root = relativePath(resolved.diskRoot, target.scanPath);
    return root || ".";
  });
  const finished = await api<{ reconciliation: { markedAbsent: number } }>("/api/agent/scan/finish", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ scanId: scan.id, reconcile: completeness.complete, scanRoots })
  });
  await fs.rm(path.join(agentStateRoot(), "temporary-thumbnails", scan.id), { recursive: true, force: true }).catch(() => undefined);

  console.log("Escaneo finalizado.");
  console.log(`Detectados: ${discovered}. Omitidos por estado local: ${skipped}. Subidos: ${uploaded}. Fallos: ${failed}.`);
  if (relocatedCount > 0) console.log(`Movidos o en carpetas renombradas (sin volver a procesarlos): ${relocatedCount}.`);
  if (riskySkipped > 0) console.log(`Archivos en riesgo omitidos sin leerlos: ${riskySkipped}.`);
  if (completeness.complete) {
    console.log(`Conciliacion terminada: ${finished.reconciliation.markedAbsent} ausente(s), ${reactivated} reactivado(s).`);
  } else {
    console.warn("Conciliacion omitida: la pasada tuvo errores de acceso y no es seguro declarar archivos ausentes.");
  }
}

async function main() {
  // The Node.js runtime this agent runs on, for the packaging check (scripts/check-node-security.mjs).
  if (process.argv[2] === "runtime") {
    console.log(JSON.stringify({ node: process.versions.node, executable: path.basename(process.execPath) }));
    return;
  }
  await loadEnvFile();
  await ensureCompanionIdentity();
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "init-disk") {
    if (!args.path || !args.diskName) {
      console.error('Uso: npm run init-disk -- --path "E:" --disk-name "WD 6TB Video 01" --scan-root "Videos"');
      process.exit(1);
    }

    const diskRoot = volumeRootFromPath(args.path);
    const marker: DiskMarker = {
      schemaVersion: 1,
      diskId: args.diskId ?? crypto.randomUUID(),
      diskName: args.diskName,
      createdAt: new Date().toISOString(),
      scanRoots: args.scanRoots.length > 0 ? args.scanRoots.map(normalizeScanRoot) : ["."]
    };
    await writeMarker(diskRoot, marker);
    console.log(`Marcador creado en ${markerPathForRoot(diskRoot)}`);
    console.log(`diskId: ${marker.diskId}`);
    console.log(`scanRoots: ${marker.scanRoots.join(", ")}`);
    return;
  }

  if (args.command === "add-root") {
    if (!args.path || args.scanRoots.length === 0) {
      console.error('Uso: npm run add-root -- --path "E:" --scan-root "Proyectos/2024"');
      process.exit(1);
    }

    const diskRoot = volumeRootFromPath(args.path);
    const marker = await readMarkerAtRoot(diskRoot);
    if (!marker) {
      console.error(`No encontre ${markerFileName} en ${diskRoot}. Ejecuta init-disk primero.`);
      process.exit(1);
    }

    const nextRoots = new Set(marker.scanRoots.map(normalizeScanRoot));
    for (const root of args.scanRoots) nextRoots.add(normalizeScanRoot(root));
    marker.scanRoots = [...nextRoots];
    await saveMarker(diskRoot, marker);
    console.log(`Marcador actualizado en ${markerPathForRoot(diskRoot)}`);
    console.log(`scanRoots: ${marker.scanRoots.join(", ")}`);
    return;
  }

  if (args.command === "discover") {
    const mounted = await discoverCompanionTargets();
    if (mounted.length === 0) {
      console.log(`No encontre discos o rutas monitoreadas disponibles.`);
      return;
    }

    for (const { root, marker } of mounted) {
      console.log(`${root}  ${marker.diskName}  ${marker.diskId}  scanRoots=${marker.scanRoots.join(",")}`);
    }
    return;
  }

  if (args.command === "wizard") {
    await runWizard(args);
    return;
  }

  if (args.command === "companion") {
    console.log(`Agente con Node ${process.versions.node} (${path.basename(process.execPath)}).`);
    watchParentTray();
    await runCompanion();
    return;
  }

  if (args.command === "process-deletes") {
    await runProcessDeletes();
    return;
  }

  await runScan(args);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
