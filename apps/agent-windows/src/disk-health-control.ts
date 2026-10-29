import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { tl } from "./agent-language.js";
import { healthTaskInstalled, readCollectedHealth, runHealthTask } from "./disk-health.js";

// Turning drive health (SMART) on and off, see disk-health.ts and smart/smart-setup.ps1. smartctl
// and the scripts travel in the Companion's resources/smartmontools, which the tray passes as
// VIDEOCAT_SMART_TOOLS_DIR; the setup script runs elevated, the one moment Windows asks for
// administrator permission.

export type HealthStatus = { supported: boolean; installed: boolean; administrator: boolean; lastCheckedAt: string | null };
export type HealthResult = { ok: true; message: string } | { ok: false; message: string };

const cancelledExitCode = 1223;

function smartToolsDir(): string | null {
  return process.env.VIDEOCAT_SMART_TOOLS_DIR?.trim() || null;
}

function runQuiet(command: string, args: string[], timeout = 15_000): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout }, (error, stdout) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? Number((error as { code?: unknown }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });
}

async function windowsUser(): Promise<{ sid: string | null; administrator: boolean }> {
  const user = await runQuiet("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = /"(S-1-5-21-[\d-]+)"/.exec(user.stdout)?.[1] ?? null;
  // Listed even while UAC keeps the token filtered ("deny only"): what matters is that the
  // account can be elevated.
  const groups = await runQuiet("whoami.exe", ["/groups", "/fo", "csv", "/nh"]);
  return { sid, administrator: groups.stdout.includes("S-1-5-32-544") };
}

export async function healthStatus(): Promise<HealthStatus> {
  if (process.platform !== "win32") return { supported: false, installed: false, administrator: false, lastCheckedAt: null };
  const [installed, user, collected] = await Promise.all([healthTaskInstalled(), windowsUser(), readCollectedHealth()]);
  return { supported: true, installed, administrator: user.administrator, lastCheckedAt: collected?.collectedAt ?? null };
}

// smart-setup.ps1 writes nothing outside its protected folders: its exit code says what failed.
function setupError(code: number): string {
  if (code === 10) return tl("no se pudo identificar tu usuario de Windows");
  if (code === 11) return tl("smartctl.exe no es la versión que trae VideoCAT; reinstala o actualiza el Companion");
  if (code === 12) return tl("Windows no aceptó la tarea programada");
  if (code === 13) return tl("Windows no aceptó los permisos de la tarea programada");
  return "";
}

// Runs smart-setup.ps1 elevated and waits for it.
async function runHealthSetup(args: string): Promise<{ code: number; detail: string }> {
  const source = smartToolsDir();
  const setup = source ? path.join(source, "smart-setup.ps1") : "";
  if (!source || !existsSync(setup) || !existsSync(path.join(source, "smartctl.exe"))) {
    return { code: -1, detail: tl("Este Companion no trae smartctl; actualízalo.") };
  }
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // Windows paths cannot contain double quotes, so quoting each one is enough; the whole line goes
  // to PowerShell as a single-quoted literal.
  const elevatedArgs = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${setup}" ${args}`.replace(/'/g, "''");
  const command = [
    "try {",
    `  $process = Start-Process -FilePath '${powershell.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${elevatedArgs}'`,
    "  exit $process.ExitCode",
    `} catch { exit ${cancelledExitCode} }`
  ].join("\n");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = await runQuiet(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], 5 * 60_000);
  return { code: result.code, detail: setupError(result.code) };
}

export async function enableHealth(): Promise<HealthResult> {
  if (process.platform !== "win32") return { ok: false, message: tl("Solo disponible en Windows.") };
  const user = await windowsUser();
  if (!user.administrator) return { ok: false, message: tl("Tu usuario de Windows no es administrador: la salud de discos necesita una cuenta que pueda serlo.") };
  if (!user.sid) return { ok: false, message: tl("No se pudo identificar tu usuario de Windows.") };
  const result = await runHealthSetup(`-Source "${smartToolsDir()}" -UserSid ${user.sid}`);
  if (result.code === cancelledExitCode) return { ok: false, message: tl("Se canceló el permiso de Windows; la salud de discos sigue desactivada.") };
  if (result.code !== 0) return { ok: false, message: result.detail ? tl("No se pudo activar la salud de discos: {detail}", { detail: result.detail }) : tl("No se pudo activar la salud de discos (código {code}).", { code: result.code }) };
  await runHealthTask();
  return { ok: true, message: tl("Salud de discos activada. La primera revisión llega a VideoCAT en un minuto.") };
}

export async function disableHealth(): Promise<HealthResult> {
  if (process.platform !== "win32") return { ok: false, message: tl("Solo disponible en Windows.") };
  const result = await runHealthSetup("-Remove");
  if (result.code === cancelledExitCode) return { ok: false, message: tl("Se canceló el permiso de Windows; la salud de discos sigue activa.") };
  if (result.code !== 0) return { ok: false, message: result.detail ? tl("No se pudo desactivar: {detail}", { detail: result.detail }) : tl("No se pudo desactivar (código {code}).", { code: result.code }) };
  return { ok: true, message: tl("Salud de discos desactivada: se quitaron la tarea y smartctl de Program Files.") };
}

export async function checkHealthNow(): Promise<HealthResult> {
  return (await runHealthTask())
    ? { ok: true, message: tl("Revisión iniciada. El resultado llega a VideoCAT en un minuto.") }
    : { ok: false, message: tl("No se pudo iniciar la revisión: activa la salud de discos otra vez.") };
}
