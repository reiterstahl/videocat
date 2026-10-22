import fs from "node:fs/promises";
import path from "node:path";
import { canonicalPathInsideRoot } from "./path-security.js";

// A drive is followed by the .videocat-disk.json at its root, never by its letter: Windows can
// hand the same letter to another drive, and a drive followed by letter then takes its catalog.

export const markerFileName = ".videocat-disk.json";
export const identitySampleSize = 30;

export type DiskMarker = {
  schemaVersion: 1;
  diskId: string;
  diskName: string;
  createdAt: string;
  scanRoots: string[];
  notes?: string;
};

export type IdentitySampleFile = {
  relativePath: string;
  sizeBytes: number;
};

// empty: the catalog has no files of that disk yet; match: this drive holds them;
// mixed: it holds part of them (the catalog took files from another drive with the same letter);
// mismatch: it is another drive.
export type IdentityVerdict = "empty" | "match" | "mixed" | "mismatch";

export type IdentityCheck = {
  verdict: IdentityVerdict;
  checked: number;
  matched: number;
  totalFiles: number;
};

// Same rule as the server's agentDiskIdentifierSchema.
const diskIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isDriveRoot(value: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(value.trim());
}

export function cleanDiskName(value: unknown): string | null {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}

export function identityVerdict(matched: number, checked: number): IdentityVerdict {
  if (checked === 0) return "empty";
  const ratio = matched / checked;
  if (ratio >= 0.8) return "match";
  if (ratio >= 0.2) return "mixed";
  return "mismatch";
}

// A sampled file counts when it is at the same relative path, inside the root, with the same size.
export async function checkIdentitySample(root: string, files: IdentitySampleFile[], totalFiles: number): Promise<IdentityCheck> {
  let matched = 0;
  for (const file of files) {
    const target = await canonicalPathInsideRoot(root, file.relativePath);
    if (!target) continue;
    try {
      const stats = await fs.stat(target);
      if (stats.isFile() && stats.size === file.sizeBytes) matched += 1;
    } catch {
      // Missing or unreadable: it does not count as a match.
    }
  }
  return { verdict: identityVerdict(matched, files.length), checked: files.length, matched, totalFiles };
}

// Writes a new marker and never replaces one: an existing marker is another disk's identity.
export async function createDiskMarker(
  root: string,
  input: { diskId: string; diskName: string },
  now = new Date()
): Promise<DiskMarker> {
  if (!diskIdPattern.test(input.diskId)) throw new Error("El identificador del disco no es válido.");
  const diskName = cleanDiskName(input.diskName);
  if (!diskName) throw new Error("Escribe un nombre para el disco (hasta 80 caracteres).");

  const marker: DiskMarker = {
    schemaVersion: 1,
    diskId: input.diskId,
    diskName,
    createdAt: now.toISOString(),
    scanRoots: ["."]
  };
  const destination = path.join(root, markerFileName);
  try {
    await fs.writeFile(destination, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new Error(`Ya existe ${markerFileName} en ${root}. No lo sobrescribo.`);
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      throw new Error(`No se pudo escribir en ${root} (${code}). Revisa que la unidad no esté protegida contra escritura.`);
    }
    throw new Error(`No se pudo escribir ${markerFileName} en ${root}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Read it back: a marker that does not parse would leave the drive without identity.
  const written = JSON.parse(await fs.readFile(destination, "utf8")) as Partial<DiskMarker>;
  if (written.diskId !== marker.diskId || written.diskName !== marker.diskName) {
    throw new Error(`${markerFileName} en ${root} no quedó como se escribió.`);
  }
  return marker;
}

// The name chosen in the web goes into the marker, so the drive carries it everywhere. Only
// diskName changes; the rest of the file (identity, scan roots, notes) is kept as it is.
export async function renameDiskMarker(
  root: string,
  diskId: string,
  name: string
): Promise<{ changed: false } | { changed: true; previous: string; next: string }> {
  const next = cleanDiskName(name);
  if (!next) throw new Error("El nombre del disco no es válido.");
  const destination = path.join(root, markerFileName);
  const current = JSON.parse(await fs.readFile(destination, "utf8")) as Record<string, unknown>;
  // The drive may have changed since it was discovered: never rename another disk.
  if (current.schemaVersion !== 1 || current.diskId !== diskId) {
    throw new Error(`${markerFileName} en ${root} ya no es el del disco ${diskId}.`);
  }
  const previous = String(current.diskName ?? "");
  if (previous === next) return { changed: false };

  // Written aside and renamed over the marker: a power cut leaves the old marker or the new
  // one, never half a file (a drive with a broken marker loses its identity).
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ ...current, diskName: next }, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return { changed: true, previous, next };
}
