import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { tl } from "./agent-language.js";
import {
  configFrom,
  normalizeConfig,
  normalizeScanRoot,
  normalizeServerUrl,
  normalizeTargetPath,
  parseTargets,
  readEnvFile,
  serializeTargets,
  writeConfig,
  type CompanionTarget
} from "./config-store.js";
import {
  checkIdentitySample,
  cleanDiskName,
  createDiskMarker,
  identitySampleSize,
  isDriveRoot,
  markerFileName,
  type DiskMarker,
  type IdentityCheck,
  type IdentitySampleFile
} from "./disk-marker.js";

// The drives of this PC and the identity of each one: which have a .videocat-disk.json, turning a
// drive into a VideoCAT drive (Convertir…), and pinning the identity of a route that followed a
// drive letter (Fijar identidad…) after comparing a sample of its catalog with the files on it.

export type AvailableDrive = {
  root: string;
  diskId?: string;
  diskName?: string;
  totalBytes?: number;
  freeBytes?: number;
};

export type IdentityCheckResult = { ok: true; root: string; diskName: string | null; check: IdentityCheck } | { ok: false; message: string };
// removedTargetId: the route by letter that became this marker; pausedTargetIds: other routes by
// letter that pointed at the same drive, so the window can show the same state without reloading.
export type MarkerResult =
  | { ok: true; root: string; diskId: string; diskName: string; removedTargetId: string | null; pausedTargetIds: string[] }
  | { ok: false; message: string };

// What these operations need from the Companion: where its settings live, which drives to look
// at, and how to reach the server (tests replace them).
export type DriveContext = {
  configPath: string;
  driveRoots?: () => string[];
  isDriveRoot?: (value: string) => boolean;
  server?: () => { url: string; credential: string; companionId?: string } | null;
  log?: (message: string) => void;
};

const windowsDriveRoots = () => [..."BCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `${letter}:\\`);

// The paired credential the tray passes to the agent, or the shared token of older setups.
export function agentServer(): { url: string; credential: string; companionId?: string } | null {
  const url = process.env.SERVER_URL?.trim();
  if (!url) return null;
  const paired = process.env.VIDEOCAT_AGENT_CREDENTIAL?.trim();
  if (paired) return { url, credential: paired, companionId: process.env.VIDEOCAT_COMPANION_ID?.trim() || undefined };
  const shared = process.env.AGENT_TOKEN?.trim();
  return shared ? { url, credential: shared } : null;
}

export async function readMarkerAtRoot(root: string): Promise<DiskMarker | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, markerFileName), "utf8")) as Partial<DiskMarker>;
    if (parsed.schemaVersion !== 1 || !parsed.diskId || !parsed.diskName) return null;
    return {
      schemaVersion: 1,
      diskId: parsed.diskId,
      diskName: parsed.diskName,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      scanRoots: Array.isArray(parsed.scanRoots) && parsed.scanRoots.length > 0 ? parsed.scanRoots.map(normalizeScanRoot) : ["."],
      notes: parsed.notes
    };
  } catch {
    return null;
  }
}

export async function discoverAccessibleDrives(context: Pick<DriveContext, "driveRoots">): Promise<AvailableDrive[]> {
  const drives: AvailableDrive[] = [];
  for (const root of (context.driveRoots ?? windowsDriveRoots)()) {
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
      // Not mounted.
    }
  }
  return drives;
}

// Drives with a marker that are not ignored (COMPANION_DISABLED_DISK_IDS).
export async function discoverMountedMarkers(context: DriveContext): Promise<Array<{ root: string; marker: DiskMarker }>> {
  const config = await currentConfig(context.configPath);
  const disabled = new Set(config.COMPANION_DISABLED_DISK_IDS.split(",").map((item) => item.trim()).filter(Boolean));
  const disks: Array<{ root: string; marker: DiskMarker }> = [];
  for (const drive of await discoverAccessibleDrives(context)) {
    if (!drive.diskId || disabled.has(drive.diskId)) continue;
    const marker = await readMarkerAtRoot(drive.root);
    if (marker) disks.push({ root: drive.root, marker });
  }
  return disks;
}

async function currentConfig(configPath: string) {
  return configFrom((await readEnvFile(configPath)) ?? {});
}

function sameRoot(a: string, b: string): boolean {
  return normalizeTargetPath(a).toLowerCase() === normalizeTargetPath(b).toLowerCase();
}

// Routes added by hand for a whole drive (older builds) follow a letter instead of a marker.
async function manualDriveTarget(context: DriveContext, targetId: string): Promise<CompanionTarget | null> {
  const target = parseTargets((await currentConfig(context.configPath)).COMPANION_MONITORED_TARGETS).find((item) => item.id === targetId);
  return target && (context.isDriveRoot ?? isDriveRoot)(target.path) ? target : null;
}

// The drive must be connected and still without a marker: a marker is another disk's identity.
async function unmarkedDrive(context: DriveContext, root: string): Promise<{ root: string } | { message: string }> {
  if (!(context.isDriveRoot ?? isDriveRoot)(root)) return { message: tl("Elige una unidad completa (por ejemplo H:\\).") };
  const drive = (await discoverAccessibleDrives(context)).find((item) => sameRoot(item.root, root));
  if (!drive) return { message: tl("No hay ninguna unidad conectada en {root}. Conéctala y vuelve a intentarlo.", { root }) };
  if (drive.diskId) return { message: tl("{root} ya es el disco VideoCAT «{name}».", { root: drive.root, name: drive.diskName ?? "" }) };
  return { root: drive.root };
}

