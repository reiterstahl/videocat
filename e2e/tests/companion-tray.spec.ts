import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, expect, test } from "@playwright/test";

// The Electron tray with the real agent (phase 1a of the move to Tauri): the settings window loads,
// is checked and saved by the agent through its tray API (tray-api.ts), and drive health and the
// drive list come from it too. Needs a display (CI runs the suite under xvfb-run) and the Companion
// built (npm run build and build:tray in apps/agent-windows).
const agentRoot = path.resolve("apps/agent-windows");
const ready = Boolean(process.env.DISPLAY) && fs.existsSync(path.join(agentRoot, "dist", "tray.js")) && process.platform === "linux";

test("the tray's settings window is read, checked and saved by the agent", async () => {
  test.skip(!ready, "Needs a display and the Companion built");
  test.setTimeout(120_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "videocat-tray-"));
  const app = await _electron.launch({
    args: ["--no-sandbox", "."],
    cwd: agentRoot,
    env: { ...process.env, HOME: home, VIDEOCAT_TRAY_OPEN: "settings", COMPANION_LANGUAGE: "es", ELECTRON_RUN_AS_NODE: "" }
  });
  try {
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
    const win = await app.firstWindow();
    // The agent answers: the browser token it generated shows up in the window.
    await expect.poll(() => win.locator("#companionToken").inputValue(), { timeout: 30_000 }).toMatch(/^.{16,}$/);

    await win.fill("input[name=SERVER_URL]", "http://127.0.0.1:9");
    await win.locator("details.legacy summary").click();
    await win.fill("input[name=AGENT_TOKEN]", "shared-token-for-test");
    await win.fill("input[name=COMPANION_NAME]", "Prueba Electron");
    await win.locator('[aria-controls="page-advanced"]').click();
    await win.fill("input[name=COMPANION_PORT]", "abc");
    await win.locator("button[type=submit]").click();
    await expect(win.locator("#status")).toContainText("COMPANION_PORT debe ser un numero entero", { timeout: 30_000 });

    await win.fill("input[name=COMPANION_PORT]", "");
    await win.locator("button[type=submit]").click();
    await expect(win.locator("#status")).toContainText("Configuración guardada", { timeout: 30_000 });
    const saved = fs.readFileSync(path.join(userData, ".env"), "utf8");
    expect(saved).toContain('COMPANION_NAME="Prueba Electron"');
    expect(saved).toContain("SERVER_URL=http://127.0.0.1:9");

    // The tray restarted the agent after saving; the window keeps working against the new one.
    await win.locator('[aria-controls="page-routes"]').click();
    await expect(win.locator("#healthText")).toHaveText("Solo disponible en Windows.", { timeout: 30_000 });
    await win.locator("#addDrive").click();
    await expect(win.locator("#status")).toContainText("No se detectaron unidades accesibles", { timeout: 30_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
