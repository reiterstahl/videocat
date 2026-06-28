#!/usr/bin/env node
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentErrorInput, AgentFileInput, formatBytes, isVideoExtension } from "@videocat/shared";

const execFileAsync = promisify(execFile);

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

type PendingAgentError = AgentErrorInput;

type State = {
  completed: Record<string, number>;
};

type CountResult = {
  total: number;
  pending: number;
  skipped: number;
};

type CompanionOpenRequest = {
  diskId?: string;
  absolutePath?: string;
  relativePath?: string;
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

const thumbnailPercents = Array.from({ length: 15 }, (_value, index) => {
  const frame = String(index + 1).padStart(2, "0");
  return [`frame_${frame}`, (index + 1) / 16] as const;
});

const markerFileName = ".videocat-disk.json";
const skippedDirectoryNames = new Set(["$recycle.bin", "system volume information"]);
const loadedEnvFiles: string[] = [];
const envSources = new Map<string, string>();
const companionAppName = "videocat-companion";
const companionVersion = 4;
let downloadProcessingRunning = false;

class AgentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

function envSource(name: string): string {
  if (envSources.has(name)) return envSources.get(name)!;
  return process.env[name] ? "variables de entorno de PowerShell/sistema" : "no configurado";
}

function agentTokenHint(): string {
  const files = loadedEnvFiles.length > 0 ? loadedEnvFiles.join(", ") : "ningun .env leido";
  return [
    "El servidor rechazo AGENT_TOKEN.",
    `AGENT_TOKEN usado por el agente: ${envSource("AGENT_TOKEN")}.`,
    `Archivos .env leidos: ${files}.`,
    "Verifica que ese valor coincida exactamente con AGENT_TOKEN en el .env del servidor Docker."
  ].join(" ");
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
    thumbnails: firstValue(values, "no-thumbnails") !== true
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

function companionScanPollMs(): number {
  const value = Number(process.env.COMPANION_SCAN_POLL_MS ?? 900000);
  return Number.isFinite(value) ? Math.max(60000, value) : 900000;
}

async function startCompanionDiskWatcher(): Promise<void> {
  const pollMs = companionDiskPollMs();
  const scanPollMs = companionScanPollMs();
  const deletePollMs = companionDeletePollMs();
  const downloadPollMs = companionDownloadPollMs();
  const heartbeatMs = companionHeartbeatMs();
  let seen = new Set<string>();
  let running = false;
  let deleteReviewRunning = false;
  let downloadReviewRunning = false;
  let heartbeatRunning = false;

  async function scanTarget(root: string, marker: DiskMarker): Promise<void> {
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
      thumbnails: true
    });
  }

  async function checkMountedDisks(initial = false): Promise<void> {
    if (running) return;
    running = true;
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
        await scanTarget(root, marker);
        await processMarkedDeletesForDisk(root, marker);
        await processDownloadQueueForDisk(root, marker);
      }

      seen = current;
    } finally {
      running = false;
    }
  }

  async function reviewKnownTargets(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const mounted = await discoverCompanionTargets();
      for (const { root, marker } of mounted) {
        console.log(`Revision periodica de ruta VideoCAT: ${root} -> ${marker.diskName}`);
        await scanTarget(root, marker);
      }
    } finally {
      running = false;
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
    try {
      const mounted = await discoverCompanionTargets();
      for (const { root, marker } of mounted) {
        await processDownloadQueueForDisk(root, marker, { quietWhenEmpty: true });
      }
    } finally {
      downloadReviewRunning = false;
    }
  }

  async function sendHeartbeat(): Promise<void> {
    if (heartbeatRunning || !companionAgentApiEnabled()) return;
    heartbeatRunning = true;
    try {
      const mounted = await discoverCompanionTargets();
      await companionAgentApi("/api/agent/companion/heartbeat", {
        method: "POST",
        body: JSON.stringify({
          version: companionVersion,
          mountedDiskCount: mounted.length
        })
      });
    } catch (error) {
      console.warn(`Fallo enviando heartbeat del companion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      heartbeatRunning = false;
    }
  }

  await checkMountedDisks(true);
  await sendHeartbeat();
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
  setInterval(() => {
    void sendHeartbeat();
  }, heartbeatMs);
  console.log(`Detector de discos VideoCAT activo cada ${pollMs}ms.`);
  console.log(`Reescaneo de rutas monitoreadas activo cada ${scanPollMs}ms.`);
  console.log(`Revision de borrados pendientes activa cada ${deletePollMs}ms.`);
  console.log(`Revision de descargas pendientes activa cada ${downloadPollMs}ms.`);
  console.log(`Heartbeat del companion activo cada ${heartbeatMs}ms.`);
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
  const expected = process.env.COMPANION_TOKEN;
  if (!expected) return true;
  const headerToken = request.headers["x-videocat-companion-token"];
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const token = typeof headerToken === "string" ? headerToken : bearer;
  if (!token) return false;
  return crypto.timingSafeEqual(
    crypto.createHash("sha256").update(token).digest(),
    crypto.createHash("sha256").update(expected).digest()
  );
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

function cleanRelativePath(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
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
    return path.join(match.root, ...relative.split("/"));
  }

  if (body.absolutePath) {
    const root = volumeRootFromPath(normalizeScanPath(body.absolutePath));
    const marker = await readMarkerAtRoot(root);
    if (marker?.diskId === body.diskId) return path.join(root, ...relative.split("/"));
    const manual = monitoredCompanionTargets().find((target) => target.id === body.diskId);
    if (manual) return path.join(manual.path, ...relative.split("/"));
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
  return Boolean(process.env.SERVER_URL && process.env.AGENT_TOKEN);
}

async function companionAgentApi<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!process.env.SERVER_URL || !process.env.AGENT_TOKEN) {
    throw new Error("SERVER_URL y AGENT_TOKEN son requeridos para la revision automatica.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${process.env.AGENT_TOKEN}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${process.env.SERVER_URL}${url}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function safePathInsideRoot(root: string, relativePathValue: string): string | null {
  const relative = cleanRelativePath(relativePathValue);
  if (!relative) return null;
  const rootResolved = path.resolve(root);
  const target = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(rootResolved, target);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return target;
}

async function removeDeletedFileFromCatalog(fileId: string): Promise<void> {
  await companionAgentApi(`/api/agent/files/${fileId}/catalog`, { method: "DELETE" });
}

async function processMarkedDeletesForDisk(root: string, marker: DiskMarker, options: { quietWhenEmpty?: boolean } = {}): Promise<void> {
  if (process.env.COMPANION_AUTO_DELETE_MARKED === "false") return;
  if (!companionAgentApiEnabled()) {
    console.log("Revision automatica sin borrar: faltan SERVER_URL o AGENT_TOKEN en el .env del agente.");
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
      console.warn(`Ruta insegura omitida: ${file.relativePath}`);
      continue;
    }

    try {
      const kind = await existingPath(target);
      if (kind === "file") {
        await deleteLocalFile(target);
        await removeDeletedFileFromCatalog(file.id);
        deleted += 1;
        console.log(`Borrado automatico: ${file.relativePath}`);
      } else if (!kind) {
        await removeDeletedFileFromCatalog(file.id);
        missing += 1;
        console.log(`Archivo ya no existe; catalogo limpiado: ${file.relativePath}`);
      } else {
        failed += 1;
        console.warn(`No borro porque no es archivo: ${file.relativePath}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`Fallo borrando ${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Borrado automatico terminado en ${marker.diskName}: borrados ${deleted}, ya ausentes ${missing}, fallos ${failed}.`);
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "VideoCAT";
}

async function uniqueDestinationPath(baseDir: string, diskName: string, filename: string): Promise<string> {
  const diskDir = path.join(baseDir, safeName(diskName));
  await fs.mkdir(diskDir, { recursive: true });
  const parsed = path.parse(filename);
  const baseName = safeName(parsed.name).slice(0, 90) || "video";
  const ext = parsed.ext || "";

  for (let index = 0; index < 1000; index += 1) {
    const candidate = path.join(diskDir, index === 0 ? `${baseName}${ext}` : `${baseName}-${index + 1}${ext}`);
    if (!await existingPath(candidate)) return candidate;
  }

  return path.join(diskDir, `${baseName}-${Date.now()}${ext}`);
}

async function updateDownloadStatus(
  queueId: string,
  status: "downloading" | "done" | "failed",
  values: { progressBytes?: number; destinationPath?: string; errorMessage?: string } = {}
): Promise<void> {
  await companionAgentApi(`/api/agent/downloads/${queueId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...values })
  });
}

async function copyFileWithProgress(source: string, destination: string, file: DownloadQueueFile): Promise<void> {
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
  const destinationStream = createWriteStream(destination);
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      copiedBytes += chunk.length;
      lastProgressAt = Date.now();
      void reportProgress();
      callback(null, chunk);
    }
  });

  const watchdog = setInterval(() => {
    if (finished) return;
    if (Date.now() - lastProgressAt < stallMs) return;
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
  try {
    const downloadDir = process.env.COMPANION_DOWNLOAD_DIR?.trim();
    if (!downloadDir) {
      if (!options.quietWhenEmpty) console.log("Descargas automaticas inactivas: falta COMPANION_DOWNLOAD_DIR en la configuracion del companion.");
      return;
    }
    if (!companionAgentApiEnabled()) {
      console.log("Revision automatica sin descargar: faltan SERVER_URL o AGENT_TOKEN en el .env del agente.");
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

        await updateDownloadStatus(file.id, "downloading", { progressBytes: 0 });
        destination = await uniqueDestinationPath(downloadDir, marker.diskName, file.filename);
        await copyFileWithProgress(source, destination, file);
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
  }
}

async function processDownloadQueueForMountedDisks(): Promise<{ processedDisks: number }> {
  const mounted = await discoverCompanionTargets();
  for (const { root, marker } of mounted) {
    await processDownloadQueueForDisk(root, marker);
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
    return response.ok && body?.ok === true;
  } catch {
    return false;
  }
}

async function shutdownExistingCompanion(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: "POST",
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

async function listenCompanion(server: http.Server, port: number, host: string): Promise<"listening" | "occupied"> {
  return new Promise<"listening" | "occupied">((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve("occupied");
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.removeAllListeners("error");
      resolve("listening");
    });
  });
}

async function runCompanion(): Promise<void> {
  const host = "127.0.0.1";
  const port = Number(process.env.COMPANION_PORT ?? 29429);
  const allowedOrigins = companionAllowedOrigins();

  const server = http.createServer((request, response) => {
    void (async () => {
      const origin = companionOrigin(request);
      const responseOrigin = origin && allowedOrigins.has(origin) ? origin : undefined;

      if (request.url === "/health" && request.method === "GET") {
        jsonResponse(response, 200, { ok: true, app: companionAppName, version: companionVersion }, origin);
        return;
      }

      if (request.url === "/health" && request.method === "OPTIONS") {
        jsonResponse(response, 204, {}, origin);
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

      if (request.url === "/shutdown" && request.method === "POST") {
        jsonResponse(response, 200, { ok: true }, responseOrigin);
        setTimeout(() => server.close(() => process.exit(0)), 50);
        return;
      }

      if (!isCompanionTokenAllowed(request)) {
        jsonResponse(response, 401, { ok: false, reason: "forbidden" }, responseOrigin);
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

      if (request.url === "/process-downloads" && request.method === "POST") {
        const result = await processDownloadQueueForMountedDisks();
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
  });

  const firstListen = await listenCompanion(server, port, host);
  if (firstListen === "occupied") {
    console.log(`El puerto ${port} ya esta ocupado. Intentando reemplazar el companion anterior...`);
    const healthOk = await companionHealthCheck(port);
    if (healthOk) await shutdownExistingCompanion(port);
    await new Promise((resolve) => setTimeout(resolve, 450));

    const pids = await windowsListeningPids(port);
    if (pids.length > 0) {
      console.log(`Cerrando proceso anterior en puerto ${port}: PID ${pids.join(", ")}`);
      await killWindowsPids(pids);
      await new Promise((resolve) => setTimeout(resolve, 450));
    }

    const retryServer = http.createServer(server.listeners("request")[0] as http.RequestListener);
    const retryListen = await listenCompanion(retryServer, port, host);
    if (retryListen === "occupied") {
      console.error(`No pude liberar el puerto ${port}. Cambia COMPANION_PORT o cierra el proceso manualmente.`);
      return;
    }
    console.log(`VideoCAT Companion reemplazado correctamente.`);
    console.log(`VideoCAT Companion escuchando en http://${host}:${port}`);
    console.log(`Origenes permitidos: ${[...allowedOrigins].join(", ")}`);
    console.log(process.env.COMPANION_TOKEN ? "Token local requerido por este companion; configuralo tambien en este navegador, no en el servidor." : "Token local opcional no configurado; continuando sin token.");
    await startCompanionDiskWatcher();
    return;
  }

  console.log(`VideoCAT Companion escuchando en http://${host}:${port}`);
  console.log(`Origenes permitidos: ${[...allowedOrigins].join(", ")}`);
  console.log(process.env.COMPANION_TOKEN ? "Token local requerido por este companion; configuralo tambien en este navegador, no en el servidor." : "Token local opcional no configurado; continuando sin token.");
  await startCompanionDiskWatcher();
}

async function runProcessDeletes(): Promise<void> {
  const mounted = await discoverCompanionTargets();
  if (mounted.length === 0) {
    console.log(`No encontre discos o rutas monitoreadas disponibles.`);
    return;
  }

  for (const { root, marker } of mounted) {
    console.log(`Procesando borrados pendientes en ${root} (${marker.diskName})`);
    await processMarkedDeletesForDisk(root, marker);
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
  return {
    Authorization: `Bearer ${requiredEnv("AGENT_TOKEN")}`,
    "Content-Type": "application/json"
  };
}

async function api<T>(url: string, init: RequestInit): Promise<T> {
  const retries = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${requiredEnv("SERVER_URL")}${url}`, init);
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 401 && body.includes("Invalid agent token")) {
          throw new AgentAuthError(`${response.status} ${body}\n${agentTokenHint()}`);
        }
        throw new Error(`${response.status} ${body}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof AgentAuthError) throw error;
      const waitMs = 800 * attempt;
      console.warn(`Intento ${attempt}/${retries} fallo para ${url}. Reintentando en ${waitMs}ms.`);
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
    category: auditCategory(error),
    phase,
    code: errorCode(error),
    message: error instanceof Error ? error.message : String(error),
    absolutePath,
    relativePath: diskRoot ? relativePath(diskRoot, absolutePath) : null
  };
}

