import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const thumbnailStorageHint = "Fix the volume owner (uid 1000) or redeploy with the thumbnails-init service from docker-compose.hub.yml.";

export function isStoragePermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}

// Returns null when the directory accepts writes, or a short reason otherwise.
export async function thumbnailStorageProblem(dir: string): Promise<string | null> {
  const probe = path.join(dir, `.write-probe-${randomUUID()}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, "");
    await fs.rm(probe, { force: true });
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    return `${code}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
