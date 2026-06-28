import fs from "node:fs/promises";
import path from "node:path";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import type { OpenDialogOptions } from "electron";

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
  "COMPANION_PORT",
  "COMPANION_ALLOWED_ORIGINS",
  "COMPANION_TOKEN",
  "COMPANION_DISK_POLL_MS",
  "COMPANION_SCAN_POLL_MS",
  "COMPANION_HEARTBEAT_MS",
  "COMPANION_DELETE_POLL_MS",
  "COMPANION_DOWNLOAD_POLL_MS",
  "COMPANION_DOWNLOAD_STALL_MS",
  "COMPANION_DOWNLOAD_DIR",
  "COMPANION_AUTO_DELETE_MARKED",
  "COMPANION_MONITORED_TARGETS",
  "COMPANION_DISABLED_DISK_IDS",
  "TRAY_DISK_POLL_MS"
] as const;
type ConfigKey = typeof configKeys[number];
type ConfigSaveResult = { ok: true; path: string } | { ok: false; message: string };

const requiredConfigKeys = new Set<ConfigKey>(["SERVER_URL", "AGENT_TOKEN"]);
const configDefaults: Partial<Record<ConfigKey, string>> = {
  COMPANION_PORT: "29429",
  COMPANION_DISK_POLL_MS: "5000",
  COMPANION_SCAN_POLL_MS: "900000",
  COMPANION_HEARTBEAT_MS: "15000",
  COMPANION_DELETE_POLL_MS: "60000",
  COMPANION_DOWNLOAD_POLL_MS: "60000",
  COMPANION_DOWNLOAD_STALL_MS: "30000",
  COMPANION_AUTO_DELETE_MARKED: "true",
  TRAY_DISK_POLL_MS: "10000"
};
let tray: Tray | null = null;
let companion: ChildProcessWithoutNullStreams | null = null;
let lastMounted: MountedDisk[] = [];
let configWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;
let busy = false;
let nextLogId = 1;
const logEntries: LogEntry[] = [];
const maxLogEntries = 1000;

function resourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? process.cwd();
}