async function* walkVideos(root: string, errors?: PendingAgentError[], diskRoot?: string): AsyncGenerator<string> {
  let entries: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    entries = await fs.opendir(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOENT") {
      console.warn(`Omitiendo carpeta no accesible: ${root}`);
      errors?.push(auditError(error, "walk", root, diskRoot));
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
      yield* walkVideos(absolute, errors, diskRoot);
    } else if (entry.isFile() && isVideoExtension(path.extname(entry.name))) {
      yield absolute;
    }
  }
}

async function loadState(statePath: string): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8")) as State;
  } catch {
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

function thumbnailTempName(relativePathValue: string, kind: string): string {
  const digest = crypto.createHash("sha256").update(relativePathValue).digest("hex").slice(0, 32);
  return `${digest}-${kind}.jpg`;
}

async function countVideos(targets: ScanTarget[], diskRoot: string, state: State, errors: PendingAgentError[]): Promise<CountResult> {
  let total = 0;
  let pending = 0;
  let skipped = 0;

  for (const target of targets) {
    console.log(`Contando videos en ${target.scanPath}`);
    for await (const filePath of walkVideos(target.scanPath, errors, diskRoot)) {
      total += 1;
      try {
        const stat = await fs.stat(filePath);
        const rel = relativePath(diskRoot, filePath);
        if (state.completed[rel] === stat.mtime.getTime()) {
          skipped += 1;
        } else {
          pending += 1;
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOENT") {
          console.warn(`Omitiendo archivo no accesible durante conteo: ${filePath}`);
          errors.push(auditError(error, "count", filePath, diskRoot));
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
      fileSystem: os.platform() === "win32" ? "windows" : undefined
    };
  } catch {
    return {};
  }
}

function parseFps(value?: string): number | null {
  if (!value || value === "0/0") return null;
  const [top, bottom] = value.split("/").map(Number);
  if (!top || !bottom) return null;
  return top / bottom;
}

async function ffprobe(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ], { maxBuffer: 1024 * 1024 * 20 });

  const raw = JSON.parse(stdout);
  const videoStream = raw.streams?.find((stream: Record<string, unknown>) => stream.codec_type === "video");
  const audioStream = raw.streams?.find((stream: Record<string, unknown>) => stream.codec_type === "audio");
  const duration = Number(raw.format?.duration ?? videoStream?.duration ?? 0);

  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: Number(videoStream?.width) || null,
    height: Number(videoStream?.height) || null,
    fps: parseFps(String(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate ?? "")),
    videoCodec: typeof videoStream?.codec_name === "string" ? videoStream.codec_name : null,
    audioCodec: typeof audioStream?.codec_name === "string" ? audioStream.codec_name : null,
    audioChannels: Number(audioStream?.channels) || null,
    bitrate: Number(raw.format?.bit_rate) || null,
    containerFormat: typeof raw.format?.format_name === "string" ? raw.format.format_name : null,
    streamCount: Array.isArray(raw.streams) ? raw.streams.length : null,
    raw
  };
}

