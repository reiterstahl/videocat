// Moves catalogued files source drive -> local staging folder -> destination folder.
// Invariant: a file is only removed from a place after a verified copy (SHA-256, re-read from
// disk) exists somewhere else and the server has recorded that step. Every step can be
// re-run after a crash: the server state plus what is on disk tell where to continue.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { validateDeletionMetadata } from "./deletion-identity.js";
import { canonicalPathInsideRoot, cleanRelativePath, safePathInsideRoot } from "./path-security.js";

export type TransferState =
  | "pending" | "staging" | "staged" | "source_removed" | "blocked_space"
  | "delivering" | "delivered" | "done" | "duplicate" | "cancelled";

export type TransferDisk = { diskId: string; identifiers: string[]; name: string };

export type TransferWorkItem = {
  id: string;
  jobId: string;
  state: TransferState;
  filename: string;
  sizeBytes: number;
  sha256: string | null;
  source: TransferDisk & { relativePath: string; modifiedAt: string | null };
  target: TransferDisk & { folder: string; relativePath: string | null };
  // The server asks to stop once the file is off its drive: other files leave theirs first and the
  // delivery comes in a later round. Older servers never send it.
  stopAt?: "source_removed";
};

export type TransitionExtra = { sha256?: string; targetRelativePath?: string; absolutePath?: string; error?: string };
export type TransitionResult = "ok" | "path_taken" | "conflict";

export type TransferContext = {
  stagingDir: string;
  transition: (item: TransferWorkItem, to: TransferState, extra?: TransitionExtra) => Promise<TransitionResult>;
  // Root of a mounted drive matching any of the identifiers, or null when it is not connected.
  resolveRoot: (identifiers: string[]) => string | null;
  freeSpace?: (directory: string) => Promise<{ freeBytes: number; totalBytes: number }>;
  log?: (level: "info" | "warn", message: string) => void;
  // What is being done right now, for the activity indicator (called often; the receiver throttles).
  progress?: (update: TransferProgressUpdate) => void;
  // Test hook: throwing here simulates the Companion stopping right at that point.
  checkpoint?: (name: string, item: TransferWorkItem) => Promise<void> | void;
};

export type TransferProgressPhase = "staging" | "verifying_staging" | "delivering" | "verifying_target";

export type TransferProgressUpdate = {
  item: TransferWorkItem;
  phase: TransferProgressPhase;
  bytesDone: number;
  bytesTotal: number;
};

export const stagingReserveRatio = 0.05;
export const destinationMarginBytes = 256 * 1024 * 1024;
const partSuffix = ".vcpart";

// Bytes processed so far out of the file size, for the activity indicator.
export type ByteProgress = (bytesDone: number) => void;

export async function hashFile(filePath: string, onProgress?: ByteProgress): Promise<string> {
  const hash = createHash("sha256");
  let done = 0;
  await pipeline(createReadStream(filePath), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk as Buffer);
      done += (chunk as Buffer).length;
      onProgress?.(done);
    }
  });
  return hash.digest("hex");
}

