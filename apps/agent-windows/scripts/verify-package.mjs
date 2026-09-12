import fs from "node:fs";
import path from "node:path";
import { listPackage } from "@electron/asar";

const agentRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(agentRoot, "../..");
const archivePath = path.join(agentRoot, "release", "win-unpacked", "resources", "app.asar");

if (!fs.existsSync(archivePath)) {
  throw new Error(`Packaged Electron archive not found: ${archivePath}`);
}

const archiveEntries = new Set(listPackage(archivePath).map((entry) => entry.replace(/\\/g, "/")));
const pending = [
  { archive: "/dist/index.js", source: path.join(agentRoot, "dist", "index.js") },
  { archive: "/dist/tray.js", source: path.join(agentRoot, "dist", "tray.js") },
  { archive: "/dist/tray-preload.cjs", source: path.join(agentRoot, "dist", "tray-preload.cjs") },
  {
    archive: "/node_modules/@videocat/shared/dist/index.js",
    source: path.join(repositoryRoot, "packages", "shared", "dist", "index.js")
  }
];
const checked = new Set();
const localModulePattern = /(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;

while (pending.length > 0) {
  const current = pending.pop();
  if (!current || checked.has(current.archive)) continue;
  checked.add(current.archive);

  if (!fs.existsSync(current.source)) {
    throw new Error(`Compiled runtime module not found: ${current.source}`);
  }
  if (!archiveEntries.has(current.archive)) {
    throw new Error(`Runtime module missing from app.asar: ${current.archive}`);
  }

  const source = fs.readFileSync(current.source, "utf8");
  for (const match of source.matchAll(localModulePattern)) {
    const specifier = match[1] ?? match[2];
    const sourcePath = path.resolve(path.dirname(current.source), specifier);
    const archivePathForImport = path.posix.normalize(
      path.posix.join(path.posix.dirname(current.archive), specifier.replace(/\\/g, "/"))
    );
    pending.push({ archive: archivePathForImport, source: sourcePath });
  }
}

console.log(`Verified ${checked.size} runtime modules inside app.asar.`);
