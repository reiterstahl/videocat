import crypto from "node:crypto";
import type http from "node:http";
import { tl } from "./agent-language.js";
import { configFrom, normalizeConfig, parseTargets, readEnvFile, validateConfig, writeConfig } from "./config-store.js";
import { checkHealthNow, disableHealth, enableHealth, healthStatus } from "./disk-health-control.js";
import { isDriveRoot } from "./disk-marker.js";
import { checkDriveIdentity, convertDrive, discoverAccessibleDrives, discoverMountedMarkers, pinDriveIdentity, type DriveContext } from "./drive-identity.js";
import { pairWithServer } from "./pairing.js";

// The tray's API on the agent's local listener (127.0.0.1), under /tray/: the settings, pairing,
// the drives and their identity, and drive health. The tray is a thin shell that asks the agent
// for each of these (COMPANION_TAURI_PLAN.es.md, phase 1a).
//
// Its own token, not the browser's COMPANION_TOKEN: the tray makes one when it starts, passes it
// as VIDEOCAT_TRAY_TOKEN and never stores it. A web page with the browser token can open, copy
// and delete files, but not change the settings, pair or turn drive health on. Requests with an
// Origin header are refused too: browsers always send one, the tray never does.

export const trayApiPrefix = "@@videocat-api ";
export const minimumTrayTokenLength = 32;
const maxBodyBytes = 256 * 1024;

// Printed once the listener is up, so the tray learns the port (it may not be the configured one).
export function trayApiLine(port: number): string {
  return `${trayApiPrefix}${JSON.stringify({ port })}`;
}

export function parseTrayApiLine(line: string): number | null {
  if (!line.startsWith(trayApiPrefix)) return null;
  try {
    const port = Number((JSON.parse(line.slice(trayApiPrefix.length)) as { port?: unknown }).port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

export function isTrayRequestAuthorized(expected: string | undefined, headers: http.IncomingHttpHeaders): boolean {
  const token = expected?.trim();
  if (!token || token.length < minimumTrayTokenLength || headers.origin) return false;
  const presented = headers["x-videocat-tray-token"];
  if (typeof presented !== "string" || !presented) return false;
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(presented), digest(token));
}

export type TrayApiContext = DriveContext & {
  // Where a new Companion identity lives when AGENT_STATE_DIR is empty, and the version the server sees.
  defaultStateRoot: string;
  version: number;
};

class TrayRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new TrayRequestError(413, "Request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new TrayRequestError(400, "Invalid JSON body");
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, text(item)]));
}

async function saveSettings(context: TrayApiContext, body: Record<string, unknown>) {
  const normalized = normalizeConfig(stringRecord(body.values));
  const validationError = validateConfig(normalized, { pairedServerUrl: text(body.pairedServerUrl) || null });
  if (validationError) return { ok: false as const, message: validationError };
  // Whole drives get a marker from Añadir unidad; a new route by letter would follow whatever
  // drive Windows puts there. Routes saved by older builds stay until their identity is pinned.
  const saved = new Set(parseTargets((await readEnvFile(context.configPath))?.COMPANION_MONITORED_TARGETS).map((target) => target.id));
  if (parseTargets(normalized.COMPANION_MONITORED_TARGETS).some((target) => (context.isDriveRoot ?? isDriveRoot)(target.path) && !saved.has(target.id))) {
    return { ok: false as const, message: tl("Una unidad completa se añade con Añadir unidad, que le crea su marcador. Por letra, Windows podría dársela a otro disco.") };
  }
  await writeConfig(context.configPath, normalized);
  return { ok: true as const, path: context.configPath };
}

async function route(request: http.IncomingMessage, context: TrayApiContext): Promise<unknown> {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const key = `${method} ${pathname}`;

  if (key === "GET /tray/config") return { values: configFrom((await readEnvFile(context.configPath)) ?? {}) };
  if (key === "PUT /tray/config") return saveSettings(context, await readBody(request));
  if (key === "POST /tray/pair") {
    const body = await readBody(request);
    return pairWithServer({ code: text(body.code), values: stringRecord(body.values), defaultStateRoot: context.defaultStateRoot, version: context.version });
  }
  if (key === "GET /tray/drives") return { drives: await discoverAccessibleDrives(context) };
  if (key === "GET /tray/drives/mounted") return { disks: await discoverMountedMarkers(context) };
  if (key === "POST /tray/drives/convert") {
    const body = await readBody(request);
    return convertDrive(context, { root: text(body.root), name: text(body.name) });
  }
  if (key === "POST /tray/drives/check-identity") {
    const body = await readBody(request);
    return checkDriveIdentity(context, text(body.targetId), text(body.root));
  }
  if (key === "POST /tray/drives/pin-identity") {
    const body = await readBody(request);
    return pinDriveIdentity(context, { targetId: text(body.targetId), root: text(body.root), name: text(body.name), acceptMixed: body.acceptMixed === true });
  }
  if (key === "GET /tray/health") return healthStatus();
  if (key === "POST /tray/health/enable") return enableHealth();
  if (key === "POST /tray/health/disable") return disableHealth();
  if (key === "POST /tray/health/check") return checkHealthNow();
  throw new TrayRequestError(404, "Not found");
}

export async function handleTrayRequest(request: http.IncomingMessage, response: http.ServerResponse, context: TrayApiContext): Promise<void> {
  if (!isTrayRequestAuthorized(process.env.VIDEOCAT_TRAY_TOKEN, request.headers)) {
    send(response, 403, { ok: false, message: "Forbidden" });
    return;
  }
  try {
    send(response, 200, await route(request, context));
  } catch (error) {
    if (error instanceof TrayRequestError) send(response, error.status, { ok: false, message: error.message });
    else send(response, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}
