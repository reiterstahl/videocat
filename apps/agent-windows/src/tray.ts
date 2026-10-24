import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray, type NativeImage } from "electron";
import type { OpenDialogOptions } from "electron";
import { companionRestartDelayMs, companionRunWasStable } from "./companion-supervisor.js";
import { checkIdentitySample, cleanDiskName, createDiskMarker, identitySampleSize, isDriveRoot, markerFileName, type IdentityCheck, type IdentitySampleFile } from "./disk-marker.js";
import { formatTrayTooltip, LineSplitter, parseAccent, parseTrayStatus, prepareTrayIcon, trayFrames, trayFramesPerTurn, trayTurnMs, type TrayStatus } from "./tray-animation.js";
import { loadOrCreateCompanionIdentity } from "./identity.js";
import { generateCompanionToken, minimumCompanionTokenLength } from "./local-auth.js";
import { CompanionUpdater, createUpdateClient, runVelopackHooks } from "./updater.js";
import { healthTaskInstalled, readCollectedHealth, runHealthTask } from "./disk-health.js";
import { resolveTrayLanguage, translateTray, type TrayLanguage } from "./tray-i18n.js";
import { configHtml, logHtml } from "./tray-pages.js";

// Velopack may start the app only to run an install/update hook and exit, so this runs first.
if (app.isPackaged && process.platform === "win32") runVelopackHooks();

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
  totalBytes?: number;
  freeBytes?: number;
};

type LogLevel = "info" | "warn" | "error";
type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
};

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
  "COMPANION_STAGING_DIR",
  "COMPANION_TRANSFER_POLL_MS",
  "COMPANION_FILE_TIMEOUT_SECONDS",
  "COMPANION_REMOTE_REMUX_ENABLED",
  "COMPANION_AUTO_DELETE_MARKED",
  "COMPANION_MONITORED_TARGETS",
  "COMPANION_DISABLED_DISK_IDS",
  "TRAY_DISK_POLL_MS",
  "TRAY_CLICK_ACTION",
  "COMPANION_LANGUAGE"
] as const;
type ConfigKey = typeof configKeys[number];
type ConfigSaveResult = { ok: true; path: string } | { ok: false; message: string };
type PairingResult = { ok: true; companionId: string; issuedAt: string } | { ok: false; message: string };
type IdentityCheckResult = { ok: true; root: string; diskName: string | null; check: IdentityCheck } | { ok: false; message: string };
// removedTargetId: the route by letter that became this marker; pausedTargetIds: other routes by
// letter that pointed at the same drive, so the window can show the same state without reloading.
type MarkerResult =
  | { ok: true; root: string; diskId: string; diskName: string; removedTargetId: string | null; pausedTargetIds: string[] }
  | { ok: false; message: string };
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
  COMPANION_FILE_TIMEOUT_SECONDS: "180",
  COMPANION_REMOTE_REMUX_ENABLED: "false",
  COMPANION_AUTO_DELETE_MARKED: "true",
  TRAY_DISK_POLL_MS: "10000",
  TRAY_CLICK_ACTION: "open",
  COMPANION_LANGUAGE: "auto"
};
let tray: Tray | null = null;

// The interface language: COMPANION_LANGUAGE, or Windows' display language (tray-i18n.ts).
function trayLanguage(): TrayLanguage {
  return resolveTrayLanguage(process.env.COMPANION_LANGUAGE, app.getPreferredSystemLanguages());
}

function t(text: string, values?: Record<string, string | number>): string {
  return translateTray(text, trayLanguage(), values);
}
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
const updater = new CompanionUpdater(app.isPackaged && process.platform === "win32" ? createUpdateClient() : null);
const firstUpdateCheckDelayMs = 60 * 1000;
const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
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
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(t("SERVER_URL debe iniciar con http:// o https://."));
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
    throw new Error(t("Windows no permite cifrar la credencial en este momento. Inicia sesion normalmente e intenta de nuevo."));
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
    if (!["http:", "https:"].includes(url.protocol)) return t("{label} debe iniciar con http:// o https://.", { label });
  } catch {
    return t("{label} no parece una URL valida.", { label });
  }
  return null;
}

