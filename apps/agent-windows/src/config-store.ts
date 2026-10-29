import fs from "node:fs/promises";
import path from "node:path";
import { tl } from "./agent-language.js";
import { generateCompanionToken, minimumCompanionTokenLength } from "./local-auth.js";

// The Companion's settings file (%APPDATA%\VideoCAT Companion\.env): its keys, defaults, how it is
// read, checked and written. The agent owns it (the tray asks for it through /tray/config); the
// tray still reads it once at start, before the agent runs.

export const configKeys = [
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
export type ConfigKey = typeof configKeys[number];
export type CompanionConfig = Record<ConfigKey, string>;
export type Translate = (text: string, values?: Record<string, string | number>) => string;

export const configDefaults: Partial<CompanionConfig> = {
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

export const trayClickActions = ["open", "activity", "settings"] as const;
export type TrayClickAction = typeof trayClickActions[number];

const requiredConfigKeys = new Set<ConfigKey>(["SERVER_URL"]);

// Monitored paths added by hand (COMPANION_MONITORED_TARGETS, a JSON list).
export type CompanionTarget = {
  id: string;
  name: string;
  path: string;
  enabled?: boolean;
};

export function normalizeScanRoot(root: string): string {
  const cleaned = root.trim().replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
  return cleaned === "" || cleaned === "." ? "." : cleaned;
}

export function normalizeTargetPath(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
  return path.resolve(trimmed);
}

export function parseTargets(value: string | undefined): CompanionTarget[] {
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

export function serializeTargets(targets: CompanionTarget[]): string {
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

export function parseEnvText(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt <= 0) continue;
    values[trimmed.slice(0, equalsAt).trim()] = parseEnvValue(trimmed.slice(equalsAt + 1));
  }
  return values;
}

// null when the file is missing or unreadable: settings files are optional.
export async function readEnvFile(file: string): Promise<Record<string, string> | null> {
  try {
    return parseEnvText(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function envLine(key: ConfigKey, value: string): string {
  if (!value) return `${key}=`;
  if (/[\s#"']/.test(value)) {
    return `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return `${key}=${value}`;
}

// Every key, from the given values or else the default.
export function configFrom(values: Record<string, string | undefined>): CompanionConfig {
  return Object.fromEntries(configKeys.map((key) => [key, values[key] ?? configDefaults[key] ?? ""])) as CompanionConfig;
}

export function normalizeConfig(values: Record<string, string>): CompanionConfig {
  const normalized = Object.fromEntries(configKeys.map((key) => {
    const value = String(values[key] ?? "").trim();
    return [key, value || configDefaults[key] || ""];
  })) as CompanionConfig;
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

export function normalizeServerUrl(value: string, translate: Translate = tl): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(translate("SERVER_URL debe iniciar con http:// o https://."));
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function validateUrl(value: string, label: string, translate: Translate): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return translate("{label} debe iniciar con http:// o https://.", { label });
  } catch {
    return translate("{label} no parece una URL valida.", { label });
  }
  return null;
}

function validatePositiveInteger(value: string, label: string, translate: Translate): string | null {
  if (!/^\d+$/.test(value) || Number(value) <= 0) return translate("{label} debe ser un numero entero mayor a cero.", { label });
  return null;
}

// pairedServerUrl: the server this Companion holds a paired credential for (the tray keeps it).
export function validateConfig(
  values: CompanionConfig,
  options: { pairedServerUrl?: string | null; allowMissingCredential?: boolean; translate?: Translate } = {}
): string | null {
  const translate = options.translate ?? tl;
  for (const key of requiredConfigKeys) {
    if (!values[key]) return translate("{key} es obligatorio.", { key });
  }

  let pairedForThisServer = false;
  try {
    pairedForThisServer = Boolean(options.pairedServerUrl) && normalizeServerUrl(values.SERVER_URL, translate) === options.pairedServerUrl;
  } catch {
    pairedForThisServer = false;
  }
  if (!options.allowMissingCredential && !values.AGENT_TOKEN && !pairedForThisServer) {
    return translate("Empareja este Companion o configura AGENT_TOKEN para continuar.");
  }

  return validateUrl(values.SERVER_URL, "SERVER_URL", translate)
    ?? (values.WEB_URL ? validateUrl(values.WEB_URL, "WEB_URL", translate) : null)
    ?? validatePositiveInteger(values.COMPANION_PORT, "COMPANION_PORT", translate)
    ?? validatePositiveInteger(values.COMPANION_DISK_POLL_MS, "COMPANION_DISK_POLL_MS", translate)
    ?? validatePositiveInteger(values.COMPANION_SCAN_POLL_MS, "COMPANION_SCAN_POLL_MS", translate)
    ?? validatePositiveInteger(values.COMPANION_HEARTBEAT_MS, "COMPANION_HEARTBEAT_MS", translate)
    ?? validatePositiveInteger(values.COMPANION_DELETE_POLL_MS, "COMPANION_DELETE_POLL_MS", translate)
    ?? validatePositiveInteger(values.COMPANION_DOWNLOAD_POLL_MS, "COMPANION_DOWNLOAD_POLL_MS", translate)
    ?? validatePositiveInteger(values.COMPANION_DOWNLOAD_STALL_MS, "COMPANION_DOWNLOAD_STALL_MS", translate)
    ?? validatePositiveInteger(values.TRAY_DISK_POLL_MS, "TRAY_DISK_POLL_MS", translate)
    ?? (values.COMPANION_FILE_TIMEOUT_SECONDS && !(Number(values.COMPANION_FILE_TIMEOUT_SECONDS) >= 30 && Number(values.COMPANION_FILE_TIMEOUT_SECONDS) <= 3600)
      ? translate("COMPANION_FILE_TIMEOUT_SECONDS debe estar entre 30 y 3600 segundos.")
      : null)
    ?? (!/^(true|false)$/i.test(values.COMPANION_REMOTE_REMUX_ENABLED)
      ? translate("COMPANION_REMOTE_REMUX_ENABLED debe ser true o false.")
      : null)
    ?? (!/^(true|false)$/i.test(values.COMPANION_AUTO_DELETE_MARKED)
      ? translate("COMPANION_AUTO_DELETE_MARKED debe ser true o false.")
      : null)
    ?? (!trayClickActions.includes(values.TRAY_CLICK_ACTION as TrayClickAction)
      ? translate("TRAY_CLICK_ACTION debe ser open, activity o settings.")
      : null);
}

// Written whole and then renamed, so a crash never leaves half a settings file.
export async function writeConfig(file: string, values: CompanionConfig): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${configKeys.map((key) => envLine(key, values[key])).join("\n")}\n`);
  await fs.rename(temporary, file);
}
