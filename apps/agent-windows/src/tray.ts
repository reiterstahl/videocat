import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray } from "electron";
import type { OpenDialogOptions } from "electron";
import { companionRestartDelayMs, companionRunWasStable } from "./companion-supervisor.js";
import { loadOrCreateCompanionIdentity } from "./identity.js";
import { generateCompanionToken, minimumCompanionTokenLength } from "./local-auth.js";

type DiskMarker = {
  schemaVersion: 1;
  diskId: string;
  diskName: string;
  createdAt: string;
  scanRoots: string[];
  notes?: string;
};

type MountedDisk = {
  root: string;
  marker: DiskMarker;
};

type CompanionTarget = {
  id: string;
  name: string;
  path: string;
  enabled?: boolean;
};

type AvailableDrive = {
  root: string;
  diskId?: string;
  diskName?: string;
};

type LogLevel = "info" | "warn" | "error";
type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
};

const markerFileName = ".videocat-disk.json";
const loadedEnvFiles: string[] = [];
const configKeys = [
  "SERVER_URL",
  "WEB_URL",
  "AGENT_TOKEN",
  "AGENT_STATE_DIR",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
  "COMPANION_PORT",
  "COMPANION_ALLOWED_ORIGINS",
  "COMPANION_TOKEN",
  "COMPANION_NAME",
  "COMPANION_DISK_POLL_MS",
  "COMPANION_SCAN_POLL_MS",
  "COMPANION_HEARTBEAT_MS",
  "COMPANION_DELETE_POLL_MS",
  "COMPANION_DOWNLOAD_POLL_MS",
  "COMPANION_DOWNLOAD_STALL_MS",
  "COMPANION_DOWNLOAD_DIR",
  "COMPANION_REMOTE_REMUX_ENABLED",
  "COMPANION_AUTO_DELETE_MARKED",
  "COMPANION_MONITORED_TARGETS",
  "COMPANION_DISABLED_DISK_IDS",
  "TRAY_DISK_POLL_MS"
] as const;
type ConfigKey = typeof configKeys[number];
type ConfigSaveResult = { ok: true; path: string } | { ok: false; message: string };
type PairingResult = { ok: true; companionId: string; issuedAt: string } | { ok: false; message: string };
type StoredCompanionCredential = {
  schemaVersion: 1;
  companionId: string;
  serverUrl: string;
  encryptedCredential: string;
  issuedAt: string;
};
type PairingStatus = {
  paired: boolean;
  companionId: string | null;
  serverUrl: string | null;
  issuedAt: string | null;
  encryptionAvailable: boolean;
};

const requiredConfigKeys = new Set<ConfigKey>(["SERVER_URL"]);
const configDefaults: Partial<Record<ConfigKey, string>> = {
  COMPANION_PORT: "29429",
  COMPANION_DISK_POLL_MS: "5000",
  COMPANION_SCAN_POLL_MS: "900000",
  COMPANION_HEARTBEAT_MS: "15000",
  COMPANION_DELETE_POLL_MS: "60000",
  COMPANION_DOWNLOAD_POLL_MS: "60000",
  COMPANION_DOWNLOAD_STALL_MS: "30000",
  COMPANION_REMOTE_REMUX_ENABLED: "false",
  COMPANION_AUTO_DELETE_MARKED: "true",
  TRAY_DISK_POLL_MS: "10000"
};
let tray: Tray | null = null;
let companion: ChildProcessWithoutNullStreams | null = null;
let companionRestartTimer: NodeJS.Timeout | null = null;
let companionRestartFailures = 0;
let appQuitting = false;
let lastMounted: MountedDisk[] = [];
let configWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;
let busy = false;
let nextLogId = 1;
let duplicateLaunchPending = false;
let pairedCredential: string | null = null;
let storedCredential: StoredCompanionCredential | null = null;
const logEntries: LogEntry[] = [];
const maxLogEntries = 1000;

function resourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? process.cwd();
}

function userEnvPath(): string {
  return path.join(app.getPath("userData"), ".env");
}

function agentStateRoot(): string {
  const configured = process.env.AGENT_STATE_DIR?.trim();
  if (configured) return path.resolve(configured);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "VideoCAT", "agent-state");
}

function credentialPath(): string {
  return path.join(app.getPath("userData"), "companion-credential.json");
}

function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("SERVER_URL debe iniciar con http:// o https://.");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

async function loadStoredCredential(): Promise<void> {
  pairedCredential = null;
  storedCredential = null;
  try {
    const parsed = JSON.parse(await fs.readFile(credentialPath(), "utf8")) as Partial<StoredCompanionCredential>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.companionId !== "string"
      || typeof parsed.serverUrl !== "string"
      || typeof parsed.encryptedCredential !== "string"
      || typeof parsed.issuedAt !== "string"
      || !safeStorage.isEncryptionAvailable()
    ) return;
    const decrypted = safeStorage.decryptString(Buffer.from(parsed.encryptedCredential, "base64"));
    if (!decrypted) return;
    storedCredential = parsed as StoredCompanionCredential;
    pairedCredential = decrypted;
  } catch {
    // Missing, unreadable or machine-incompatible credentials require pairing again.
  }
}

async function saveStoredCredential(record: Omit<StoredCompanionCredential, "schemaVersion" | "encryptedCredential">, credential: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows no permite cifrar la credencial en este momento. Inicia sesion normalmente e intenta de nuevo.");
  }
  const next: StoredCompanionCredential = {
    schemaVersion: 1,
    ...record,
    encryptedCredential: safeStorage.encryptString(credential).toString("base64")
  };
  await fs.mkdir(path.dirname(credentialPath()), { recursive: true });
  await fs.writeFile(credentialPath(), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  storedCredential = next;
  pairedCredential = credential;
}