function validatePositiveInteger(value: string, label: string): string | null {
  if (!/^\d+$/.test(value) || Number(value) <= 0) return t("{label} debe ser un numero entero mayor a cero.", { label });
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
    return t("Empareja este Companion o configura AGENT_TOKEN para continuar.");
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
    ?? (values.COMPANION_FILE_TIMEOUT_SECONDS && !(Number(values.COMPANION_FILE_TIMEOUT_SECONDS) >= 30 && Number(values.COMPANION_FILE_TIMEOUT_SECONDS) <= 3600)
      ? t("COMPANION_FILE_TIMEOUT_SECONDS debe estar entre 30 y 3600 segundos.")
      : null)
    ?? (!/^(true|false)$/i.test(values.COMPANION_REMOTE_REMUX_ENABLED)
      ? t("COMPANION_REMOTE_REMUX_ENABLED debe ser true o false.")
      : null)
    ?? (!/^(true|false)$/i.test(values.COMPANION_AUTO_DELETE_MARKED)
      ? t("COMPANION_AUTO_DELETE_MARKED debe ser true o false.")
      : null)
    ?? (!trayClickActions.includes(values.TRAY_CLICK_ACTION as TrayClickAction)
      ? t("TRAY_CLICK_ACTION debe ser open, activity o settings.")
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
    // A read stuck on a bad sector holds one of Node's I/O threads (4 by default); with more of
    // them, one stuck file never freezes the rest of the Companion.
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? "16",
    // The agent leaves on its own when this tray process is gone (no orphan agents).
    VIDEOCAT_PARENT_WATCH: "1",
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
      return { ok: false, message: body?.message ?? t("El servidor rechazo el emparejamiento ({status}).", { status: response.status }) };
    }
    const body = await response.json() as { credential?: string; issuedAt?: string };
    if (!body.credential || !body.issuedAt) return { ok: false, message: t("El servidor devolvio una respuesta de emparejamiento incompleta.") };

    await saveStoredCredential({ companionId, serverUrl, issuedAt: body.issuedAt }, body.credential);
    normalized.AGENT_TOKEN = "";
    const target = await saveConfig(normalized);
    addLog("info", "seguridad", `Companion emparejado con ${serverUrl}. Configuración: ${target}`);
    restartCompanion();
    updateMenu();
    notify("VideoCAT Companion", t("Emparejamiento completado. La credencial individual se guardo cifrada."));
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

type UpdateStatus = {
  installed: boolean;
  currentVersion: string;
  readyVersion: string | null;
  message?: string;
};

function updateStatus(message?: string): UpdateStatus {
  return { installed: updater.installed, currentVersion: app.getVersion(), readyVersion: updater.readyVersion, message };
}

async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  if (!updater.installed) {
    return updateStatus(t("Las actualizaciones automáticas requieren instalar el Companion con Setup.exe."));
  }
  const previous = updater.readyVersion;
  try {
    const version = await updater.checkAndDownload();
    if (!version) {
      if (manual) notify("VideoCAT Companion", t("Ya tienes la última versión (v{version}).", { version: app.getVersion() }));
      return updateStatus(t("Tienes la última versión (v{version}).", { version: app.getVersion() }));
    }
    if (version !== previous) {
      addLog("info", "actualizaciones", `Versión v${version} descargada; se aplica al reiniciar.`);
      updateMenu();
      configWindow?.webContents.send("update:ready", updateStatus());
    }
    if (version !== previous || manual) notifyUpdateReady(version);
    return updateStatus(t("La versión v{version} está lista para instalar.", { version }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Offline or rate-limited: the next scheduled check tries again.
    addLog("warn", "actualizaciones", `No se pudo buscar actualizaciones: ${reason}`);
    if (manual) notify("VideoCAT Companion", t("No se pudo buscar actualizaciones. Revisa la conexión e inténtalo más tarde."));
    return updateStatus(t("No se pudo buscar actualizaciones. Inténtalo más tarde."));
  }
}

function notifyUpdateReady(version: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: `VideoCAT Companion v${version} disponible`,
    body: t("Haz clic para reiniciar el Companion y aplicar la actualización.")
  });
  notification.on("click", () => installUpdate());
  notification.show();
}