// Copies to "<destination>.vcpart" while hashing, flushes it to disk, renames it into place and
// reads the result back. Returns the SHA-256 of the source bytes.
export async function copyVerified(
  source: string,
  destination: string,
  onProgress?: (phase: "copy" | "verify", bytesDone: number) => void
): Promise<string> {
  const part = `${destination}${partSuffix}`;
  await fs.rm(part, { force: true });
  const hash = createHash("sha256");
  let copied = 0;
  try {
    await pipeline(
      createReadStream(source),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          copied += chunk.length;
          onProgress?.("copy", copied);
          callback(null, chunk);
        }
      }),
      createWriteStream(part, { flags: "wx" })
    );
    const handle = await fs.open(part, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const digest = hash.digest("hex");
    await fs.rename(part, destination);
    const reread = await hashFile(destination, onProgress ? (done) => onProgress("verify", done) : undefined);
    if (reread !== digest) {
      await fs.rm(destination, { force: true });
      throw new Error("la copia no coincide con el original al releerla");
    }
    return digest;
  } catch (error) {
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function statfsSpace(directory: string): Promise<{ freeBytes: number; totalBytes: number }> {
  const stats = await fs.statfs(directory);
  return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
}

export function stagingPathFor(stagingDir: string, item: Pick<TransferWorkItem, "id" | "filename">): string {
  const extension = path.extname(item.filename).replace(/[^.\w-]/g, "").slice(0, 16);
  return path.join(stagingDir, `${item.id}${extension}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function candidateName(filename: string, attempt: number): string {
  if (attempt <= 1) return filename;
  const extension = path.extname(filename);
  return `${filename.slice(0, filename.length - extension.length)} (${attempt})${extension}`;
}

function formatGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

// Runs every step that is possible right now for one item and returns the state it ended in.
export async function processTransferItem(context: TransferContext, workItem: TransferWorkItem): Promise<TransferState> {
  const item = { ...workItem };
  const log = context.log ?? (() => undefined);
  const space = context.freeSpace ?? statfsSpace;
  const checkpoint = async (name: string) => context.checkpoint?.(name, item);
  const staging = stagingPathFor(context.stagingDir, item);
  let stagingVerified = false;

  const move = async (to: TransferState, extra?: TransitionExtra): Promise<boolean> => {
    const result = await context.transition(item, to, extra);
    if (result !== "ok") return false;
    item.state = to;
    if (extra?.sha256) item.sha256 = extra.sha256;
    if (extra?.targetRelativePath) item.target = { ...item.target, relativePath: extra.targetRelativePath };
    return true;
  };

  const sourcePath = async (): Promise<string | null> => {
    const root = context.resolveRoot(item.source.identifiers);
    if (!root) return null;
    if (!safePathInsideRoot(root, item.source.relativePath)) throw new Error(`ruta de origen insegura: ${item.source.relativePath}`);
    return canonicalPathInsideRoot(root, item.source.relativePath);
  };

  const sourceMatches = async (filePath: string): Promise<string | null> => {
    const stats = await fs.stat(filePath);
    const identity = validateDeletionMetadata({ sizeBytes: item.sizeBytes, modifiedAt: item.source.modifiedAt }, { sizeBytes: stats.size, modifiedAtMs: stats.mtimeMs });
    return identity.ok ? null : identity.reason;
  };

  for (let guard = 0; guard < 12; guard += 1) {
    switch (item.state) {
      case "pending": {
        const root = context.resolveRoot(item.source.identifiers);
        if (!root) return item.state;
        const source = await sourcePath();
        if (!source) {
          await move("pending", { error: "El archivo no está en el disco de origen conectado." });
          return item.state;
        }
        const changed = await sourceMatches(source);
        if (changed) {
          await move("pending", { error: `El archivo cambió desde el último escaneo (${changed}); vuelve a escanear el disco.` });
          return item.state;
        }
        await fs.mkdir(context.stagingDir, { recursive: true });
        const local = await space(context.stagingDir);
        if (local.freeBytes - item.sizeBytes < local.totalBytes * stagingReserveRatio) {
          log("warn", `Carpeta temporal sin espacio para ${item.filename}: hay que dejar libre el 5 % del disco local.`);
          await move("pending", { error: "La carpeta temporal no tiene espacio (se reserva el 5 % del disco local)." });
          return item.state;
        }
        if (!(await move("staging"))) return item.state;
        break;
      }

      case "staging": {
        const source = await sourcePath();
        if (!source) return item.state;
        await fs.rm(staging, { force: true });
        const before = await sourceMatches(source);
        if (before) {
          await move("pending", { error: `El archivo cambió desde el último escaneo (${before}).` });
          return item.state;
        }
        let digest: string;
        try {
          log("info", `Copiando ${item.filename} a la carpeta temporal.`);
          digest = await copyVerified(source, staging, (phase, done) =>
            context.progress?.({ item, phase: phase === "copy" ? "staging" : "verifying_staging", bytesDone: done, bytesTotal: item.sizeBytes }));
        } catch (error) {
          await fs.rm(staging, { force: true });
          await move("pending", { error: `No se pudo copiar a la carpeta temporal: ${error instanceof Error ? error.message : String(error)}` });
          return item.state;
        }
        await checkpoint("staging:copied");
        const after = await sourceMatches(source);
        if (after) {
          await fs.rm(staging, { force: true });
          await move("pending", { error: `El archivo cambió mientras se copiaba (${after}).` });
          return item.state;
        }
        stagingVerified = true;
        if (!(await move("staged", { sha256: digest }))) return item.state;
        await checkpoint("staged:reported");
        break;
      }

      case "staged": {
        // The staging copy must be verified before the source may go.
        const stagingOk = item.sha256 !== null && (stagingVerified || ((await exists(staging)) && (await hashFile(staging, (done) =>
          context.progress?.({ item, phase: "verifying_staging", bytesDone: done, bytesTotal: item.sizeBytes }))) === item.sha256));
        const root = context.resolveRoot(item.source.identifiers);
        if (!root) return item.state;
        const source = await sourcePath();
        if (!stagingOk) {
          if (source) {
            await fs.rm(staging, { force: true });
            await move("pending", { error: "La copia temporal no superó la verificación; se repetirá." });
          } else {
            log("warn", `ATENCIÓN: ${item.filename} no tiene copia temporal válida ni archivo de origen. No se toca nada.`);
          }
          return item.state;
        }
        stagingVerified = true;
        if (source) {
          const changed = await sourceMatches(source);
          if (changed) {
            await fs.rm(staging, { force: true });
            await move("pending", { error: `El archivo de origen cambió (${changed}); se descartó la copia temporal.` });
            return item.state;
          }
          await fs.rm(source);
          log("info", `${item.filename} quedó a salvo en la carpeta temporal y se quitó de ${item.source.name}.`);
        }
        await checkpoint("source:removed");
        if (!(await move("source_removed"))) return item.state;
        if (item.stopAt === "source_removed") return item.state;
        break;
      }

      case "source_removed":
      case "blocked_space": {
        const root = context.resolveRoot(item.target.identifiers);
        if (!root) return item.state;
        if (!item.sha256 || !(await exists(staging))) {
          log("warn", `ATENCIÓN: falta la copia temporal de ${item.filename}. No se toca nada.`);
          return item.state;
        }
        const folderRelative = cleanRelativePath(item.target.folder);
        const folder = folderRelative ? safePathInsideRoot(root, folderRelative) : null;
        if (!folderRelative || !folder) throw new Error(`carpeta de destino insegura: ${item.target.folder}`);
        await fs.mkdir(folder, { recursive: true });
        if (!(await canonicalPathInsideRoot(root, folderRelative))) throw new Error(`la carpeta de destino sale del disco: ${item.target.folder}`);

        const target = await space(folder);
        if (target.freeBytes - item.sizeBytes < destinationMarginBytes) {
          const missing = item.sizeBytes + destinationMarginBytes - target.freeBytes;
          await move("blocked_space", { error: `Faltan ${formatGb(missing)} libres en ${item.target.name}.` });
          return item.state;
        }

        let chosen: string | null = null;
        for (let attempt = 1; attempt < 1000 && !chosen; attempt += 1) {
          const name = candidateName(item.filename, attempt);
          const candidate = path.join(folder, name);
          if (await exists(candidate)) {
            if ((await fs.stat(candidate)).size === item.sizeBytes && (await hashFile(candidate)) === item.sha256) {
              // Identical file already there: nothing to copy, the staging copy can go.
              if (!(await move("duplicate"))) return item.state;
              await fs.rm(staging, { force: true });
              log("info", `${item.filename} ya existía idéntico en ${item.target.name}; se descartó la copia temporal.`);
              return item.state;
            }
            continue;
          }
          const relative = `${folderRelative}/${name}`;
          const result = await context.transition(item, "delivering", { targetRelativePath: relative });
          if (result === "path_taken") continue;
          if (result !== "ok") return item.state;
          item.state = "delivering";
          item.target = { ...item.target, relativePath: relative };
          chosen = relative;
        }
        if (!chosen) throw new Error("no se encontró un nombre libre en la carpeta de destino");
        await checkpoint("delivering:reported");
        break;
      }

      case "delivering": {
        const root = context.resolveRoot(item.target.identifiers);
        if (!root) return item.state;
        const relative = item.target.relativePath ? cleanRelativePath(item.target.relativePath) : null;
        const destination = relative ? safePathInsideRoot(root, relative) : null;
        if (!relative || !destination || !item.sha256) throw new Error("destino del traslado no válido");
        await fs.rm(`${destination}${partSuffix}`, { force: true });
        if (await exists(destination)) {
          // A previous run may have finished the copy before stopping; anything else is not ours.
          if ((await hashFile(destination)) !== item.sha256) {
            await move("source_removed", { error: "El nombre elegido en el destino ya está ocupado; se elegirá otro." });
            break;
          }
        } else {
          try {
            log("info", `Llevando ${item.filename} a ${item.target.name}.`);
            const digest = await copyVerified(staging, destination, (phase, done) =>
              context.progress?.({ item, phase: phase === "copy" ? "delivering" : "verifying_target", bytesDone: done, bytesTotal: item.sizeBytes }));
            if (digest !== item.sha256) {
              await fs.rm(destination, { force: true });
              throw new Error("la copia temporal ya no coincide con el original");
            }
          } catch (error) {
            await move("source_removed", { error: `No se pudo copiar al destino: ${error instanceof Error ? error.message : String(error)}` });
            return item.state;
          }
        }
        await checkpoint("target:copied");
        if (!(await move("delivered", { sha256: item.sha256, absolutePath: destination }))) return item.state;
        await checkpoint("delivered:reported");
        break;
      }

      case "delivered": {
        await fs.rm(staging, { force: true });
        await checkpoint("staging:removed");
        if (!(await move("done"))) return item.state;
        log("info", `${item.filename} llegó a ${item.target.name}.`);
        return item.state;
      }

      default:
        return item.state;
    }
  }
  return item.state;
}

// Staging files of transfers that already finished (the Companion stopped before deleting them).
export async function staleStagingFiles(stagingDir: string, lookup: (ids: string[]) => Promise<Map<string, TransferState>>): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(stagingDir);
  } catch {
    return [];
  }
  const byId = new Map<string, string>();
  for (const entry of entries) {
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[\w-]+)?$/i.exec(entry);
    if (match) byId.set(match[1].toLowerCase(), path.join(stagingDir, entry));
  }
  if (byId.size === 0) return [];
  const states = await lookup([...byId.keys()]);
  return [...byId.entries()]
    .filter(([id]) => {
      const state = states.get(id);
      return state === "done" || state === "duplicate" || state === "cancelled";
    })
    .map(([, filePath]) => filePath);
}
