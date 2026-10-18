// Packs the Companion agent (dist/index.js) as one executable: Node's single executable
// application (SEA). The Tauri tray starts it instead of Electron running in Node mode.
//   node scripts/build-agent-sea.mjs [outputDir]
// Needs the agent built first (npm run build -w @videocat/agent-windows).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] ?? path.join(root, "release", "agent-sea"));
const windows = process.platform === "win32";
const executable = path.join(output, windows ? "videocat-agent.exe" : "videocat-agent");
const bundle = path.join(output, "agent.cjs");
const blob = path.join(output, "agent.blob");
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit", shell: windows });
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

// One CommonJS file with every dependency (zod, @videocat/shared): what SEA can run.
run("npx", [
  "--yes", "esbuild@0.28.2",
  path.join(root, "dist", "index.js"),
  "--bundle", "--platform=node", "--target=node24", "--format=cjs",
  "--legal-comments=none",
  `--outfile=${bundle}`
]);

fs.writeFileSync(path.join(output, "sea-config.json"), JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true
}, null, 2));
run(process.execPath, ["--experimental-sea-config", path.join(output, "sea-config.json")]);

fs.copyFileSync(process.execPath, executable);
// The copied node.exe carries Node's signature, which the injection invalidates: drop it first.
if (windows) {
  try {
    run("signtool", ["remove", "/s", executable]);
  } catch {
    console.warn("signtool is not available; the executable keeps an invalid Node signature.");
  }
}
run("npx", ["--yes", "postject@1.0.0-alpha.6", executable, "NODE_SEA_BLOB", blob, "--sentinel-fuse", fuse]);

fs.rmSync(blob, { force: true });
const size = fs.statSync(executable).size;
console.log(`Agent executable: ${executable} (${(size / 1048576).toFixed(1)} MB)`);