function installUpdate(): void {
  if (busy) {
    notify("VideoCAT Companion", t("Hay una tarea en curso. Actualiza cuando termine."));
    return;
  }
  try {
    if (!updater.applyAfterExit()) return;
  } catch (error) {
    notify("VideoCAT Companion", t("No se pudo aplicar la actualización: {reason}", { reason: error instanceof Error ? error.message : String(error) }));
    return;
  }
  addLog("info", "actualizaciones", `Reiniciando para instalar v${updater.readyVersion}.`);
  appQuitting = true;
  stopCompanion();
  app.quit();
}

function notifyAlreadyRunning(): void {
  if (!app.isReady()) {
    duplicateLaunchPending = true;
    return;
  }
  duplicateLaunchPending = false;
  notify("VideoCAT Companion", t("El Companion ya esta en ejecucion en la bandeja del sistema."));
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

// Installed builds carry the agent as its own executable on a patched Node.js (Node SEA,
// scripts/build-agent-sea.mjs); Electron then only hosts the tray and its windows. Without it
// (development, older packages) Electron runs the agent in Node mode.
function agentExecutablePath(): string | null {
  if (!app.isPackaged) return null;
  const executable = path.join(resourcesPath(), "videocat-agent.exe");
  return existsSync(executable) ? executable : null;
}

// Drive health (SMART), see disk-health.ts and smart/smart-setup.ps1. smartctl and the scripts
// travel in resources/smartmontools (scripts/fetch-smartctl.mjs); turning it on or off runs the
// setup script elevated, which is the one moment Windows asks for administrator permission.
type HealthStatus = { supported: boolean; installed: boolean; administrator: boolean; lastCheckedAt: string | null };
type HealthResult = { ok: true; message: string } | { ok: false; message: string };

function smartToolsDir(): string {
  return app.isPackaged ? path.join(resourcesPath(), "smartmontools") : path.join(app.getAppPath(), "release", "smartmontools");
}

function runQuiet(command: string, args: string[], timeout = 15_000): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout }, (error, stdout) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? Number((error as { code?: unknown }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });
}

async function windowsUser(): Promise<{ sid: string | null; administrator: boolean }> {
  const user = await runQuiet("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = /"(S-1-5-21-[\d-]+)"/.exec(user.stdout)?.[1] ?? null;
  // Listed even while UAC keeps the token filtered ("deny only"): what matters is that the
  // account can be elevated.
  const groups = await runQuiet("whoami.exe", ["/groups", "/fo", "csv", "/nh"]);
  return { sid, administrator: groups.stdout.includes("S-1-5-32-544") };
}

async function healthStatus(): Promise<HealthStatus> {
  if (process.platform !== "win32") return { supported: false, installed: false, administrator: false, lastCheckedAt: null };
  const [installed, user, collected] = await Promise.all([healthTaskInstalled(), windowsUser(), readCollectedHealth()]);
  return { supported: true, installed, administrator: user.administrator, lastCheckedAt: collected?.collectedAt ?? null };
}

const cancelledExitCode = 1223;
// smart-setup.ps1 writes nothing outside its protected folders: its exit code says what failed.
const healthSetupErrors: Record<number, string> = {
  10: t("no se pudo identificar tu usuario de Windows"),
  11: t("smartctl.exe no es la versión que trae VideoCAT; reinstala o actualiza el Companion"),
  12: t("Windows no aceptó la tarea programada"),
  13: t("Windows no aceptó los permisos de la tarea programada")
};

// Runs smart-setup.ps1 elevated and waits for it.
async function runHealthSetup(args: string): Promise<{ code: number; detail: string }> {
  const source = smartToolsDir();
  const setup = path.join(source, "smart-setup.ps1");
  if (!existsSync(setup) || !existsSync(path.join(source, "smartctl.exe"))) {
    return { code: -1, detail: t("Este Companion no trae smartctl; actualízalo.") };
  }
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // Windows paths cannot contain double quotes, so quoting each one is enough; the whole line goes
  // to PowerShell as a single-quoted literal.
  const elevatedArgs = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${setup}" ${args}`.replace(/'/g, "''");
  const command = [
    "try {",
    `  $process = Start-Process -FilePath '${powershell.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${elevatedArgs}'`,
    "  exit $process.ExitCode",
    `} catch { exit ${cancelledExitCode} }`
  ].join("\n");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = await runQuiet(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], 5 * 60_000);
  return { code: result.code, detail: healthSetupErrors[result.code] ?? "" };
}