async function createThumbnail(source: string, destination: string, seconds: number): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    String(Math.max(0, seconds)),
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-1",
    "-update",
    "1",
    "-q:v",
    "3",
    destination
  ], { maxBuffer: 1024 * 1024 * 10 });
}

async function processFile(
  scanRoot: string,
  filePath: string,
  scanId: string,
  thumbnailsEnabled: boolean,
  folderSizeCache: Map<string, number | null>,
  errors: PendingAgentError[]
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

  try {
    const metadata = await ffprobe(filePath);
    const thumbs: ThumbResult[] = [];
    let status: AgentFileInput["status"] = "scanned";
    let errorMessage: string | null = null;

    if (thumbnailsEnabled && metadata.durationSeconds) {
      for (const [kind, percent] of thumbnailPercents) {
        const timestampSeconds = Math.max(0.1, metadata.durationSeconds * percent);
        const destination = path.join(
          process.cwd(),
          ".videocat-agent-state",
          scanId,
          thumbnailTempName(rel, kind)
        );
        try {
          await createThumbnail(filePath, destination, timestampSeconds);
          thumbs.push({ kind, timestampSeconds, filePath: destination });
        } catch (error) {
          status = "thumbnail_failed";
          errorMessage = error instanceof Error ? error.message : "thumbnail_failed";
        }
      }
    }

    return {
      record: {
        ...baseRecord,
        status,
        errorMessage,
        metadata
      },
      thumbnails: thumbs
    };
  } catch (error) {
    return {
      record: {
        ...baseRecord,
        status: "metadata_failed",
        errorMessage: error instanceof Error ? error.message : "metadata_failed",
        metadata: null
      },
      thumbnails: []
    };
  }
}

