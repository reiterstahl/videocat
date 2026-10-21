import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const minimums = new Map([[22, [23, 4]], [24, [22, 1]], [26, [12, 1]]]);

export function assertPatchedNode(version, label) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
  const minimum = minimums.get(major);
  if (!minimum || minor < minimum[0] || (minor === minimum[0] && patch < minimum[1])) {
    throw new Error(`${label} uses Node ${version}. Packaging requires Node 22.23.4, 24.22.1 or 26.12.1 (or a later patch in those branches). See https://nodejs.org/en/blog/vulnerability/october-2026-security-releases`);
  }
}

if (process.argv[2] === "--electron") {
  const require = createRequire(import.meta.url);
  const executable = require("electron");
  const result = spawnSync(executable, ["-p", "process.versions.node"], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot verify Electron's embedded Node runtime: ${result.error?.message ?? result.stderr.trim()}`);
  }
  assertPatchedNode(result.stdout.trim(), "Electron");
  console.log(`Electron's embedded Node ${result.stdout.trim()} contains the October 2026 fixes.`);
} else if (process.argv[2] === "--host") {
  assertPatchedNode(process.versions.node, "SEA build runtime");
  console.log(`Node ${process.versions.node} contains the October 2026 fixes.`);
}