async function enableHealth(): Promise<HealthResult> {
  const user = await windowsUser();
  if (!user.administrator) return { ok: false, message: t("Tu usuario de Windows no es administrador: la salud de discos necesita una cuenta que pueda serlo.") };
  if (!user.sid) return { ok: false, message: t("No se pudo identificar tu usuario de Windows.") };
  const result = await runHealthSetup(`-Source "${smartToolsDir()}" -UserSid ${user.sid}`);
  if (result.code === cancelledExitCode) return { ok: false, message: t("Se canceló el permiso de Windows; la salud de discos sigue desactivada.") };
  if (result.code !== 0) return { ok: false, message: result.detail ? t("No se pudo activar la salud de discos: {detail}", { detail: result.detail }) : t("No se pudo activar la salud de discos (código {code}).", { code: result.code }) };
  await runHealthTask();
  return { ok: true, message: t("Salud de discos activada. La primera revisión llega a VideoCAT en un minuto.") };
}

async function disableHealth(): Promise<HealthResult> {
  const result = await runHealthSetup("-Remove");
  if (result.code === cancelledExitCode) return { ok: false, message: t("Se canceló el permiso de Windows; la salud de discos sigue activa.") };
  if (result.code !== 0) return { ok: false, message: result.detail ? t("No se pudo desactivar: {detail}", { detail: result.detail }) : t("No se pudo desactivar (código {code}).", { code: result.code }) };
  return { ok: true, message: t("Salud de discos desactivada: se quitaron la tarea y smartctl de Program Files.") };
}

function spawnAgent(args: string[]): ChildProcessWithoutNullStreams {
  const executable = agentExecutablePath();
  if (executable) {
    const { ELECTRON_RUN_AS_NODE: _electronOnly, ...env } = childEnv();
    return spawn(executable, args, { env, windowsHide: true });
  }
  return spawn(process.execPath, [agentScriptPath(), ...args], {
    env: childEnv(),
    windowsHide: true
  });
}

