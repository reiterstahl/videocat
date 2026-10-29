import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray, type NativeImage } from "electron";
import type { OpenDialogOptions } from "electron";
import { companionRestartDelayMs, companionRunWasStable } from "./companion-supervisor.js";
import { formatTrayTooltip, LineSplitter, parseAccent, parseTrayStatus, prepareTrayIcon, trayFrames, trayFramesPerTurn, trayTurnMs, type TrayStatus } from "./tray-animation.js";
import { loadOrCreateCompanionIdentity } from "./identity.js";
import { generateCompanionToken, minimumCompanionTokenLength } from "./local-auth.js";
import { configFrom, configKeys, normalizeConfig, parseEnvText, parseTargets, trayClickActions, writeConfig, type TrayClickAction } from "./config-store.js";
import type { AvailableDrive, IdentityCheckResult, MarkerResult } from "./drive-identity.js";
import type { HealthResult, HealthStatus } from "./disk-health-control.js";
import type { PairingResult as AgentPairingResult } from "./pairing.js";
import { parseTrayApiLine } from "./tray-api.js";
import type { DiskMarker } from "./disk-marker.js";
import { CompanionUpdater, createUpdateClient, runVelopackHooks } from "./updater.js";
import { resolveTrayLanguage, translateTray, type TrayLanguage } from "./tray-i18n.js";
import { configHtml, logHtml } from "./tray-pages.js";

// Velopack may start the app only to run an install/update hook and exit, so this runs first.
if (app.isPackaged && process.platform === "win32") runVelopackHooks();

