import fs from "node:fs/promises";
import path from "node:path";
import { isVideoExtension } from "@videocat/shared";

export function cleanRelativePath(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

export function safePathInsideRoot(root: string, relativePathValue: string): string | null {
  const relative = cleanRelativePath(relativePathValue);
  if (!relative) return null;
  const rootResolved = path.resolve(root);
  const target = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(rootResolved, target);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return target;
}

export async function canonicalPathInsideRoot(root: string, relativePathValue: string): Promise<string | null> {
  const target = safePathInsideRoot(root, relativePathValue);
  if (!target) return null;

  try {
    const [canonicalRoot, canonicalTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    const fromRoot = path.relative(canonicalRoot, canonicalTarget);
    if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
    return canonicalTarget;
  } catch {
    return null;
  }
}

// The local actions a web page asks for: a folder can be opened, but only a video is opened or
// deleted. Opening hands the file to Windows, which would run a program or a script on the drive.
export function companionActionAllowed(action: "open-file" | "open-folder" | "delete-file", filePath: string): boolean {
  return action === "open-folder" || isVideoExtension(path.extname(filePath));
}