async function pairingStatus(): Promise<PairingStatus> {
  const companionId = await loadOrCreateCompanionIdentity(agentStateRoot());
  return {
    paired: Boolean(pairedCredential && storedCredential),
    companionId,
    serverUrl: storedCredential?.serverUrl ?? null,
    issuedAt: storedCredential?.issuedAt ?? null,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

function preloadPath(): string {
  if (app.isPackaged) return path.join(resourcesPath(), "app.asar", "dist", "tray-preload.cjs");
  return path.join(app.getAppPath(), "dist", "tray-preload.cjs");
}

function normalizeScanRoot(root: string): string {
  const cleaned = root.trim().replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
  return cleaned === "" || cleaned === "." ? "." : cleaned;
}

function normalizeTargetPath(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
  return path.resolve(trimmed);
}

function parseTargets(value: string | undefined): CompanionTarget[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as Array<Partial<CompanionTarget>>;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((target) => {
      if (!target.id || !target.name || !target.path) return [];
      const normalizedPath = normalizeTargetPath(target.path);
      const key = `${target.id}:${normalizedPath.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: target.id,
        name: target.name,
        path: normalizedPath,
        enabled: target.enabled !== false
      }];
    });
  } catch {
    return [];
  }
}

function serializeTargets(targets: CompanionTarget[]): string {
  return JSON.stringify(targets.map((target) => ({
    id: target.id,
    name: target.name.trim(),
    path: normalizeTargetPath(target.path),
    enabled: target.enabled !== false
  })));
}

function parseEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

async function loadEnvCandidate(candidate: string, overrideExisting: boolean): Promise<void> {
  try {
    const raw = await fs.readFile(candidate, "utf8");
    if (!loadedEnvFiles.includes(candidate)) loadedEnvFiles.push(candidate);
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsAt = trimmed.indexOf("=");
      if (equalsAt <= 0) continue;
      const key = trimmed.slice(0, equalsAt).trim();
      const value = parseEnvValue(trimmed.slice(equalsAt + 1));
      if (overrideExisting || process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // Env files are optional.
  }
}

async function loadEnvFile(): Promise<void> {
  const baseCandidates = [
    path.join(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env")
  ];

  for (const candidate of [...new Set(baseCandidates)]) {
    await loadEnvCandidate(candidate, false);
  }
  await loadEnvCandidate(userEnvPath(), true);
}

function currentConfig(): Record<string, string> {
  return Object.fromEntries(configKeys.map((key) => [key, process.env[key] ?? configDefaults[key] ?? ""]));
}

function normalizeConfig(values: Record<string, string>): Record<ConfigKey, string> {
  const normalized = Object.fromEntries(configKeys.map((key) => {
    const value = String(values[key] ?? "").trim();
    return [key, value || configDefaults[key] || ""];
  })) as Record<ConfigKey, string>;
  // The local listener only accepts authenticated requests, so an empty or weak token is replaced.
  if (normalized.COMPANION_TOKEN.length < minimumCompanionTokenLength) normalized.COMPANION_TOKEN = generateCompanionToken();
  normalized.COMPANION_MONITORED_TARGETS = serializeTargets(parseTargets(normalized.COMPANION_MONITORED_TARGETS));
  normalized.COMPANION_DISABLED_DISK_IDS = normalized.COMPANION_DISABLED_DISK_IDS
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
  return normalized;
}

function envLine(key: ConfigKey, value: string): string {
  if (!value) return `${key}=`;
  if (/[\s#"']/.test(value)) {
    return `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return `${key}=${value}`;
}

function validateUrl(value: string, label: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return `${label} debe iniciar con http:// o https://.`;
  } catch {
    return `${label} no parece una URL valida.`;
  }
  return null;
}

function validatePositiveInteger(value: string, label: string): string | null {
  if (!/^\d+$/.test(value) || Number(value) <= 0) return `${label} debe ser un numero entero mayor a cero.`;
  return null;
}

function hasPairedCredentialFor(serverUrl: string): boolean {
  try {
    return Boolean(pairedCredential && storedCredential && normalizeServerUrl(serverUrl) === storedCredential.serverUrl);
  } catch {
    return false;
  }
}

function validateConfig(values: Record<ConfigKey, string>, allowMissingCredential = false): string | null {
  for (const key of requiredConfigKeys) {
    if (!values[key]) return `${key} es obligatorio.`;
  }

  if (!allowMissingCredential && !values.AGENT_TOKEN && !hasPairedCredentialFor(values.SERVER_URL)) {
    return "Empareja este Companion o configura AGENT_TOKEN para continuar.";
  }

  return validateUrl(values.SERVER_URL, "SERVER_URL")
    ?? (values.WEB_URL ? validateUrl(values.WEB_URL, "WEB_URL") : null)
    ?? validatePositiveInteger(values.COMPANION_PORT, "COMPANION_PORT")
    ?? validatePositiveInteger(values.COMPANION_DISK_POLL_MS, "COMPANION_DISK_POLL_MS")
    ?? validatePositiveInteger(values.COMPANION_SCAN_POLL_MS, "COMPANION_SCAN_POLL_MS")
    ?? validatePositiveInteger(values.COMPANION_HEARTBEAT_MS, "COMPANION_HEARTBEAT_MS")
    ?? validatePositiveInteger(values.COMPANION_DELETE_POLL_MS, "COMPANION_DELETE_POLL_MS")
    ?? validatePositiveInteger(values.COMPANION_DOWNLOAD_POLL_MS, "COMPANION_DOWNLOAD_POLL_MS")
    ?? validatePositiveInteger(values.COMPANION_DOWNLOAD_STALL_MS, "COMPANION_DOWNLOAD_STALL_MS")
    ?? validatePositiveInteger(values.TRAY_DISK_POLL_MS, "TRAY_DISK_POLL_MS")
    ?? (!/^(true|false)$/i.test(values.COMPANION_REMOTE_REMUX_ENABLED)
      ? "COMPANION_REMOTE_REMUX_ENABLED debe ser true o false."
      : null)
    ?? (!/^(true|false)$/i.test(values.COMPANION_AUTO_DELETE_MARKED)
      ? "COMPANION_AUTO_DELETE_MARKED debe ser true o false."
      : null);
}

async function saveConfig(values: Record<ConfigKey, string>): Promise<string> {
  await fs.mkdir(path.dirname(userEnvPath()), { recursive: true });
  const lines = configKeys.map((key) => {
    process.env[key] = values[key];
    return envLine(key, values[key]);
  });
  const target = userEnvPath();
  await fs.writeFile(target, `${lines.join("\n")}\n`);
  if (!loadedEnvFiles.includes(target)) loadedEnvFiles.push(target);
  return target;
}

function agentScriptPath(): string {
  if (app.isPackaged) return path.join(resourcesPath(), "app.asar", "dist", "index.js");
  return path.join(app.getAppPath(), "dist", "index.js");
}

function childEnv(): NodeJS.ProcessEnv {
  let credential: string | undefined;
  try {
    if (
      hasPairedCredentialFor(process.env.SERVER_URL ?? "")
      && pairedCredential
    ) credential = pairedCredential;
  } catch {
    credential = undefined;
  }
  return {
    ...process.env,
    ...(credential && storedCredential ? {
      VIDEOCAT_AGENT_CREDENTIAL: credential,
      VIDEOCAT_COMPANION_ID: storedCredential.companionId
    } : {}),
    ELECTRON_RUN_AS_NODE: "1"
  };
}

async function pairCompanion(code: string, values: Record<string, string>): Promise<PairingResult> {
  try {
    const normalized = normalizeConfig(values);
    const validationError = validateConfig(normalized, true);
    if (validationError) return { ok: false, message: validationError };
    const serverUrl = normalizeServerUrl(normalized.SERVER_URL);
    const companionId = await loadOrCreateCompanionIdentity(
      normalized.AGENT_STATE_DIR ? path.resolve(normalized.AGENT_STATE_DIR) : agentStateRoot()
    );
    const response = await fetch(`${serverUrl}/api/agent/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        companionId,
        companionName: normalized.COMPANION_NAME || os.hostname(),
        version: Number(app.getVersion().split(".").at(-1)) || 0
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      return { ok: false, message: body?.message ?? `El servidor rechazo el emparejamiento (${response.status}).` };
    }
    const body = await response.json() as { credential?: string; issuedAt?: string };
    if (!body.credential || !body.issuedAt) return { ok: false, message: "El servidor devolvio una respuesta de emparejamiento incompleta." };

    await saveStoredCredential({ companionId, serverUrl, issuedAt: body.issuedAt }, body.credential);
    normalized.AGENT_TOKEN = "";
    const target = await saveConfig(normalized);
    addLog("info", "seguridad", `Companion emparejado con ${serverUrl}. Configuración: ${target}`);
    restartCompanion();
    updateMenu();
    notify("VideoCAT Companion", "Emparejamiento completado. La credencial individual se guardo cifrada.");
    return { ok: true, companionId, issuedAt: body.issuedAt };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function notifyAlreadyRunning(): void {
  if (!app.isReady()) {
    duplicateLaunchPending = true;
    return;
  }
  duplicateLaunchPending = false;
  notify("VideoCAT Companion", "El Companion ya esta en ejecucion en la bandeja del sistema.");
}

function addLog(level: LogLevel, source: string, message: string): void {
  const lines = String(message)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  for (const line of lines.length > 0 ? lines : [""]) {
    const entry: LogEntry = {
      id: nextLogId++,
      timestamp: new Date().toISOString(),
      level,
      source,
      message: line
    };
    logEntries.push(entry);
    if (logEntries.length > maxLogEntries) logEntries.shift();
    logWindow?.webContents.send("log:entry", entry);
  }
}

function clearLogs(): void {
  logEntries.length = 0;
  logWindow?.webContents.send("log:cleared");
}

function spawnAgent(args: string[]): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [agentScriptPath(), ...args], {
    env: childEnv(),
    windowsHide: true
  });
}

function runAgentTask(label: string, args: string[]): void {
  if (busy) {
    notify("VideoCAT", "Ya hay una tarea en ejecucion.");
    return;
  }

  busy = true;
  updateMenu();
  addLog("info", label, `Iniciando: ${args.join(" ")}`);
  const child = spawnAgent(args);
  let output = "";

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    addLog("info", label, text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    addLog("error", label, text);
  });
  child.once("close", (code) => {
    busy = false;
    void refreshMountedDisks().finally(updateMenu);
    const tail = output.trim().split(/\r?\n/).slice(-3).join("\n");
    addLog(code === 0 ? "info" : "error", label, `Terminado con código ${code ?? "desconocido"}.`);
    notify("VideoCAT", code === 0 ? `${label} terminado.` : `${label} fallo.\n${tail}`.slice(0, 240));
  });
}

async function readMarkerAtRoot(root: string): Promise<DiskMarker | null> {
  try {
    const raw = await fs.readFile(path.join(root, markerFileName), "utf8");
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

async function discoverAccessibleDrives(): Promise<AvailableDrive[]> {
  const drives: AvailableDrive[] = [];
  for (const letter of "BCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${letter}:\\`;
    try {
      await fs.access(root);
      const marker = await readMarkerAtRoot(root);
      drives.push({ root, diskId: marker?.diskId, diskName: marker?.diskName });
    } catch {
      // Drive is not mounted.
    }
  }
  return drives;
}

async function discoverMountedMarkers(): Promise<MountedDisk[]> {
  const disabled = new Set((process.env.COMPANION_DISABLED_DISK_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const disks: MountedDisk[] = [];
  for (const drive of await discoverAccessibleDrives()) {
    if (!drive.diskId || disabled.has(drive.diskId)) continue;
    const marker = await readMarkerAtRoot(drive.root);
    if (marker) disks.push({ root: drive.root, marker });
  }
  return disks;
}

async function refreshMountedDisks(): Promise<void> {
  const previous = new Set(lastMounted.map((disk) => disk.marker.diskId));
  lastMounted = await discoverMountedMarkers();
  for (const disk of lastMounted) {
    if (!previous.has(disk.marker.diskId)) {
      addLog("info", "discos", `Detectado ${disk.marker.diskName} en ${disk.root}`);
    }
  }
}

function startCompanion(): void {
  if (companion && !companion.killed) return;

  if (companionRestartTimer) {
    clearTimeout(companionRestartTimer);
    companionRestartTimer = null;
  }

  addLog("info", "companion", `Iniciando companion v${app.getVersion()}.`);
  const child = spawnAgent(["companion"]);
  const startedAt = Date.now();
  companion = child;
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    console.log(text.trim());
    addLog("info", "companion", text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    console.error(text.trim());
    addLog("error", "companion", text);
  });
  child.once("error", (error) => {
    addLog("error", "companion", `No se pudo iniciar el proceso: ${error.message}`);
  });
  child.once("exit", (code) => {
    const stoppedIntentionally = child.killed || appQuitting || companion !== child;
    addLog(code === 0 ? "info" : "warn", "companion", `Companion detenido con código ${code ?? "desconocido"}.`);
    if (companion === child) companion = null;
    updateMenu();

    if (stoppedIntentionally) return;
    if (companionRunWasStable(startedAt, Date.now())) companionRestartFailures = 0;
    const delayMs = companionRestartDelayMs(companionRestartFailures);
    companionRestartFailures += 1;
    addLog("warn", "companion", `Reinicio automático programado en ${Math.round(delayMs / 1000)} segundo(s).`);
    if (companionRestartFailures === 1) {
      notify("VideoCAT Companion", "El proceso se detuvo inesperadamente. Se intentara reiniciar automaticamente.");
    }
    companionRestartTimer = setTimeout(() => {
      companionRestartTimer = null;
      if (!appQuitting && !companion) startCompanion();
    }, delayMs);
  });
}

function stopCompanion(): void {
  if (companionRestartTimer) {
    clearTimeout(companionRestartTimer);
    companionRestartTimer = null;
  }
  const child = companion;
  if (child && !child.killed) addLog("info", "companion", "Deteniendo companion.");
  if (companion === child) companion = null;
  child?.kill();
}

function restartCompanion(): void {
  companionRestartFailures = 0;
  stopCompanion();
  startCompanion();
}

async function openVideoCat(): Promise<void> {
  const target = process.env.WEB_URL ?? process.env.SERVER_URL ?? "http://localhost:8081";
  const parsed = new URL(target);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("WEB_URL debe usar http:// o https://.");
  }
  await shell.openExternal(parsed.toString());
}

function configHtml(logoDataUrl: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>VideoCAT Companion v${app.getVersion()}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f4f6; --surface: #ffffff; --sunken: #f6f7f9; --hover: #eef0f3;
      --border: #e2e5e9; --border-strong: #cdd2d8; --text: #14181c; --text-soft: #2b333b; --muted: #5b6670;
      --accent: #fc6121; --accent-strong: #c2410c; --accent-soft: #fff0e8; --accent-ink: #8a2e07;
      --success: #15803d; --success-soft: #e7f6ec; --danger: #b91c1c; --danger-soft: #fdecec;
      --shadow: 0 1px 2px rgba(16, 24, 32, 0.05), 0 10px 28px rgba(16, 24, 32, 0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #0d0f12; --surface: #15181c; --sunken: #111418; --hover: #1f242a;
        --border: #252a30; --border-strong: #363d45; --text: #e8ecef; --text-soft: #cfd6dc; --muted: #9aa5ae;
        --accent-soft: #3a1d10; --accent-ink: #ffb08a;
        --success: #4ade80; --success-soft: #11291b; --danger: #f87171; --danger-soft: #2c1414;
        --shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
    header { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px); }
    .catmark { width: 30px; height: 25px; flex: 0 0 auto; background: var(--accent); -webkit-mask: url("${logoDataUrl}") center / contain no-repeat; mask: url("${logoDataUrl}") center / contain no-repeat; }
    h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    h1 span { color: var(--accent); }
    .version { border: 1px solid var(--border); border-radius: 6px; padding: 1px 7px; color: var(--muted); font: 11px ui-monospace, Consolas, monospace; }
    .spacer { flex: 1 1 auto; }
    .pair-status { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .pair-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .pair-status.is-paired { background: var(--success-soft); color: var(--success); }
    main { width: min(1080px, 100%); margin: 0 auto; padding: 16px 20px 88px; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
    .card { min-width: 0; display: grid; gap: 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 14px 16px; box-shadow: var(--shadow); }
    .card.full { grid-column: 1 / -1; }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .card-head > div:first-child { display: grid; gap: 2px; flex: 1 1 260px; }
    .card-head { flex-wrap: wrap; }
    h2 { margin: 0; font-size: 14px; font-weight: 600; }
    p, .hint { margin: 0; color: var(--muted); font-size: 12px; font-weight: 400; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
    .fields.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .wide { grid-column: 1 / -1; }
    label { min-width: 0; display: grid; gap: 4px; color: var(--text-soft); font-size: 12px; font-weight: 500; }
    label code { justify-self: start; overflow: hidden; max-width: 100%; color: var(--muted); font: 10.5px ui-monospace, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .label-row { display: grid; gap: 0; }
    .required { color: var(--accent); }
    .card-head > .hint { white-space: nowrap; }
    input, select, textarea { width: 100%; height: 34px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; }
    textarea { height: auto; min-height: 64px; padding: 8px 10px; resize: vertical; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 24%, transparent); }
    input:invalid { border-color: color-mix(in srgb, var(--accent) 70%, var(--border)); }
    input::placeholder { color: color-mix(in srgb, var(--muted) 70%, transparent); }
    button { height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover:not(:disabled) { background: var(--hover); }
    button.primary { border-color: var(--accent-strong); background: var(--accent-strong); color: #ffffff; }
    button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-strong) 88%, #000000); }
    button.ghost { background: transparent; }
    button.danger { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: transparent; color: var(--danger); }
    button.danger:hover:not(:disabled) { background: var(--danger-soft); }
    button:disabled { opacity: 0.55; cursor: default; }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .inline { display: flex; align-items: flex-end; gap: 8px; }
    .inline > label { flex: 1 1 auto; }
    .pair-code { font-family: ui-monospace, Consolas, monospace; letter-spacing: 2px; text-transform: uppercase; }
    .note { border-radius: 10px; background: var(--sunken); padding: 8px 10px; color: var(--muted); font-size: 12px; }
    details.legacy { border-top: 1px solid var(--border); padding-top: 10px; }
    details.legacy summary, details.card summary { cursor: pointer; color: var(--text-soft); font-weight: 600; list-style: none; }
    details.legacy summary::before, details.card summary::before { content: "▸ "; color: var(--muted); }
    details[open].legacy summary::before, details[open].card summary::before { content: "▾ "; }
    details.legacy label { margin-top: 10px; }
    details.card { padding: 12px 16px; }
    details.card[open] { gap: 12px; }
    .monitor-actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .monitor-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .monitor-group { min-width: 0; display: grid; align-content: start; gap: 6px; }
    .monitor-group-title { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
    .drive-picker { display: grid; gap: 6px; border: 1px dashed var(--accent); border-radius: 10px; background: var(--accent-soft); padding: 8px; }
    .drive-picker[hidden] { display: none; }
    #targetList, #autoDiskList { display: grid; gap: 6px; }
    .monitor-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 8px 10px; }
    .monitor-row strong, .monitor-row span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .monitor-row strong { font-size: 13px; font-weight: 600; }
    .monitor-row span { color: var(--muted); font: 11.5px ui-monospace, Consolas, monospace; margin-top: 1px; }
    .monitor-row small { display: inline-block; margin-top: 4px; border-radius: 999px; background: var(--hover); color: var(--text-soft); padding: 1px 8px; font-size: 10.5px; font-weight: 600; }
    .monitor-row button { height: 30px; font-size: 12px; }
    .monitor-empty { border: 1px dashed var(--border-strong); border-radius: 10px; color: var(--muted); padding: 10px; font-size: 12px; }
    .token-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .actions { position: fixed; right: 0; bottom: 0; left: 0; z-index: 6; display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 94%, transparent); padding: 10px 20px; backdrop-filter: blur(12px); }
    #status { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--success); font-size: 12.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    #status.is-error { color: var(--danger); }
    #status.is-info { color: var(--muted); }
    @media (max-width: 760px) {
      form, .monitor-columns { grid-template-columns: minmax(0, 1fr); }
      .fields.three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      main { padding: 12px 12px 88px; }
    }
  </style>
</head>
<body>
  <header>
    <span class="catmark" aria-hidden="true"></span>
    <h1>Video<span>CAT</span> Companion</h1>
    <span class="version">v${app.getVersion()}</span>
    <span class="spacer"></span>
    <span id="pairStatus" class="pair-status">Sin emparejar</span>
  </header>
  <main>
    <form id="form">
      <section class="card">
        <div class="card-head">
          <div><h2>Conexión con VideoCAT</h2><p>Servidor al que este equipo reporta escaneos y del que recibe tareas.</p></div>
          <span class="hint"><span class="required">*</span> obligatorio</span>
        </div>
        <div class="fields">
          <label class="wide"><span class="label-row"><span>URL del servidor <span class="required">*</span></span><code>SERVER_URL</code></span><input name="SERVER_URL" required placeholder="http://192.168.1.x:8081" /></label>
          <label><span class="label-row"><span>URL de la web</span><code>WEB_URL</code></span><input name="WEB_URL" placeholder="https://cat.example.com" /></label>
          <label><span class="label-row"><span>Nombre del equipo</span><code>COMPANION_NAME</code></span><input name="COMPANION_NAME" placeholder="Opcional" /></label>
        </div>
        <details class="legacy">
          <summary>Token compartido (solo clientes heredados)</summary>
          <label><span class="label-row"><span>Token compartido</span><code>AGENT_TOKEN</code></span><input name="AGENT_TOKEN" type="password" autocomplete="off" /></label>
        </details>
      </section>

      <section class="card">
        <div class="card-head">
          <div><h2>Emparejamiento</h2><p>Genera un código en VideoCAT › Administración › Companions. Solo se usa una vez.</p></div>
        </div>
        <div class="inline">
          <label><span class="label-row"><span>Código de emparejamiento</span></span><input id="pairCode" class="pair-code" maxlength="11" placeholder="ABCDE-23456" autocomplete="one-time-code" /></label>
          <button type="button" id="pair" class="primary">Emparejar</button>
        </div>
        <div id="pairDetail" class="note"></div>
      </section>

      <section class="card">
        <div class="card-head">
          <div><h2>Token del navegador</h2><p>Abrir, copiar y borrar archivos desde la web solo se acepta con este token. Pégalo en VideoCAT › Perfil › Companion local en cada navegador de esta PC.</p></div>
        </div>
        <label><span class="label-row"><span>Token local</span><code>COMPANION_TOKEN</code></span><input name="COMPANION_TOKEN" id="companionToken" type="password" autocomplete="off" spellcheck="false" /></label>
        <div class="token-actions">
          <button type="button" id="copyToken" class="primary">Copiar token</button>
          <button type="button" id="toggleToken" class="ghost">Mostrar</button>
        </div>
        <p>Si lo borras y guardas, se genera uno nuevo y habrá que pegarlo otra vez en el navegador.</p>
      </section>

      <section class="card">
        <div class="card-head">
          <div><h2>Archivos y herramientas</h2><p>Destino de las copias y rutas opcionales de FFmpeg.</p></div>
        </div>
        <div class="fields">
          <label class="wide"><span class="label-row"><span>Carpeta de descargas</span><code>COMPANION_DOWNLOAD_DIR</code></span><input name="COMPANION_DOWNLOAD_DIR" placeholder="C:\\Users\\tu_usuario\\Desktop\\VideoCAT" /></label>
          <label><span class="label-row"><span>FFmpeg</span><code>FFMPEG_PATH</code></span><input name="FFMPEG_PATH" placeholder="Detección automática" /></label>
          <label><span class="label-row"><span>FFprobe</span><code>FFPROBE_PATH</code></span><input name="FFPROBE_PATH" placeholder="Detección automática" /></label>
          <label class="wide"><span class="label-row"><span>Carpeta de estado</span><code>AGENT_STATE_DIR</code></span><input name="AGENT_STATE_DIR" placeholder="Automática: %LOCALAPPDATA%\\VideoCAT\\agent-state" /></label>
        </div>
      </section>

      <section class="card full">
        <div class="card-head">
          <div><h2>Rutas monitoreadas</h2><p>Unidades y carpetas locales o de red que el Companion revisa automáticamente.</p></div>
          <div class="monitor-actions">
            <button type="button" id="addFolder" class="ghost">Añadir carpeta…</button>
            <button type="button" id="addDrive" class="primary">Añadir unidad…</button>
          </div>
        </div>
        <div id="drivePicker" class="drive-picker" hidden></div>
        <div class="monitor-columns">
          <div class="monitor-group">
            <span class="monitor-group-title">Rutas añadidas manualmente</span>
            <div id="targetList"></div>
          </div>
          <div class="monitor-group">
            <span class="monitor-group-title">Discos VideoCAT detectados</span>
            <div id="autoDiskList"></div>
            <p>Puedes ignorarlos temporalmente sin borrar el marcador del disco.</p>
          </div>
        </div>
        <textarea name="COMPANION_MONITORED_TARGETS" id="COMPANION_MONITORED_TARGETS" hidden></textarea>
        <input name="COMPANION_DISABLED_DISK_IDS" id="COMPANION_DISABLED_DISK_IDS" hidden />
      </section>

      <details class="card full">
        <summary>Opciones avanzadas</summary>
        <div class="fields three">
          <label><span class="label-row"><span>Puerto local</span><code>COMPANION_PORT</code></span><input name="COMPANION_PORT" placeholder="29429" /></label>
          <label><span class="label-row"><span>Remux MP4 temporal</span><code>COMPANION_REMOTE_REMUX_ENABLED</code></span><select name="COMPANION_REMOTE_REMUX_ENABLED"><option value="false">Desactivado</option><option value="true">Activado (solo H.264/AAC)</option></select></label>
          <label><span class="label-row"><span>Borrar los marcados</span><code>COMPANION_AUTO_DELETE_MARKED</code></span><select name="COMPANION_AUTO_DELETE_MARKED"><option value="true">Automáticamente</option><option value="false">Solo a pedido</option></select></label>
          <label class="wide"><span class="label-row"><span>Orígenes permitidos</span><code>COMPANION_ALLOWED_ORIGINS</code></span><input name="COMPANION_ALLOWED_ORIGINS" placeholder="https://cat.example.com,http://localhost:5173" /></label>
          <label><span class="label-row"><span>Detección de discos (ms)</span><code>COMPANION_DISK_POLL_MS</code></span><input name="COMPANION_DISK_POLL_MS" placeholder="5000" /></label>
          <label><span class="label-row"><span>Reescaneo (ms)</span><code>COMPANION_SCAN_POLL_MS</code></span><input name="COMPANION_SCAN_POLL_MS" placeholder="900000" /></label>
          <label><span class="label-row"><span>Latido (ms)</span><code>COMPANION_HEARTBEAT_MS</code></span><input name="COMPANION_HEARTBEAT_MS" placeholder="15000" /></label>
          <label><span class="label-row"><span>Revisión de borrados (ms)</span><code>COMPANION_DELETE_POLL_MS</code></span><input name="COMPANION_DELETE_POLL_MS" placeholder="60000" /></label>
          <label><span class="label-row"><span>Revisión de descargas (ms)</span><code>COMPANION_DOWNLOAD_POLL_MS</code></span><input name="COMPANION_DOWNLOAD_POLL_MS" placeholder="60000" /></label>
          <label><span class="label-row"><span>Copia estancada (ms)</span><code>COMPANION_DOWNLOAD_STALL_MS</code></span><input name="COMPANION_DOWNLOAD_STALL_MS" placeholder="30000" /></label>
          <label><span class="label-row"><span>Discos en la bandeja (ms)</span><code>TRAY_DISK_POLL_MS</code></span><input name="TRAY_DISK_POLL_MS" placeholder="10000" /></label>
        </div>
      </details>

      <div class="actions">
        <div id="status" role="status"></div>
        <button type="button" id="close" class="ghost">Cerrar</button>
        <button type="submit" class="primary">Guardar cambios</button>
      </div>
    </form>
  </main>
  <script>
    const form = document.getElementById("form");
    const status = document.getElementById("status");
    const targetList = document.getElementById("targetList");
    const autoDiskList = document.getElementById("autoDiskList");
    const drivePicker = document.getElementById("drivePicker");
    const targetInput = document.getElementById("COMPANION_MONITORED_TARGETS");
    const disabledInput = document.getElementById("COMPANION_DISABLED_DISK_IDS");
    const pairStatus = document.getElementById("pairStatus");
    const pairDetail = document.getElementById("pairDetail");
    const pairCode = document.getElementById("pairCode");
    let targets = [];
    let disabledDiskIds = new Set();
    let availableDrives = [];

    function setStatus(message, type = "info") {
      status.textContent = message;
      status.className = type === "error" ? "is-error" : type === "success" ? "" : "is-info";
    }

    async function refreshPairingStatus() {
      try {
        const pairing = await window.videocatConfig.pairingStatus();
        pairStatus.textContent = pairing.paired ? "Emparejado" : "Sin emparejar";
        pairStatus.className = pairing.paired ? "pair-status is-paired" : "pair-status";
        pairDetail.textContent = pairing.paired
          ? "Credencial cifrada para " + pairing.serverUrl + ". ID: " + pairing.companionId
          : pairing.encryptionAvailable
            ? "Este equipo todavía usa el token compartido o no tiene credenciales."
            : "El cifrado seguro de Windows no está disponible en esta sesión.";
      } catch (error) {
        pairStatus.textContent = "Estado desconocido";
        pairDetail.textContent = error?.message || "No se pudo consultar el emparejamiento.";
      }
    }

    function newId() {
      return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "target-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    function normalizeTargets(value) {
      try {
        const parsed = JSON.parse(value || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((target) => target && target.id && target.name && target.path)
          .map((target) => ({
            id: String(target.id),
            name: String(target.name),
            path: String(target.path),
            enabled: target.enabled !== false
          }));
      } catch {
        return [];
      }
    }

    function syncMonitorInputs() {
      targetInput.value = JSON.stringify(targets);
      disabledInput.value = [...disabledDiskIds].join(",");
    }

    function hasManualTarget(targetPath) {
      const normalized = String(targetPath).replace(/[\\/]+$/, "").toLowerCase();
      return targets.some((target) => String(target.path).replace(/[\\/]+$/, "").toLowerCase() === normalized);
    }

    function addManualTarget(targetPath, name) {
      if (hasManualTarget(targetPath)) {
        setStatus("Esta ruta ya se encuentra en monitoreo.", "info");
        return false;
      }
      targets.push({ id: newId(), name: String(name).trim(), path: targetPath, enabled: true });
      renderMonitors();
      setStatus("Ruta añadida. Guarda los cambios para iniciar su monitoreo.", "success");
      return true;
    }

    function renderDrivePicker() {
      drivePicker.textContent = "";
      if (availableDrives.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No se detectaron unidades accesibles. Conecta una unidad y pulsa Añadir unidad de nuevo.";
        drivePicker.appendChild(empty);
        return;
      }

      for (const drive of availableDrives) {
        const row = document.createElement("div");
        row.className = "monitor-row";
        const main = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = drive.diskName || drive.root;
        const location = document.createElement("span");
        location.textContent = drive.diskId ? drive.root + " · Disco VideoCAT" : drive.root + " · Unidad disponible";
        main.append(name, location);

        const action = document.createElement("button");
        action.type = "button";
        const alreadyManual = hasManualTarget(drive.root);
        const ignored = drive.diskId && disabledDiskIds.has(drive.diskId);
        if (drive.diskId && !ignored) {
          action.textContent = "Automático";
          action.disabled = true;
          action.className = "ghost";
        } else if (drive.diskId && ignored) {
          action.textContent = "Monitorear";
          action.className = "primary";
          action.addEventListener("click", () => {
            disabledDiskIds.delete(drive.diskId);
            renderMonitors();
            setStatus("Disco VideoCAT activado. Guarda los cambios para aplicar.", "success");
          });
        } else {
          action.textContent = alreadyManual ? "Añadida" : "Añadir";
          action.className = alreadyManual ? "ghost" : "primary";
          action.disabled = alreadyManual;
          action.addEventListener("click", () => {
            if (addManualTarget(drive.root, drive.root.replace(/\\$/, ""))) drivePicker.hidden = true;
          });
        }
        row.append(main, action);
        drivePicker.appendChild(row);
      }
    }

    function renderMonitors() {
      syncMonitorInputs();
      renderDrivePicker();
      targetList.textContent = "";
      if (targets.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No hay rutas manuales. Los discos con .videocat-disk.json se siguen detectando automáticamente.";
        targetList.appendChild(empty);
      } else {
        for (const target of targets) {
          const row = document.createElement("div");
          row.className = "monitor-row";
          const main = document.createElement("div");
          const name = document.createElement("strong");
          name.textContent = target.name;
          const location = document.createElement("span");
          location.textContent = target.path;
          const type = document.createElement("small");
          type.textContent = /^[A-Za-z]:/.test(target.path) && target.path.length <= 3 ? "unidad manual" : "carpeta manual";
          main.append(name, location, type);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "danger";
          remove.textContent = "Quitar";
          remove.addEventListener("click", () => {
            targets = targets.filter((item) => item.id !== target.id);
            renderMonitors();
          });
          row.append(main, remove);
          targetList.appendChild(row);
        }
      }

      autoDiskList.textContent = "";
      const markerDrives = availableDrives.filter((drive) => drive.diskId);
      if (markerDrives.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No hay discos VideoCAT con marcador conectados en este momento.";
        autoDiskList.appendChild(empty);
        return;
      }

      for (const drive of markerDrives) {
        const ignored = disabledDiskIds.has(drive.diskId);
        const row = document.createElement("div");
        row.className = "monitor-row";
        const main = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = drive.diskName || drive.root;
        const location = document.createElement("span");
        location.textContent = drive.root;
        const type = document.createElement("small");
        type.textContent = ignored ? "ignorado" : "monitoreo automático";
        main.append(name, location, type);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = ignored ? "primary" : "danger";
        toggle.textContent = ignored ? "Monitorear" : "Ignorar";
        toggle.addEventListener("click", () => {
          if (ignored) disabledDiskIds.delete(drive.diskId);
          else disabledDiskIds.add(drive.diskId);
          renderMonitors();
        });
        row.append(main, toggle);
        autoDiskList.appendChild(row);
      }
    }

    async function refreshAvailableDrives() {
      try {
        availableDrives = window.videocatConfig?.listDrives ? await window.videocatConfig.listDrives() : [];
      } catch {
        availableDrives = [];
      }
      renderMonitors();
    }

    async function loadConfig() {
      if (!window.videocatConfig) {
        setStatus("No se pudo cargar el puente de configuración de Electron.", "error");
        return;
      }

      try {
        const config = await window.videocatConfig.load();
        for (const [key, value] of Object.entries(config)) {
          const input = form.elements.namedItem(key);
          if (input) input.value = value || "";
        }
        targets = normalizeTargets(config.COMPANION_MONITORED_TARGETS);
        disabledDiskIds = new Set(String(config.COMPANION_DISABLED_DISK_IDS || "").split(",").map((item) => item.trim()).filter(Boolean));
        await refreshAvailableDrives();
        await refreshPairingStatus();
      } catch (error) {
        setStatus(error?.message || "No se pudo cargar la configuración.", "error");
      }
    }

    void loadConfig();
    document.getElementById("close").addEventListener("click", () => window.videocatConfig?.close());
    document.getElementById("toggleToken").addEventListener("click", (event) => {
      const input = document.getElementById("companionToken");
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      event.currentTarget.textContent = reveal ? "Ocultar" : "Mostrar";
    });
    document.getElementById("copyToken").addEventListener("click", async () => {
      const copied = window.videocatConfig?.copyToken ? await window.videocatConfig.copyToken() : false;
      setStatus(copied ? "Token copiado. Pégalo en VideoCAT › Perfil › Companion local." : "Guarda la configuración para generar el token.", copied ? "success" : "error");
    });
    document.getElementById("pair").addEventListener("click", async () => {
      if (!window.videocatConfig?.pair) return;
      const code = String(pairCode.value || "").trim();
      if (!code) {
        setStatus("Ingresa el código generado desde Administración.", "error");
        pairCode.focus();
        return;
      }
      syncMonitorInputs();
      const button = document.getElementById("pair");
      button.disabled = true;
      setStatus("Emparejando con el servidor...", "info");
      try {
        const result = await window.videocatConfig.pair(code, Object.fromEntries(new FormData(form).entries()));
        if (!result.ok) {
          setStatus(result.message || "No se pudo emparejar.", "error");
          return;
        }
        pairCode.value = "";
        form.elements.namedItem("AGENT_TOKEN").value = "";
        await refreshPairingStatus();
        setStatus("Emparejamiento completado. Companion reiniciado con su credencial individual.", "success");
      } catch (error) {
        setStatus(error?.message || "No se pudo emparejar.", "error");
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("addFolder").addEventListener("click", async () => {
      if (!window.videocatConfig?.chooseFolder) {
        setStatus("No se pudo abrir el selector de carpetas.", "error");
        return;
      }
      const folder = await window.videocatConfig.chooseFolder();
      if (!folder) return;
      const defaultName = folder.split(/[\\\\/]/).filter(Boolean).pop() || folder;
      addManualTarget(folder, defaultName);
    });
    document.getElementById("addDrive").addEventListener("click", async () => {
      drivePicker.hidden = false;
      setStatus("Buscando unidades conectadas...", "info");
      await refreshAvailableDrives();
      setStatus(
        availableDrives.length > 0 ? "Elige una unidad de la lista." : "No se detectaron unidades accesibles.",
        availableDrives.length > 0 ? "info" : "error"
      );
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!window.videocatConfig) {
        setStatus("No se pudo cargar el puente de configuración de Electron. Cierra y abre de nuevo el Companion.", "error");
        return;
      }
      syncMonitorInputs();
      const values = Object.fromEntries(new FormData(form).entries());
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      setStatus("Guardando configuración...", "info");
      try {
        const result = await window.videocatConfig.save(values);
        if (!result.ok) {
          setStatus(result.message || "No se pudo guardar la configuración.", "error");
          return;
        }
        setStatus("Configuración guardada. Companion reiniciado.", "success");
      } catch (error) {
        setStatus(error?.message || "No se pudo guardar la configuración.", "error");
      } finally {
        submit.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function configLogoDataUrl(): string {
  const icon = iconPath();
  if (!icon) return "";
  const image = nativeImage.createFromPath(icon);
  return image.isEmpty() ? "" : image.resize({ width: 96 }).toDataURL();
}

function openConfigWindow(): void {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: `VideoCAT Companion v${app.getVersion()}`,
    icon: iconPath() || undefined,
    resizable: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  configWindow.removeMenu();
  configWindow.on("closed", () => {
    configWindow = null;
  });
  void configWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(configHtml(configLogoDataUrl()))}`);
}

function logHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VideoCAT Actividad v${app.getVersion()}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #0f1519; color: #eef5f7; }
    main { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
    header { padding: 16px 18px; border-bottom: 1px solid #26343c; background: #121b20; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 18px; }
    .actions { display: flex; align-items: center; gap: 10px; }
    label { color: #b1c4ce; font-size: 12px; font-weight: 800; display: flex; align-items: center; gap: 6px; }
    button { min-height: 34px; border: 1px solid #33444e; border-radius: 7px; padding: 0 12px; font-weight: 900; color: #fff; background: #162128; }
    button.primary { border-color: #fc6121; background: #fc6121; }
    #log { overflow: auto; padding: 12px 14px; font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; line-height: 1.45; }
    .row { display: grid; grid-template-columns: 74px 86px 110px 1fr; gap: 10px; align-items: start; padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .time { color: #78909c; }
    .source { color: #dce8ed; font-weight: 800; }
    .message { color: #c8d5db; white-space: pre-wrap; overflow-wrap: anywhere; }
    .level { width: 64px; height: 22px; display: inline-flex; align-items: center; justify-content: center; align-self: start; border: 1px solid transparent; border-radius: 4px; padding: 0 7px; font-size: 11px; line-height: 1; font-weight: 900; text-transform: uppercase; }
    .info .level { color: #bde8cd; background: rgba(39, 174, 96, 0.16); }
    .warn .level { color: #ffdf8f; background: rgba(245, 158, 11, 0.18); }
    .error .level { color: #ffb4a4; background: rgba(239, 68, 68, 0.2); }
    footer { padding: 10px 18px; color: #78909c; border-top: 1px solid #26343c; background: #121b20; font-size: 12px; font-weight: 700; }
    .empty { color: #78909c; padding: 20px; text-align: center; font-family: Segoe UI, Arial, sans-serif; }
    .version { color: #fc6121; font-size: 12px; font-weight: 800; vertical-align: middle; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Actividad de VideoCAT Companion <span class="version">v${app.getVersion()}</span></h1>
      <div class="actions">
        <label><input id="follow" type="checkbox" checked /> Seguir</label>
        <button id="clear" type="button">Limpiar</button>
        <button id="close" class="primary" type="button">Cerrar</button>
      </div>
    </header>
    <section id="log"><div class="empty">Cargando actividad...</div></section>
    <footer id="count">0 eventos</footer>
  </main>
  <script>
    const log = document.getElementById("log");
    const count = document.getElementById("count");
    const follow = document.getElementById("follow");
    let total = 0;

    function renderCount() {
      count.textContent = total === 1 ? "1 evento" : total + " eventos";
    }

    function appendEntry(entry) {
      if (log.querySelector(".empty")) log.textContent = "";
      const row = document.createElement("div");
      row.className = "row " + entry.level;
      const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const cells = [
        ["time", time],
        ["level", entry.level],
        ["source", entry.source],
        ["message", entry.message]
      ];
      for (const [className, text] of cells) {
        const cell = document.createElement("div");
        cell.className = className;
        cell.textContent = text;
        row.appendChild(cell);
      }
      log.appendChild(row);
      total += 1;
      renderCount();
      if (follow.checked) log.scrollTop = log.scrollHeight;
    }

    async function loadLogs() {
      if (!window.videocatLog) {
        log.innerHTML = '<div class="empty">No se pudo cargar el puente de logs de Electron.</div>';
        return;
      }
      const entries = await window.videocatLog.load();
      log.textContent = "";
      total = 0;
      if (entries.length === 0) {
        log.innerHTML = '<div class="empty">Todavia no hay actividad registrada.</div>';
      } else {
        for (const entry of entries) appendEntry(entry);
      }
      renderCount();
    }

    void loadLogs();
    window.videocatLog?.onEntry((entry) => appendEntry(entry));
    window.videocatLog?.onCleared(() => {
      total = 0;
      log.innerHTML = '<div class="empty">Log limpio.</div>';
      renderCount();
    });
    document.getElementById("clear").addEventListener("click", () => window.videocatLog?.clear());
    document.getElementById("close").addEventListener("click", () => window.videocatLog?.close());
  </script>
</body>
</html>`;
}

function openLogWindow(): void {
  if (logWindow) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 980,
    height: 620,
    title: `VideoCAT Actividad v${app.getVersion()}`,
    icon: iconPath() || undefined,
    resizable: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  logWindow.removeMenu();
  logWindow.on("closed", () => {
    logWindow = null;
  });
  void logWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(logHtml())}`);
}

function iconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(resourcesPath(), "icon.png"), path.join(resourcesPath(), "icon.ico")]
    : [
        path.resolve(process.cwd(), "apps", "agent-windows", "build", "icon.png"),
        path.resolve(process.cwd(), "apps", "agent-windows", "build", "icon.ico"),
        path.resolve(process.cwd(), "../../logo.png")
      ];
  return candidates.find((candidate) => {
    try {
      return nativeImage.createFromPath(candidate).isEmpty() === false;
    } catch {
      return false;
    }
  }) ?? "";
}

function updateMenu(): void {
  if (!tray) return;
  const companionLabel = `${companion ? "Companion activo" : "Companion detenido"} v${app.getVersion()}`;

  const manualTargets = parseTargets(process.env.COMPANION_MONITORED_TARGETS).filter((target) => target.enabled !== false);
  const diskItems = lastMounted.length === 0 && manualTargets.length === 0
    ? [{ label: "Sin discos VideoCAT detectados", enabled: false }]
    : [
      ...lastMounted.map((disk) => ({
        label: `${disk.marker.diskName} (${disk.root})`,
        submenu: [
          {
            label: "Escanear y reparar miniaturas",
            enabled: !busy,
            click: () => runAgentTask(`Escaneo ${disk.marker.diskName}`, ["scan", "--path", disk.root])
          },
          {
            label: "Procesar borrados pendientes",
            enabled: !busy,
            click: () => runAgentTask(`Borrados ${disk.marker.diskName}`, ["process-deletes"])
          }
        ]
      })),
      ...manualTargets.map((target) => ({
        label: `${target.name} (${target.path})`,
        submenu: [
          {
            label: "Escanear y reparar miniaturas",
            enabled: !busy,
            click: () => runAgentTask(`Escaneo ${target.name}`, [
              "scan",
              "--path", target.path,
              "--disk-name", target.name,
              "--disk-id", target.id,
              "--volume-id", target.id,
              "--root-as-path"
            ])
          },
          {
            label: "Procesar borrados pendientes",
            enabled: !busy,
            click: () => runAgentTask(`Borrados ${target.name}`, ["process-deletes"])
          }
        ]
      }))
    ];

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: companionLabel, enabled: false },
    { type: "separator" },
    { label: "Abrir VideoCAT", click: () => void openVideoCat() },
    { label: "Configuración...", click: () => openConfigWindow() },
    { label: "Ver actividad...", click: () => openLogWindow() },
    { label: "Actualizar discos", click: () => void refreshMountedDisks().finally(updateMenu) },
    { label: "Discos conectados", submenu: diskItems },
    { type: "separator" },
    {
      label: companion ? "Reiniciar companion" : "Iniciar companion",
      click: () => {
        restartCompanion();
        updateMenu();
      }
    },
    {
      label: "Procesar borrados pendientes",
      enabled: !busy,
      click: () => runAgentTask("Borrados pendientes", ["process-deletes"])
    },
    { type: "separator" },
    {
      label: "Salir",
      click: () => {
        appQuitting = true;
        stopCompanion();
        app.quit();
      }
    }
  ]));
}

async function ensureCompanionToken(): Promise<void> {
  if ((process.env.COMPANION_TOKEN?.trim().length ?? 0) >= minimumCompanionTokenLength) return;
  try {
    await saveConfig(normalizeConfig(currentConfig()));
  } catch (error) {
    // Keep the generated token for this run even if the settings file cannot be written.
    process.env.COMPANION_TOKEN = generateCompanionToken();
    console.error("No se pudo guardar COMPANION_TOKEN:", error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId("app.videocat.companion");
  if (duplicateLaunchPending) notifyAlreadyRunning();
  app.setLoginItemSettings({ openAtLogin: false });
  await loadEnvFile();
  await ensureCompanionToken();
  await loadStoredCredential();

  ipcMain.handle("config:load", () => currentConfig());
  ipcMain.handle("config:copy-token", () => {
    const token = process.env.COMPANION_TOKEN?.trim();
    if (!token) return false;
    clipboard.writeText(token);
    return true;
  });
  ipcMain.handle("config:pairing-status", () => pairingStatus());
  ipcMain.handle("config:pair", (_event, code: string, values: Record<string, string>) => pairCompanion(code, values));
  ipcMain.handle("config:choose-folder", async () => {
    const options: OpenDialogOptions = {
      title: "Seleccionar carpeta para monitorear",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = configWindow
      ? await dialog.showOpenDialog(configWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("config:list-drives", async () => discoverAccessibleDrives());
  ipcMain.handle("config:save", async (_event, values: Record<string, string>): Promise<ConfigSaveResult> => {
    try {
      const normalized = normalizeConfig(values);
      const validationError = validateConfig(normalized);
      if (validationError) return { ok: false, message: validationError };

      const target = await saveConfig(normalized);
      restartCompanion();
      updateMenu();
      notify("VideoCAT Companion", "Configuración guardada. Companion reiniciado.");
      return { ok: true, path: target };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
  });
  ipcMain.on("config:close", () => {
    configWindow?.close();
  });
  ipcMain.handle("log:load", () => logEntries);
  ipcMain.handle("log:clear", () => {
    clearLogs();
    return { ok: true };
  });
  ipcMain.on("log:close", () => {
    logWindow?.close();
  });

  const icon = iconPath();
  tray = new Tray(icon ? nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }) : nativeImage.createEmpty());
  tray.setToolTip(`VideoCAT Companion v${app.getVersion()}`);
  tray.on("click", () => void openVideoCat());

  startCompanion();
  await refreshMountedDisks();
  updateMenu();
  notify("VideoCAT Companion", `Listo en bandeja. Env: ${loadedEnvFiles.length || "sin .env"}.`);

  setInterval(() => {
    void refreshMountedDisks().finally(updateMenu);
  }, Number(process.env.TRAY_DISK_POLL_MS ?? 10000));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", notifyAlreadyRunning);
  app.on("before-quit", () => {
    appQuitting = true;
    stopCompanion();
  });
  app.on("window-all-closed", () => {
    // Tray-only app: keep running until the user chooses "Salir".
  });

  main().catch((error) => {
    notify("VideoCAT Companion", error instanceof Error ? error.message : String(error));
    appQuitting = true;
    app.quit();
  });
}