async function uploadBatch(scanId: string, diskId: string, batch: ProcessedFile[]): Promise<void> {
  if (batch.length === 0) return;
  await api("/api/agent/files/batch", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      scanId,
      diskId,
      files: batch.map((item) => item.record)
    })
  });

  for (const item of batch) {
    for (const thumb of item.thumbnails) {
      await uploadThumbnail(diskId, item.record.relativePath, thumb);
    }
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
    headers: {
      Authorization: `Bearer ${requiredEnv("AGENT_TOKEN")}`
    },
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
      errors
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

async function runScan(args: Args): Promise<void> {
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
      fileSystem: diskInfo.fileSystem
    })
  });

  const statePath = path.join(process.cwd(), ".videocat-agent-state", resolved.volumeId ?? disk.id, "scan-state.json");
  const state = await loadState(statePath);

  const { scan } = await api<{ scan: { id: string } }>("/api/agent/scan/start", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ diskId: disk.id, rootPath: resolved.diskRoot })
  });
  const auditErrors: PendingAgentError[] = [];
  const folderSizeCache = new Map<string, number | null>();
  const counts = await countVideos(scanTargets, resolved.diskRoot, state, auditErrors);
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

  let pendingPaths: string[] = [];
  let batch: ProcessedFile[] = [];
  let discovered = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let processedPending = 0;

  async function processGroup(paths: string[]) {
    const processed = await Promise.all(paths.map((item) => {
      processedPending += 1;
      const remaining = Math.max(counts.pending - processedPending, 0);
      console.log(`Procesando ${processedPending}/${counts.pending} (faltan ${remaining}): ${compactFileLabel(item)}`);
      return processFile(resolved.diskRoot, item, scan.id, args.thumbnails, folderSizeCache, auditErrors);
    }));
    batch.push(...processed);
    failed += processed.filter((item) => item.record.status !== "scanned").length;
    if (batch.length >= args.batchSize) {
      await uploadBatch(scan.id, disk.id, batch);
      for (const item of batch) {
        state.completed[item.record.relativePath] = new Date(item.record.modifiedAt ?? 0).getTime();
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

  for (const target of scanTargets) {
    console.log(`Escaneando ${target.scanPath}`);
    for await (const filePath of walkVideos(target.scanPath, auditErrors, resolved.diskRoot)) {
      discovered += 1;
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOENT") {
          console.warn(`Omitiendo archivo no accesible: ${filePath}`);
          auditErrors.push(auditError(error, "stat", filePath, resolved.diskRoot));
          continue;
        }
        throw error;
      }
      const rel = relativePath(resolved.diskRoot, filePath);
      if (state.completed[rel] === stat.mtime.getTime()) {
        skipped += 1;
        continue;
      }

      pendingPaths.push(filePath);
      if (pendingPaths.length >= concurrency) {
        await processGroup(pendingPaths);
        pendingPaths = [];
      }
    }
  }

  if (pendingPaths.length > 0) await processGroup(pendingPaths);
  if (batch.length > 0) {
    await uploadBatch(scan.id, disk.id, batch);
    for (const item of batch) {
      state.completed[item.record.relativePath] = new Date(item.record.modifiedAt ?? 0).getTime();
    }
    uploaded += batch.length;
    await saveState(statePath, state);
  }
  if (auditErrors.length > 0) {
    await uploadAuditErrors(scan.id, disk.id, auditErrors.splice(0, auditErrors.length));
  }

  await api("/api/agent/scan/finish", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ scanId: scan.id })
  });

  console.log("Escaneo finalizado.");
  console.log(`Detectados: ${discovered}. Omitidos por estado local: ${skipped}. Subidos: ${uploaded}. Fallos: ${failed}.`);
}

async function main() {
  await loadEnvFile();
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