function userEnvPath(): string {
  return path.join(app.getPath("userData"), ".env");
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

function validateConfig(values: Record<ConfigKey, string>): string | null {
  for (const key of requiredConfigKeys) {
    if (!values[key]) return `${key} es obligatorio.`;
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
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1"
  };
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
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
  child.once("exit", (code) => {
    busy = false;
    void refreshMountedDisks().finally(updateMenu);
    const tail = output.trim().split(/\r?\n/).slice(-3).join("\n");
    addLog(code === 0 ? "info" : "error", label, `Terminado con codigo ${code ?? "desconocido"}.`);
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

  addLog("info", "companion", "Iniciando companion.");
  companion = spawnAgent(["companion"]);
  companion.stdout.on("data", (chunk) => {
    const text = String(chunk);
    console.log(text.trim());
    addLog("info", "companion", text);
  });
  companion.stderr.on("data", (chunk) => {
    const text = String(chunk);
    console.error(text.trim());
    addLog("error", "companion", text);
  });
  companion.once("exit", (code) => {
    addLog(code === 0 ? "info" : "warn", "companion", `Companion detenido con codigo ${code ?? "desconocido"}.`);
    companion = null;
    updateMenu();
  });
}

function stopCompanion(): void {
  if (companion && !companion.killed) addLog("info", "companion", "Deteniendo companion.");
  companion?.kill();
  companion = null;
}

async function openVideoCat(): Promise<void> {
  const target = process.env.WEB_URL ?? process.env.SERVER_URL ?? "http://localhost:8081";
  await shell.openExternal(target);
}

function configHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VideoCAT Companion</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #10171c; color: #eef5f7; }
    main { padding: 22px; display: grid; gap: 14px; }
    h1 { margin: 0; font-size: 20px; }
    p { margin: 0; color: #9aabb4; line-height: 1.4; }
    label { display: grid; gap: 6px; color: #9aabb4; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    input, textarea, select { min-height: 38px; border: 1px solid #2b3941; border-radius: 7px; background: #151c21; color: #fff; padding: 0 10px; font: inherit; }
    textarea { min-height: 72px; padding: 10px; resize: vertical; }
    input:focus, textarea:focus, select:focus { outline: 2px solid rgba(252, 97, 33, 0.45); border-color: #fc6121; }
    input:invalid { border-color: rgba(252, 97, 33, 0.8); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .full { grid-column: 1 / -1; }
    .monitor-panel { grid-column: 1 / -1; border: 1px solid #26343c; border-radius: 9px; padding: 12px; display: grid; gap: 10px; background: #0f171c; }
    .monitor-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .monitor-head h2 { margin: 0; font-size: 15px; }
    .monitor-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .monitor-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid #24343d; border-radius: 8px; padding: 10px; background: #131d23; }
    .monitor-row strong, .monitor-row span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .monitor-row strong { color: #fff; font-size: 13px; }
    .monitor-row span { color: #9aabb4; font-size: 12px; margin-top: 2px; }
    .monitor-row small { display: inline-block; color: #ffb98f; font-size: 11px; font-weight: 900; margin-top: 4px; text-transform: uppercase; }
    .monitor-empty { color: #78909c; font-size: 12px; font-weight: 800; border: 1px dashed #2b3941; border-radius: 8px; padding: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 8px; }
    button { min-height: 38px; border: 0; border-radius: 7px; padding: 0 14px; font-weight: 900; color: #fff; background: #53636c; }
    button.primary { background: #fc6121; }
    button.danger { background: #b7352b; }
    button.ghost { background: transparent; border: 1px solid #33444d; }
    button:disabled { opacity: 0.6; cursor: wait; }
    .required { color: #fc6121; }
    .hint { color: #b1c4ce; font-size: 12px; font-weight: 700; }
    #status { min-height: 18px; color: #93d8af; font-size: 13px; font-weight: 800; }
    #status.is-error { color: #ffb4a4; }
    #status.is-info { color: #b1c4ce; }
  </style>
</head>
<body>
  <main>
    <div>
      <h1>VideoCAT Companion</h1>
      <p>Configura la conexion que usa el agente para reportar escaneos y recibir tareas.</p>
    </div>
    <form id="form" class="grid">
      <div class="hint full"><span class="required">*</span> Campos obligatorios para escanear y reportar al servidor.</div>
      <label class="full">SERVER_URL <span class="required">*</span><input name="SERVER_URL" required placeholder="http://192.168.1.27:8081" /></label>
      <label class="full">WEB_URL<input name="WEB_URL" placeholder="https://cat.example.com" /></label>
      <label class="full">AGENT_TOKEN <span class="required">*</span><input name="AGENT_TOKEN" required type="password" /></label>
      <label>COMPANION_PORT<input name="COMPANION_PORT" placeholder="29429" /></label>
      <label>COMPANION_TOKEN<input name="COMPANION_TOKEN" type="password" /></label>
      <label class="full">COMPANION_ALLOWED_ORIGINS<input name="COMPANION_ALLOWED_ORIGINS" /></label>
      <label>COMPANION_DISK_POLL_MS<input name="COMPANION_DISK_POLL_MS" placeholder="5000" /></label>
      <label>COMPANION_SCAN_POLL_MS<input name="COMPANION_SCAN_POLL_MS" placeholder="900000" /></label>
      <label>COMPANION_HEARTBEAT_MS<input name="COMPANION_HEARTBEAT_MS" placeholder="15000" /></label>
      <label>COMPANION_DELETE_POLL_MS<input name="COMPANION_DELETE_POLL_MS" placeholder="60000" /></label>
      <label>COMPANION_DOWNLOAD_POLL_MS<input name="COMPANION_DOWNLOAD_POLL_MS" placeholder="60000" /></label>
      <label>COMPANION_DOWNLOAD_STALL_MS<input name="COMPANION_DOWNLOAD_STALL_MS" placeholder="30000" /></label>
      <label class="full">COMPANION_DOWNLOAD_DIR<input name="COMPANION_DOWNLOAD_DIR" placeholder="C:\\Users\\tu_usuario\\Desktop\\VideoCAT" /></label>
      <section class="monitor-panel">
        <div class="monitor-head">
          <div>
            <h2>Rutas monitoreadas</h2>
            <p class="hint">Unidades y carpetas que el companion revisara automaticamente. Pueden ser rutas locales o de red.</p>
          </div>
          <div class="monitor-actions">
            <button type="button" id="addFolder" class="ghost">Añadir carpeta...</button>
            <button type="button" id="addDrive" class="ghost">Añadir unidad...</button>
          </div>
        </div>
        <div id="targetList"></div>
        <div>
          <p class="hint">Discos VideoCAT detectados con marcador. Puedes ignorarlos temporalmente sin borrar el marcador del disco.</p>
          <div id="autoDiskList"></div>
        </div>
        <textarea name="COMPANION_MONITORED_TARGETS" id="COMPANION_MONITORED_TARGETS" hidden></textarea>
        <input name="COMPANION_DISABLED_DISK_IDS" id="COMPANION_DISABLED_DISK_IDS" hidden />
      </section>
      <label>TRAY_DISK_POLL_MS<input name="TRAY_DISK_POLL_MS" placeholder="10000" /></label>
      <label>COMPANION_AUTO_DELETE_MARKED<input name="COMPANION_AUTO_DELETE_MARKED" placeholder="true" /></label>
      <div id="status" class="full"></div>
      <div class="actions full">
        <button type="button" id="close">Cerrar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  </main>
  <script>
    const form = document.getElementById("form");
    const status = document.getElementById("status");
    const targetList = document.getElementById("targetList");
    const autoDiskList = document.getElementById("autoDiskList");
    const targetInput = document.getElementById("COMPANION_MONITORED_TARGETS");
    const disabledInput = document.getElementById("COMPANION_DISABLED_DISK_IDS");
    let targets = [];
    let disabledDiskIds = new Set();
    let availableDrives = [];

    function setStatus(message, type = "info") {
      status.textContent = message;
      status.className = type === "error" ? "is-error" : type === "success" ? "" : "is-info";
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

    function renderMonitors() {
      syncMonitorInputs();
      targetList.textContent = "";
      if (targets.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No hay rutas manuales. Los discos con .videocat-disk.json siguen detectandose automaticamente.";
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
        type.textContent = ignored ? "ignorado" : "monitoreo automatico";
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
        setStatus("No se pudo cargar el puente de configuracion de Electron.", "error");
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
      } catch (error) {
        setStatus(error?.message || "No se pudo cargar la configuracion.", "error");
      }
    }

    void loadConfig();
    document.getElementById("close").addEventListener("click", () => window.videocatConfig?.close());
    document.getElementById("addFolder").addEventListener("click", async () => {
      if (!window.videocatConfig?.chooseFolder) {
        setStatus("No se pudo abrir el selector de carpetas.", "error");
        return;
      }
      const folder = await window.videocatConfig.chooseFolder();
      if (!folder) return;
      const defaultName = folder.split(/[\\\\/]/).filter(Boolean).pop() || folder;
      const name = prompt("Nombre para mostrar en VideoCAT:", defaultName);
      if (!name) return;
      targets.push({ id: newId(), name: name.trim(), path: folder, enabled: true });
      renderMonitors();
    });
    document.getElementById("addDrive").addEventListener("click", async () => {
      await refreshAvailableDrives();
      const choices = availableDrives.map((drive, index) => {
        const marker = drive.diskName ? " - " + drive.diskName : "";
        return (index + 1) + ". " + drive.root + marker;
      });
      if (choices.length === 0) {
        setStatus("No hay unidades conectadas para añadir.", "error");
        return;
      }
      const answer = prompt("Elige la unidad por numero:\\n\\n" + choices.join("\\n"));
      const index = Number(answer) - 1;
      const drive = availableDrives[index];
      if (!drive) return;
      if (drive.diskId) {
        disabledDiskIds.delete(drive.diskId);
        setStatus("Disco VideoCAT marcado para monitoreo automatico.", "success");
        renderMonitors();
        return;
      }
      const name = prompt("Nombre para mostrar en VideoCAT:", drive.root.replace(/\\\\$/, ""));
      if (!name) return;
      targets.push({ id: newId(), name: name.trim(), path: drive.root, enabled: true });
      renderMonitors();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!window.videocatConfig) {
        setStatus("No se pudo cargar el puente de configuracion de Electron. Cierra y abre de nuevo el companion.", "error");
        return;
      }
      syncMonitorInputs();
      const values = Object.fromEntries(new FormData(form).entries());
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      setStatus("Guardando configuracion...", "info");
      try {
        const result = await window.videocatConfig.save(values);
        if (!result.ok) {
          setStatus(result.message || "No se pudo guardar la configuracion.", "error");
          return;
        }
        setStatus("Configuracion guardada. Companion reiniciado.", "success");
      } catch (error) {
        setStatus(error?.message || "No se pudo guardar la configuracion.", "error");
      } finally {
        submit.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function openConfigWindow(): void {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 680,
    height: 620,
    title: "VideoCAT Companion",
    resizable: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  configWindow.removeMenu();
  configWindow.on("closed", () => {
    configWindow = null;
  });
  void configWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(configHtml())}`);
}

function logHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VideoCAT Actividad</title>
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
    .row { display: grid; grid-template-columns: 74px 86px 110px 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .time { color: #78909c; }
    .source { color: #dce8ed; font-weight: 800; }
    .message { color: #c8d5db; white-space: pre-wrap; overflow-wrap: anywhere; }
    .level { width: max-content; min-width: 58px; text-align: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .info .level { color: #bde8cd; background: rgba(39, 174, 96, 0.16); }
    .warn .level { color: #ffdf8f; background: rgba(245, 158, 11, 0.18); }
    .error .level { color: #ffb4a4; background: rgba(239, 68, 68, 0.2); }
    footer { padding: 10px 18px; color: #78909c; border-top: 1px solid #26343c; background: #121b20; font-size: 12px; font-weight: 700; }
    .empty { color: #78909c; padding: 20px; text-align: center; font-family: Segoe UI, Arial, sans-serif; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Actividad de VideoCAT Companion</h1>
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
    title: "VideoCAT Actividad",
    resizable: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
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
    ? [path.join(resourcesPath(), "logo.png"), path.join(resourcesPath(), "icon.ico")]
    : [
        path.resolve(process.cwd(), "logo.png"),
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
  const companionLabel = companion ? "Companion activo" : "Companion detenido";

  const manualTargets = parseTargets(process.env.COMPANION_MONITORED_TARGETS).filter((target) => target.enabled !== false);
  const diskItems = lastMounted.length === 0 && manualTargets.length === 0
    ? [{ label: "Sin discos VideoCAT detectados", enabled: false }]
    : [
      ...lastMounted.map((disk) => ({
        label: `${disk.marker.diskName} (${disk.root})`,
        submenu: [
          {
            label: "Escanear ahora",
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
            label: "Escanear ahora",
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
    { label: "Configuracion...", click: () => openConfigWindow() },
    { label: "Ver actividad...", click: () => openLogWindow() },
    { label: "Actualizar discos", click: () => void refreshMountedDisks().finally(updateMenu) },
    { label: "Discos conectados", submenu: diskItems },
    { type: "separator" },
    {
      label: companion ? "Reiniciar companion" : "Iniciar companion",
      click: () => {
        stopCompanion();
        startCompanion();
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
        stopCompanion();
        app.quit();
      }
    }
  ]));
}

async function main(): Promise<void> {
  await app.whenReady();
  app.setLoginItemSettings({ openAtLogin: false });
  await loadEnvFile();

  ipcMain.handle("config:load", () => currentConfig());
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
      stopCompanion();
      startCompanion();
      updateMenu();
      notify("VideoCAT Companion", "Configuracion guardada. Companion reiniciado.");
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
  tray.setToolTip("VideoCAT Companion");
  tray.on("click", () => void openVideoCat());

  startCompanion();
  await refreshMountedDisks();
  updateMenu();
  notify("VideoCAT Companion", `Listo en bandeja. Env: ${loadedEnvFiles.length || "sin .env"}.`);

  setInterval(() => {
    void refreshMountedDisks().finally(updateMenu);
  }, Number(process.env.TRAY_DISK_POLL_MS ?? 10000));
}

app.on("window-all-closed", () => {
  // Tray-only app: keep running until the user chooses "Salir".
});

main().catch((error) => {
  notify("VideoCAT Companion", error instanceof Error ? error.message : String(error));
  app.quit();
});
