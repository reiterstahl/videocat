import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

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

// The tray exception lasts only while no stable Electron release carries the fixes: once one
// does, packaging fails again until the Companion moves to it.
async function assertNoPatchedElectron() {
  const response = await fetch("https://releases.electronjs.org/releases.json", { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cannot list Electron releases (HTTP ${response.status}); the tray exception needs that list.`);
  const releases = await response.json();
  const patched = releases.find((release) => !release.version.includes("-") && isPatchedNode(`v${release.node}`));
  if (patched) {
    throw new Error(`Electron ${patched.version} embeds Node ${patched.node}, which contains the October 2026 fixes: update the Companion's electron dependency instead of using the tray exception.`);
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
  try {
    assertPatchedNode(electronNode, "Electron");
    console.log(`Electron's embedded Node ${electronNode} contains the October 2026 fixes.`);
  } catch (error) {
    // Only when release-companion.yml asks for it (a beta, or the input "tray_node_exception")
    // and no Electron release carries the fix yet: Electron keeps only the tray and its windows
    // (pairing and the drive identity check talk to the user's own server), and the agent, which
    // does the rest, must run on a patched Node.
    const agent = process.env.VIDEOCAT_TRAY_EXCEPTION_AGENT_EXECUTABLE;
    if (!agent) throw error;
    await assertNoPatchedElectron();
    const version = agentNodeVersion(agent);
    assertPatchedNode(`v${version}`, "The agent executable");
    console.warn(`::warning::Tray exception: Electron embeds Node ${electronNode} (tray and windows only, no Electron release has the fixes yet); the agent runs Node ${version}.`);
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `TRAY_EXCEPTION_ELECTRON_NODE=${electronNode}\n`);
  }
} else if (process.argv[2] === "--host") {
  assertPatchedNode(process.versions.node, "SEA build runtime");
  console.log(`Node ${process.versions.node} contains the October 2026 fixes.`);
}
