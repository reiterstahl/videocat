import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const minimums = new Map([[22, [23, 4]], [24, [22, 1]], [26, [12, 1]]]);

export function isPatchedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
  const minimum = minimums.get(major);
  return Boolean(minimum) && (minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1]));
}

export function assertPatchedNode(version, label) {
  if (!isPatchedNode(version)) {
    throw new Error(`${label} uses Node ${version}. Packaging requires Node 22.23.4, 24.22.1 or 26.12.1 (or a later patch in those branches). See https://nodejs.org/en/blog/vulnerability/october-2026-security-releases`);
  }
}

// The agent executable (Node SEA) that installed Companions run: scans, tunnel, uploads, deletions
// and the local listener all run on its Node, so it must always be patched.
export function agentNodeVersion(executable) {
  const result = spawnSync(executable, ["runtime"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot run the agent executable ${executable}: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout.trim()).node;
}

if (process.argv[2] === "--agent") {
  const executable = process.argv[3];
  if (!executable) throw new Error("Usage: check-node-security.mjs --agent <videocat-agent executable>");
  const version = agentNodeVersion(executable);
  assertPatchedNode(`v${version}`, "The agent executable");
  console.log(`The agent executable runs Node ${version}, which contains the October 2026 fixes.`);
} else if (process.argv[2] === "--electron") {
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
  const electronNode = result.stdout.trim();
  assertPatchedNode(electronNode, "Electron");
  console.log(`Electron's embedded Node ${electronNode} contains the October 2026 fixes.`);
} else if (process.argv[2] === "--host") {
  assertPatchedNode(process.versions.node, "SEA build runtime");
  console.log(`Node ${process.versions.node} contains the October 2026 fixes.`);
}
