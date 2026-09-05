import fs from "node:fs/promises";
import path from "node:path";

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

export async function uniqueDestinationPath(baseDir: string, diskName: string, filename: string): Promise<string> {
  const diskDir = path.join(baseDir, safeName(diskName));
  await fs.mkdir(diskDir, { recursive: true });
  const parsed = path.parse(filename);
  const baseName = safeName(parsed.name).slice(0, 90) || "video";
  const ext = parsed.ext || "";

  for (let index = 0; index < 1000; index += 1) {
    const candidate = path.join(diskDir, index === 0 ? `${baseName}${ext}` : `${baseName}-${index + 1}${ext}`);
    if (!await existingPath(candidate)) return candidate;
  }

  return path.join(diskDir, `${baseName}-${Date.now()}${ext}`);
}

export function copyHasStalled(lastProgressAt: number, now: number, stallMs: number): boolean {
  return now - lastProgressAt >= stallMs;
}
