import fs from "node:fs/promises";
import path from "node:path";
import { isVideoExtension } from "@videocat/shared";

export function safeName(value: string): string {
  const cleaned = value.replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "VideoCAT";
}

async function existingPath(value: string): Promise<"file" | "directory" | null> {
  try {
    const stat = await fs.stat(value);
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return null;
  } catch {
    return null;
  }
}

// The name comes from the server: only a video lands in the downloads folder, never a program or a
// script that Windows would run with a double click.
export async function uniqueDestinationPath(baseDir: string, diskName: string, filename: string): Promise<string> {
  const parsed = path.parse(filename);
  const ext = parsed.ext || "";
  if (!isVideoExtension(ext)) throw new Error(`Solo se descargan videos: «${ext || "sin extensión"}» no es una extensión de video.`);
  const diskDir = path.join(baseDir, safeName(diskName));
  await fs.mkdir(diskDir, { recursive: true });
  const baseName = safeName(parsed.name).slice(0, 90) || "video";

  for (let index = 0; index < 1000; index += 1) {
    const candidate = path.join(diskDir, index === 0 ? `${baseName}${ext}` : `${baseName}-${index + 1}${ext}`);
    if (!await existingPath(candidate)) return candidate;
  }

  return path.join(diskDir, `${baseName}-${Date.now()}${ext}`);
}

export function copyHasStalled(lastProgressAt: number, now: number, stallMs: number): boolean {
  return now - lastProgressAt >= stallMs;
}
