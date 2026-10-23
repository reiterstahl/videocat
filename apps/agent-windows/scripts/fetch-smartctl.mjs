// Packs smartctl (smartmontools 7.5, GPL-2.0-or-later) for the drive health check: downloads the
// official Windows installer from the smartmontools GitHub release, checks it against the SHA-256
// pinned here (its GPG signature by the Smartmontools Signing Key was verified when pinning) and
// extracts smartctl.exe, its drive database and its license without running the installer, next
// to the two scripts that install and run the check (smart/*.ps1).
//   node scripts/fetch-smartctl.mjs [outputDir]
// Needs 7-Zip (7z on PATH, as on GitHub's Windows runners, or 7-Zip in Program Files).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const smartmontools = {
  version: "7.5",
  url: "https://github.com/smartmontools/smartmontools/releases/download/RELEASE_7_5/smartmontools-7.5.win32-setup.exe",
  installerSha256: "896337fcc253220614cf8cdbd5cf2321c5aa326a37a04160a672a281e6104c70",
  // Must match $smartctlSha256 in smart/smart-setup.ps1.
  smartctlSha256: "b5db94e5082c042be44994b7a4fa8f7b5c8e713b2ab1c9a560d8f7a7995ea27d",
  source: "https://github.com/smartmontools/smartmontools/releases/tag/RELEASE_7_5"
};

export const packedFiles = ["smartctl.exe", "drivedb.h", "COPYING.txt", "smart-setup.ps1", "smart-collect.ps1", "SOURCE.txt"];

export function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sevenZip() {
  const candidates = ["7z", path.join(process.env.ProgramFiles ?? "C:\\Program Files", "7-Zip", "7z.exe")];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["i"], { stdio: "ignore" });
      return candidate;
    } catch {
      // next
    }
  }
  throw new Error("7-Zip is needed to extract smartctl from the smartmontools installer (winget install 7zip.7zip).");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const output = path.resolve(process.argv[2] ?? path.join(root, "release", "smartmontools"));
  const smartctl = path.join(output, "smartctl.exe");
  if (fs.existsSync(smartctl) && sha256(smartctl) === smartmontools.smartctlSha256) {
    for (const script of ["smart-setup.ps1", "smart-collect.ps1"]) fs.copyFileSync(path.join(root, "smart", script), path.join(output, script));
    console.log(`smartctl ${smartmontools.version} already in ${output}; scripts refreshed.`);
    return;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "videocat-smartmontools-"));
  try {
    const installer = path.join(work, "smartmontools-setup.exe");
    const response = await fetch(smartmontools.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Downloading smartmontools failed: HTTP ${response.status}`);
    fs.writeFileSync(installer, Buffer.from(await response.arrayBuffer()));
    const installerHash = sha256(installer);
    if (installerHash !== smartmontools.installerSha256) {
      throw new Error(`The smartmontools installer does not match its pinned SHA-256 (${installerHash}).`);
    }

    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    execFileSync(sevenZip(), ["e", installer, "bin/smartctl.exe", "bin/drivedb.h", "doc/COPYING.txt", `-o${output}`, "-y"], { stdio: "ignore" });
    const extracted = sha256(smartctl);
    if (extracted !== smartmontools.smartctlSha256) throw new Error(`smartctl.exe does not match its pinned SHA-256 (${extracted}).`);
    for (const script of ["smart-setup.ps1", "smart-collect.ps1"]) fs.copyFileSync(path.join(root, "smart", script), path.join(output, script));
    fs.writeFileSync(path.join(output, "SOURCE.txt"), [
      `smartctl ${smartmontools.version} from smartmontools (https://www.smartmontools.org), GPL-2.0-or-later (COPYING.txt).`,
      `Unmodified binary from the official Windows installer. Source code: ${smartmontools.source}`,
      ""
    ].join("\r\n"));
    console.log(`smartctl ${smartmontools.version} ready in ${output}.`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