async function fetchIdentitySample(context: DriveContext, diskId: string): Promise<{ diskName: string | null; totalFiles: number; files: IdentitySampleFile[] }> {
  const server = (context.server ?? agentServer)();
  if (!server?.url) throw new Error(tl("Configura la URL del servidor en Conexión para poder comprobar el disco."));
  if (!server.credential) throw new Error(tl("Empareja el Companion en Conexión para poder comprobar el disco."));
  const headers: Record<string, string> = { Authorization: `Bearer ${server.credential}` };
  if (server.companionId) headers["X-VideoCat-Companion-Id"] = server.companionId;

  const response = await fetch(
    `${normalizeServerUrl(server.url)}/api/agent/disks/${encodeURIComponent(diskId)}/identity-sample?limit=${identitySampleSize}`,
    { headers, signal: AbortSignal.timeout(20_000) }
  );
  if (response.status === 404) {
    throw new Error(tl("El servidor todavía no sabe comprobar discos. Actualiza VideoCAT en el servidor a la 0.2.45 o posterior."));
  }
  if (!response.ok) throw new Error(tl("El servidor respondió {status} al pedir la muestra del catálogo.", { status: response.status }));
  const body = await response.json() as { disk?: { name?: string } | null; totalFiles?: number; files?: unknown };
  const files = Array.isArray(body.files)
    ? body.files.filter((file): file is IdentitySampleFile => typeof file?.relativePath === "string" && typeof file?.sizeBytes === "number")
    : [];
  return { diskName: body.disk?.name ?? null, totalFiles: Number(body.totalFiles) || 0, files };
}

export async function checkDriveIdentity(context: DriveContext, targetId: string, root: string): Promise<IdentityCheckResult> {
  const target = await manualDriveTarget(context, targetId);
  if (!target) return { ok: false, message: tl("Esa ruta ya no está guardada como unidad. Guarda los cambios y vuelve a intentarlo.") };
  const drive = await unmarkedDrive(context, root);
  if ("message" in drive) return { ok: false, message: drive.message };
  try {
    const sample = await fetchIdentitySample(context, target.id);
    const check = await checkIdentitySample(drive.root, sample.files, sample.totalFiles);
    return { ok: true, root: drive.root, diskName: sample.diskName, check };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// After a marker is written at a root, no route by letter may point there: the one that became
// the marker is removed and any other is paused, so the drive is never scanned under two disks.
async function retireLetterRoutes(context: DriveContext, root: string, becameMarker: string | null): Promise<string[]> {
  const config = await currentConfig(context.configPath);
  const targets = parseTargets(config.COMPANION_MONITORED_TARGETS);
  const paused: string[] = [];
  const next = targets.flatMap((target) => {
    if (target.id === becameMarker) return [];
    if ((context.isDriveRoot ?? isDriveRoot)(target.path) && sameRoot(target.path, root) && target.enabled !== false) {
      paused.push(target.id);
      return [{ ...target, enabled: false }];
    }
    return [target];
  });
  if (next.length !== targets.length || paused.length > 0) {
    await writeConfig(context.configPath, normalizeConfig({ ...config, COMPANION_MONITORED_TARGETS: serializeTargets(next) }));
  }
  return paused;
}

export async function pinDriveIdentity(context: DriveContext, input: { targetId: string; root: string; name: string; acceptMixed?: boolean }): Promise<MarkerResult> {
  const name = cleanDiskName(input.name);
  if (!name) return { ok: false, message: tl("Escribe un nombre para el disco (hasta 80 caracteres).") };
  // Checked again here: the window's answer may be old, and the drive may have changed since.
  const result = await checkDriveIdentity(context, String(input.targetId), String(input.root));
  if (!result.ok) return result;
  const { verdict } = result.check;
  if (verdict === "mismatch") return { ok: false, message: tl("Esta unidad no tiene los archivos de ese catálogo. Créale un disco nuevo.") };
  if (verdict === "mixed" && !input.acceptMixed) return { ok: false, message: tl("El catálogo está mezclado: confirma que esta es la unidad original.") };
  try {
    const marker = await createDiskMarker(result.root, { diskId: String(input.targetId), diskName: name });
    context.log?.(tl("{root} ahora es el disco VideoCAT «{name}» y conserva su catálogo ({matched} de {checked} archivos de la muestra presentes).", {
      root: result.root, name: marker.diskName, matched: result.check.matched, checked: result.check.checked
    }));
    const paused = await retireLetterRoutes(context, result.root, marker.diskId);
    return { ok: true, root: result.root, diskId: marker.diskId, diskName: marker.diskName, removedTargetId: marker.diskId, pausedTargetIds: paused };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function convertDrive(context: DriveContext, input: { root: string; name: string }): Promise<MarkerResult> {
  const name = cleanDiskName(input.name);
  if (!name) return { ok: false, message: tl("Escribe un nombre para el disco (hasta 80 caracteres).") };
  const drive = await unmarkedDrive(context, String(input.root));
  if ("message" in drive) return { ok: false, message: drive.message };
  try {
    const marker = await createDiskMarker(drive.root, { diskId: randomUUID(), diskName: name });
    context.log?.(tl("{root} ahora es el disco VideoCAT «{name}» ({diskId}).", { root: drive.root, name: marker.diskName, diskId: marker.diskId }));
    const paused = await retireLetterRoutes(context, drive.root, null);
    return { ok: true, root: drive.root, diskId: marker.diskId, diskName: marker.diskName, removedTargetId: null, pausedTargetIds: paused };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