type MountedDisk = {
  root: string;
  marker: DiskMarker;
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

async function loadEnvCandidate(candidate: string, overrideExisting: boolean): Promise<void> {
  try {
    const raw = await fs.readFile(candidate, "utf8");
    if (!loadedEnvFiles.includes(candidate)) loadedEnvFiles.push(candidate);
    for (const [key, value] of Object.entries(parseEnvText(raw))) {
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

// What the tray read from the settings file: the fallback while the agent does not answer.
function currentConfig(): Record<string, string> {
  return configFrom(process.env);
}

// Only before the agent runs (a missing browser token); afterwards the agent writes the settings.
async function saveConfig(values: Record<string, string>): Promise<string> {
  const normalized = normalizeConfig(values);
  await writeConfig(userEnvPath(), normalized);
  for (const key of configKeys) process.env[key] = normalized[key];
  if (!loadedEnvFiles.includes(userEnvPath())) loadedEnvFiles.push(userEnvPath());
  return userEnvPath();
}

// The tray's API on the agent (tray-api.ts): a token made now and never stored, and the port the
// agent announces when it listens.
const trayToken = randomBytes(32).toString("hex");
let agentApiPort: number | null = null;

async function agentApi<T>(method: string, route: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  // The agent may be starting or restarting: wait for its port a little.
  for (let waited = 0; agentApiPort == null && waited < 15_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
  if (agentApiPort == null) throw new Error(t("El Companion no responde: reinícialo desde el menú de la bandeja."));
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${agentApiPort}${route}`, {
      method,
      headers: { "X-VideoCat-Tray-Token": trayToken, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error(t("El Companion no responde: reinícialo desde el menú de la bandeja."));
  }
  const result = await response.json().catch(() => null) as T | null;
  if (!response.ok || result == null) throw new Error((result as { message?: string } | null)?.message ?? t("El Companion no responde: reinícialo desde el menú de la bandeja."));
  return result;
}

// The settings file changed (saved by the agent): the tray reads it again.
async function reloadSettings(): Promise<void> {
  await loadEnvCandidate(userEnvPath(), true);
}

function pairedServerUrl(): string | null {
  return pairedCredential && storedCredential ? storedCredential.serverUrl : null;
}

function agentScriptPath(): string {
  if (app.isPackaged) return path.join(resourcesPath(), "app.asar", "dist", "index.js");
  return path.join(app.getAppPath(), "dist", "index.js");
}

function childEnv(): NodeJS.ProcessEnv {
  let credential: string | undefined;
  try {
    const server = process.env.SERVER_URL ? new URL(process.env.SERVER_URL).toString().replace(/\/$/, "") : "";
    if (pairedCredential && storedCredential && server === storedCredential.serverUrl) credential = pairedCredential;
  } catch {
    credential = undefined;
  }
  return {
    ...process.env,
    // The tray's API (tray-api.ts): its token, the settings file and smartctl's folder.
    VIDEOCAT_TRAY_TOKEN: trayToken,
    VIDEOCAT_CONFIG_PATH: userEnvPath(),
    VIDEOCAT_SMART_TOOLS_DIR: smartToolsDir(),
    ...(credential && storedCredential ? {
      VIDEOCAT_AGENT_CREDENTIAL: credential,
      VIDEOCAT_COMPANION_ID: storedCredential.companionId
    } : {}),
    // A read stuck on a bad sector holds one of Node's I/O threads (4 by default); with more of
    // them, one stuck file never freezes the rest of the Companion.
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? "16",
    // The agent writes its log lines in the language the tray shows.
    VIDEOCAT_LANGUAGE: trayLanguage(),
    // The agent leaves on its own when this tray process is gone (no orphan agents).
    VIDEOCAT_PARENT_WATCH: "1",
    ELECTRON_RUN_AS_NODE: "1"
  };
}

async function pairCompanion(code: string, values: Record<string, string>): Promise<PairingResult> {
  try {
    const paired = await agentApi<AgentPairingResult>("POST", "/tray/pair", { code, values });
    if (!paired.ok) return paired;
    // The credential is encrypted and kept first; only then the shared token leaves the settings.
    await saveStoredCredential({ companionId: paired.companionId, serverUrl: paired.serverUrl, issuedAt: paired.issuedAt }, paired.credential);
    const saved = await agentApi<ConfigSaveResult>("PUT", "/tray/config", { values: { ...values, SERVER_URL: paired.serverUrl, AGENT_TOKEN: "" }, pairedServerUrl: paired.serverUrl });
    if (!saved.ok) return saved;
    await reloadSettings();
    addLog("info", "seguridad", `Companion emparejado con ${paired.serverUrl}. Configuración: ${saved.path}`);
    restartCompanion();
    updateMenu();
    notify("VideoCAT Companion", t("Emparejamiento completado. La credencial individual se guardo cifrada."));
    return { ok: true, companionId: paired.companionId, issuedAt: paired.issuedAt };
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

// Drive health (SMART): the agent turns it on and off (disk-health-control.ts); smartctl and its
// scripts travel in resources/smartmontools (scripts/fetch-smartctl.mjs).
function smartToolsDir(): string {
  return app.isPackaged ? path.join(resourcesPath(), "smartmontools") : path.join(app.getAppPath(), "release", "smartmontools");
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

// The drives the menu lists, from the agent; while it does not answer the menu keeps the last ones.
async function refreshMountedDisks(): Promise<void> {
  let mounted: MountedDisk[];
  try {
    mounted = (await agentApi<{ disks: MountedDisk[] }>("GET", "/tray/drives/mounted")).disks;
  } catch {
    return;
  }
  const previous = new Set(lastMounted.map((disk) => disk.marker.diskId));
  lastMounted = mounted;
  for (const disk of lastMounted) {
    if (!previous.has(disk.marker.diskId)) addLog("info", "discos", `Detectado ${disk.marker.diskName} en ${disk.root}`);
  }
}

// A marker written or a route by letter retired: the agent saved the settings, so the tray reads
// them again and restarts the agent, which follows the drive by its marker from then on.
async function afterMarkerChange(result: MarkerResult): Promise<MarkerResult> {
  if (result.ok && (result.removedTargetId || result.pausedTargetIds.length > 0)) {
    await reloadSettings();
    restartCompanion();
  }
  await refreshMountedDisks();
  updateMenu();
  return result;
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
      const port = status ? null : parseTrayApiLine(line);
      if (status) applyTrayStatus(status);
      else if (port != null) agentApiPort = port;
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
    if (companion === child) {
      companion = null;
      agentApiPort = null;
    }
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
  if (companion === child) {
    companion = null;
    agentApiPort = null;
  }
  child?.kill();
}

function restartCompanion(): void {
  companionRestartFailures = 0;
  stopCompanion();
  startCompanion();
}

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
    await saveConfig(currentConfig());
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

  ipcMain.handle("config:load", async () => {
    try {
      return (await agentApi<{ values: Record<string, string> }>("GET", "/tray/config")).values;
    } catch {
      return currentConfig();
    }
  });
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
  // Everything below is the agent's (tray-api.ts); a failure comes back as the action's message.
  const failure = (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) });
  ipcMain.handle("config:list-drives", async () => (await agentApi<{ drives: AvailableDrive[] }>("GET", "/tray/drives").catch(() => ({ drives: [] }))).drives);
  ipcMain.handle("health:status", async () => agentApi<HealthStatus>("GET", "/tray/health")
    .catch((): HealthStatus => ({ supported: process.platform === "win32", installed: false, administrator: false, lastCheckedAt: null })));
  // Turning it on or off waits for Windows' administrator prompt.
  ipcMain.handle("health:enable", async () => agentApi<HealthResult>("POST", "/tray/health/enable", undefined, 6 * 60_000).catch(failure));
  ipcMain.handle("health:disable", async () => agentApi<HealthResult>("POST", "/tray/health/disable", undefined, 6 * 60_000).catch(failure));
  ipcMain.handle("health:check", async () => agentApi<HealthResult>("POST", "/tray/health/check").catch(failure));
  ipcMain.handle("config:convert-drive", async (_event, input: { root: string; name: string }) =>
    afterMarkerChange(await agentApi<MarkerResult>("POST", "/tray/drives/convert", { root: input.root, name: input.name }).catch(failure)));
  ipcMain.handle("config:check-identity", async (_event, targetId: string, root: string) =>
    agentApi<IdentityCheckResult>("POST", "/tray/drives/check-identity", { targetId: String(targetId), root: String(root) }).catch(failure));
  ipcMain.handle("config:pin-identity", async (_event, input: { targetId: string; root: string; name: string; acceptMixed?: boolean }) =>
    afterMarkerChange(await agentApi<MarkerResult>("POST", "/tray/drives/pin-identity", input).catch(failure)));
  ipcMain.handle("config:save", async (_event, values: Record<string, string>): Promise<ConfigSaveResult> => {
    try {
      // The agent checks and writes them (tray-api.ts); the tray reads them back and restarts it.
      const saved = await agentApi<ConfigSaveResult>("PUT", "/tray/config", { values, pairedServerUrl: pairedServerUrl() });
      if (!saved.ok) return saved;
      const languageBefore = trayLanguage();
      await reloadSettings();
      const target = saved.path;
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
  // Development only (tests): a window opens without clicking the tray icon.
  if (!app.isPackaged && process.env.VIDEOCAT_TRAY_OPEN === "settings") openConfigWindow();
  if (!app.isPackaged && process.env.VIDEOCAT_TRAY_OPEN === "activity") openLogWindow();

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