function runAgentTask(label: string, args: string[]): void {
  if (busy) {
    notify("VideoCAT", t("Ya hay una tarea en ejecucion."));
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
    notify("VideoCAT", code === 0 ? t("{task}: terminado.", { task: label }) : `${t("{task}: falló.", { task: label })}\n${tail}`.slice(0, 240));
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
      const space = await fs.statfs(root).catch(() => null);
      drives.push({
        root,
        diskId: marker?.diskId,
        diskName: marker?.diskName,
        totalBytes: space ? space.blocks * space.bsize : undefined,
        freeBytes: space ? space.bavail * space.bsize : undefined
      });
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

// Drives are followed by their marker. Routes added by hand for a whole drive (older builds)
// follow a letter instead; these helpers turn them into markers.
function sameRoot(a: string, b: string): boolean {
  return normalizeTargetPath(a).toLowerCase() === normalizeTargetPath(b).toLowerCase();
}

function manualDriveTarget(targetId: string): CompanionTarget | null {
  const target = parseTargets(process.env.COMPANION_MONITORED_TARGETS).find((item) => item.id === targetId);
  return target && isDriveRoot(target.path) ? target : null;
}

// The drive must be connected and still without a marker: a marker is another disk's identity.
async function unmarkedDrive(root: string): Promise<{ root: string } | { message: string }> {
  if (!isDriveRoot(root)) return { message: t("Elige una unidad completa (por ejemplo H:\\).") };
  const drive = (await discoverAccessibleDrives()).find((item) => sameRoot(item.root, root));
  if (!drive) return { message: t("No hay ninguna unidad conectada en {root}. Conéctala y vuelve a intentarlo.", { root }) };
  if (drive.diskId) return { message: t("{root} ya es el disco VideoCAT «{name}».", { root: drive.root, name: drive.diskName ?? "" }) };
  return { root: drive.root };
}

async function fetchIdentitySample(diskId: string): Promise<{ diskName: string | null; totalFiles: number; files: IdentitySampleFile[] }> {
  const serverUrl = process.env.SERVER_URL?.trim();
  if (!serverUrl) throw new Error(t("Configura la URL del servidor en Conexión para poder comprobar el disco."));
  const paired = hasPairedCredentialFor(serverUrl) && pairedCredential && storedCredential ? storedCredential : null;
  const credential = paired ? pairedCredential : process.env.AGENT_TOKEN?.trim();
  if (!credential) throw new Error(t("Empareja el Companion en Conexión para poder comprobar el disco."));
  const headers: Record<string, string> = { Authorization: `Bearer ${credential}` };
  if (paired) headers["X-VideoCat-Companion-Id"] = paired.companionId;

  const response = await fetch(
    `${normalizeServerUrl(serverUrl)}/api/agent/disks/${encodeURIComponent(diskId)}/identity-sample?limit=${identitySampleSize}`,
    { headers, signal: AbortSignal.timeout(20_000) }
  );
  if (response.status === 404) {
    throw new Error(t("El servidor todavía no sabe comprobar discos. Actualiza VideoCAT en el servidor a la 0.2.45 o posterior."));
  }
  if (!response.ok) throw new Error(t("El servidor respondió {status} al pedir la muestra del catálogo.", { status: response.status }));
  const body = await response.json() as { disk?: { name?: string } | null; totalFiles?: number; files?: unknown };
  const files = Array.isArray(body.files)
    ? body.files.filter((file): file is IdentitySampleFile =>
      typeof file?.relativePath === "string" && typeof file?.sizeBytes === "number")
    : [];
  return { diskName: body.disk?.name ?? null, totalFiles: Number(body.totalFiles) || 0, files };
}

async function checkDriveIdentity(targetId: string, root: string): Promise<IdentityCheckResult> {
  const target = manualDriveTarget(targetId);
  if (!target) return { ok: false, message: t("Esa ruta ya no está guardada como unidad. Guarda los cambios y vuelve a intentarlo.") };
  const drive = await unmarkedDrive(root);
  if ("message" in drive) return { ok: false, message: drive.message };
  try {
    const sample = await fetchIdentitySample(target.id);
    const check = await checkIdentitySample(drive.root, sample.files, sample.totalFiles);
    return { ok: true, root: drive.root, diskName: sample.diskName, check };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// After a marker is written at a root, no route by letter may point there: the one that became
// the marker is removed and any other is paused, so the drive is never scanned under two disks.
async function retireLetterRoutes(root: string, becameMarker: string | null): Promise<string[]> {
  const targets = parseTargets(process.env.COMPANION_MONITORED_TARGETS);
  const paused: string[] = [];
  const next = targets.flatMap((target) => {
    if (target.id === becameMarker) return [];
    if (isDriveRoot(target.path) && sameRoot(target.path, root) && target.enabled !== false) {
      paused.push(target.id);
      return [{ ...target, enabled: false }];
    }
    return [target];
  });
  if (next.length !== targets.length || paused.length > 0) {
    await saveConfig(normalizeConfig({ ...currentConfig(), COMPANION_MONITORED_TARGETS: serializeTargets(next) }));
    restartCompanion();
  }
  await refreshMountedDisks();
  updateMenu();
  return paused;
}

async function pinDriveIdentity(input: { targetId: string; root: string; name: string; acceptMixed?: boolean }): Promise<MarkerResult> {
  const name = cleanDiskName(input.name);
  if (!name) return { ok: false, message: t("Escribe un nombre para el disco (hasta 80 caracteres).") };
  // Checked again here: the window's answer may be old, and the drive may have changed since.
  const result = await checkDriveIdentity(String(input.targetId), String(input.root));
  if (!result.ok) return result;
  const { verdict } = result.check;
  if (verdict === "mismatch") return { ok: false, message: t("Esta unidad no tiene los archivos de ese catálogo. Créale un disco nuevo.") };
  if (verdict === "mixed" && !input.acceptMixed) return { ok: false, message: t("El catálogo está mezclado: confirma que esta es la unidad original.") };
  try {
    const marker = await createDiskMarker(result.root, { diskId: String(input.targetId), diskName: name });
    addLog("info", "discos", `${result.root} ahora es el disco VideoCAT «${marker.diskName}» y conserva su catálogo (${result.check.matched} de ${result.check.checked} archivos de la muestra presentes).`);
    const paused = await retireLetterRoutes(result.root, marker.diskId);
    return { ok: true, root: result.root, diskId: marker.diskId, diskName: marker.diskName, removedTargetId: marker.diskId, pausedTargetIds: paused };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function convertDrive(input: { root: string; name: string }): Promise<MarkerResult> {
  const name = cleanDiskName(input.name);
  if (!name) return { ok: false, message: t("Escribe un nombre para el disco (hasta 80 caracteres).") };
  const drive = await unmarkedDrive(String(input.root));
  if ("message" in drive) return { ok: false, message: drive.message };
  try {
    const marker = await createDiskMarker(drive.root, { diskId: randomUUID(), diskName: name });
    addLog("info", "discos", `${drive.root} ahora es el disco VideoCAT «${marker.diskName}» (${marker.diskId}).`);
    const paused = await retireLetterRoutes(drive.root, null);
    return { ok: true, root: drive.root, diskId: marker.diskId, diskName: marker.diskName, removedTargetId: null, pausedTargetIds: paused };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// Tray icon while the Companion works: the web's accent travels around the cat's white outline
// (tray-animation.ts). Frames are built once per accent and screen scale; idle shows the usual icon.
const defaultTrayAccent = "#fc6121";
let trayBaseImage: NativeImage | null = null;
let trayFrameCache: { key: string; images: NativeImage[] } | null = null;
let trayAnimationTimer: NodeJS.Timeout | null = null;
let trayFrameIndex = 0;
let trayStatus: TrayStatus = { busy: false, accent: null };

function buildTrayFrames(accentHex: string): NativeImage[] {
  const icon = iconPath();
  if (!icon) return [];
  const scale = Math.max(1, screen.getPrimaryDisplay().scaleFactor || 1);
  const size = Math.min(48, Math.max(16, Math.round(16 * scale)));
  const source = nativeImage.createFromPath(icon).resize({ width: size, height: size, quality: "best" });
  if (source.isEmpty()) return [];
  const accent = parseAccent(accentHex) ?? parseAccent(defaultTrayAccent)!;
  // Electron bitmaps are BGRA on Windows.
  const prepared = prepareTrayIcon(source.toBitmap(), size, size, "bgra");
  return trayFrames(prepared, accent).map((frame) => nativeImage.createFromBitmap(Buffer.from(frame), { width: size, height: size, scaleFactor: size / 16 }));
}

function applyTrayStatus(status: TrayStatus): void {
  trayStatus = status;
  if (!tray) return;
  tray.setToolTip(formatTrayTooltip(status, app.getVersion(), Date.now(), trayLanguage()));
  if (!status.busy) {
    if (trayAnimationTimer) clearInterval(trayAnimationTimer);
    trayAnimationTimer = null;
    if (trayBaseImage) tray.setImage(trayBaseImage);
    return;
  }
  const accent = parseAccent(status.accent) ? status.accent! : defaultTrayAccent;
  const key = `${accent}|${screen.getPrimaryDisplay().scaleFactor}`;
  if (!trayFrameCache || trayFrameCache.key !== key) {
    try {
      trayFrameCache = { key, images: buildTrayFrames(accent) };
    } catch (error) {
      addLog("warn", "bandeja", `No se pudo animar el ícono: ${error instanceof Error ? error.message : String(error)}`);
      trayFrameCache = { key, images: [] };
    }
  }
  if (trayFrameCache.images.length === 0 || trayAnimationTimer) return;
  trayAnimationTimer = setInterval(() => {
    const images = trayFrameCache?.images ?? [];
    if (!tray || images.length === 0) return;
    trayFrameIndex = (trayFrameIndex + 1) % images.length;
    tray.setImage(images[trayFrameIndex]);
  }, Math.round(trayTurnMs / trayFramesPerTurn));
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
  const lines = new LineSplitter();
  child.stdout.on("data", (chunk) => {
    // Status lines drive the tray icon and stay out of the log.
    const logged: string[] = [];
    for (const line of lines.push(String(chunk))) {
      const status = parseTrayStatus(line);
      if (status) applyTrayStatus(status);
      else if (line.trim()) logged.push(line);
    }
    if (logged.length === 0) return;
    const text = logged.join("\n");
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
    applyTrayStatus({ busy: false, accent: trayStatus.accent });
    updateMenu();

    if (stoppedIntentionally) return;
    if (companionRunWasStable(startedAt, Date.now())) companionRestartFailures = 0;
    const delayMs = companionRestartDelayMs(companionRestartFailures);
    companionRestartFailures += 1;
    addLog("warn", "companion", `Reinicio automático programado en ${Math.round(delayMs / 1000)} segundo(s).`);
    if (companionRestartFailures === 1) {
      notify("VideoCAT Companion", t("El proceso se detuvo inesperadamente. Se intentara reiniciar automaticamente."));
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

const trayClickActions = ["open", "activity", "settings"] as const;
type TrayClickAction = typeof trayClickActions[number];
const trayGestureMs = 600;
let lastTrayActivation = 0;

function trayClickAction(value: string | undefined): TrayClickAction {
  return trayClickActions.includes(value as TrayClickAction) ? value as TrayClickAction : "open";
}

function onTrayActivated(): void {
  const now = Date.now();
  if (now - lastTrayActivation < trayGestureMs) return;
  lastTrayActivation = now;
  const action = trayClickAction(process.env.TRAY_CLICK_ACTION);
  if (action === "activity") openLogWindow();
  else if (action === "settings") openConfigWindow();
  else void openVideoCat();
}

async function openVideoCat(): Promise<void> {
  const target = process.env.WEB_URL ?? process.env.SERVER_URL ?? "http://localhost:8081";
  const parsed = new URL(target);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(t("WEB_URL debe usar http:// o https://."));
  }
  await shell.openExternal(parsed.toString());
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
    width: 920,
    height: 620,
    minWidth: 640,
    minHeight: 500,
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
  void configWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(configHtml(configLogoDataUrl(), app.getVersion(), trayLanguage()))}`);
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
  void logWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(logHtml(app.getVersion(), trayLanguage()))}`);
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
  const companionLabel = `${companion ? t("Companion activo") : t("Companion detenido")} v${app.getVersion()}`;

  const manualTargets = parseTargets(process.env.COMPANION_MONITORED_TARGETS).filter((target) => target.enabled !== false);
  const diskItems = lastMounted.length === 0 && manualTargets.length === 0
    ? [{ label: t("Sin discos VideoCAT detectados"), enabled: false }]
    : [
      ...lastMounted.map((disk) => ({
        label: `${disk.marker.diskName} (${disk.root})`,
        submenu: [
          {
            label: t("Escanear y reparar miniaturas"),
            enabled: !busy,
            click: () => runAgentTask(t("Escaneo de {name}", { name: disk.marker.diskName }), ["scan", "--path", disk.root])
          },
          {
            label: t("Procesar borrados pendientes"),
            enabled: !busy,
            click: () => runAgentTask(t("Borrados de {name}", { name: disk.marker.diskName }), ["process-deletes"])
          }
        ]
      })),
      ...manualTargets.map((target) => ({
        label: `${target.name} (${target.path})`,
        submenu: [
          {
            label: t("Escanear y reparar miniaturas"),
            enabled: !busy,
            click: () => runAgentTask(t("Escaneo de {name}", { name: target.name }), [
              "scan",
              "--path", target.path,
              "--disk-name", target.name,
              "--disk-id", target.id,
              "--volume-id", target.id,
              "--root-as-path"
            ])
          },
          {
            label: t("Procesar borrados pendientes"),
            enabled: !busy,
            click: () => runAgentTask(t("Borrados de {name}", { name: target.name }), ["process-deletes"])
          }
        ]
      }))
    ];

  const readyVersion = updater.readyVersion;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: companionLabel, enabled: false },
    ...(readyVersion ? [{ label: t("Reiniciar para actualizar a v{version}", { version: readyVersion }), enabled: !busy, click: () => installUpdate() }] : []),
    { type: "separator" },
    { label: t("Abrir VideoCAT"), click: () => void openVideoCat() },
    { label: t("Configuración..."), click: () => openConfigWindow() },
    { label: t("Ver actividad..."), click: () => openLogWindow() },
    { label: t("Actualizar discos"), click: () => void refreshMountedDisks().finally(updateMenu) },
    { label: t("Discos conectados"), submenu: diskItems },
    { type: "separator" },
    {
      label: companion ? t("Reiniciar companion") : t("Iniciar companion"),
      click: () => {
        restartCompanion();
        updateMenu();
      }
    },
    {
      label: t("Procesar borrados pendientes"),
      enabled: !busy,
      click: () => runAgentTask(t("Borrados pendientes"), ["process-deletes"])
    },
    { label: t("Buscar actualizaciones"), visible: updater.installed, click: () => void checkForUpdates(true) },
    { type: "separator" },
    {
      label: t("Salir"),
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
      title: t("Seleccionar carpeta para monitorear"),
      properties: ["openDirectory", "createDirectory"]
    };
    const result = configWindow
      ? await dialog.showOpenDialog(configWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("config:list-drives", async () => discoverAccessibleDrives());
  ipcMain.handle("health:status", async () => healthStatus());
  ipcMain.handle("health:enable", async () => enableHealth());
  ipcMain.handle("health:disable", async () => disableHealth());
  ipcMain.handle("health:check", async (): Promise<HealthResult> => (await runHealthTask())
    ? { ok: true, message: t("Revisión iniciada. El resultado llega a VideoCAT en un minuto.") }
    : { ok: false, message: t("No se pudo iniciar la revisión: activa la salud de discos otra vez.") });
  ipcMain.handle("config:convert-drive", async (_event, input: { root: string; name: string }) => convertDrive(input));
  ipcMain.handle("config:check-identity", async (_event, targetId: string, root: string) => checkDriveIdentity(String(targetId), String(root)));
  ipcMain.handle("config:pin-identity", async (_event, input: { targetId: string; root: string; name: string; acceptMixed?: boolean }) =>
    pinDriveIdentity(input));
  ipcMain.handle("config:save", async (_event, values: Record<string, string>): Promise<ConfigSaveResult> => {
    try {
      const normalized = normalizeConfig(values);
      const validationError = validateConfig(normalized);
      if (validationError) return { ok: false, message: validationError };
      // Whole drives get a marker from Añadir unidad; a new route by letter would follow whatever
      // drive Windows puts there. Routes saved by older builds stay until their identity is pinned.
      const saved = new Set(parseTargets(process.env.COMPANION_MONITORED_TARGETS).map((target) => target.id));
      if (parseTargets(normalized.COMPANION_MONITORED_TARGETS).some((target) => isDriveRoot(target.path) && !saved.has(target.id))) {
        return { ok: false, message: t("Una unidad completa se añade con Añadir unidad, que le crea su marcador. Por letra, Windows podría dársela a otro disco.") };
      }

      const languageBefore = trayLanguage();
      const target = await saveConfig(normalized);
      restartCompanion();
      updateMenu();
      // A new language: the open windows are drawn again in it.
      if (trayLanguage() !== languageBefore) {
        void configWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(configHtml(configLogoDataUrl(), app.getVersion(), trayLanguage()))}`);
        void logWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(logHtml(app.getVersion(), trayLanguage()))}`);
      }
      notify("VideoCAT Companion", t("Configuración guardada. Companion reiniciado."));
      return { ok: true, path: target };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
  });
  ipcMain.on("config:close", () => {
    configWindow?.close();
  });
  ipcMain.handle("update:status", () => updateStatus());
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.on("update:install", () => installUpdate());
  ipcMain.handle("log:load", () => logEntries);
  ipcMain.handle("log:clear", () => {
    clearLogs();
    return { ok: true };
  });
  ipcMain.on("log:close", () => {
    logWindow?.close();
  });

  const icon = iconPath();
  trayBaseImage = icon ? nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(trayBaseImage);
  tray.setToolTip(`VideoCAT Companion v${app.getVersion()}`);
  // Windows sends a click with every double click: one action per gesture.
  tray.on("click", () => onTrayActivated());
  tray.on("double-click", () => onTrayActivated());

  startCompanion();
  await refreshMountedDisks();
  updateMenu();
  notify("VideoCAT Companion", t("Listo en la bandeja del sistema."));

  setInterval(() => {
    void refreshMountedDisks().finally(updateMenu);
  }, Number(process.env.TRAY_DISK_POLL_MS ?? 10000));

  if (updater.installed) {
    setTimeout(() => void checkForUpdates(), firstUpdateCheckDelayMs);
    setInterval(() => void checkForUpdates(), updateCheckIntervalMs);
  }
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
