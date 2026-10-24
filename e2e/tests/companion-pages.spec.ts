import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { configHtml, logHtml } from "../../apps/agent-windows/src/tray-pages";

// The Companion's windows in English, outside Electron: the pages with a stand-in for the bridge
// its preload exposes. Nothing the user reads may stay in Spanish; user data (drive names, the
// agent's own log lines) is not checked.
const spanish = /[áéíóúñ¿¡]|\b(de|del|la|las|los|el|que|para|con|sin|una|unidad|unidades|disco|discos|archivo|archivos|carpeta|ruta|rutas|guardar|abrir)\b/i;

async function leftovers(page: Page): Promise<string[]> {
  return page.evaluate((source) => {
    const pattern = new RegExp(source, "i");
    const found: string[] = [];
    const visible = (element: Element) => (element as HTMLElement).offsetParent !== null || element.tagName === "OPTION";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-no-i18n], code, script, style") || !visible(parent)) continue;
      const text = (node.nodeValue ?? "").trim();
      if (text && pattern.test(text)) found.push(text);
    }
    for (const element of document.querySelectorAll("[title], [placeholder], [aria-label]")) {
      if (element.closest("[data-no-i18n]")) continue;
      for (const name of ["title", "placeholder", "aria-label"]) {
        const value = element.getAttribute(name);
        if (value && pattern.test(value)) found.push(`${name}: ${value}`);
      }
    }
    return [...new Set(found)];
  }, spanish.source);
}

function pageFile(html: string, name: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "videocat-companion-")), name);
  fs.writeFileSync(file, html);
  return `file://${file}`;
}

test("the Companion's settings window shows nothing in Spanish when its language is English", async ({ page }) => {
  await page.addInitScript(() => {
    const ok = (message: string) => Promise.resolve({ ok: true, message });
    (window as unknown as { videocatConfig: Record<string, unknown> }).videocatConfig = {
      load: () => Promise.resolve({
        SERVER_URL: "http://192.168.1.10:8081",
        COMPANION_LANGUAGE: "en",
        COMPANION_MONITORED_TARGETS: JSON.stringify([
          { id: "letter", name: "Old drive", path: "H:\\", enabled: true },
          { id: "folder", name: "Videos", path: "D:\\Videos", enabled: true }
        ])
      }),
      listDrives: () => Promise.resolve([
        { root: "E:\\", diskId: "e", diskName: "WD Elements", totalBytes: 4e12, freeBytes: 1e12 },
        { root: "H:\\", totalBytes: 2e12, freeBytes: 5e11 },
        { root: "K:\\", totalBytes: 1e12, freeBytes: 2e11 }
      ]),
      checkIdentity: (_id: string, root: string) => Promise.resolve({ ok: true, root, diskName: null, check: { verdict: "mixed", checked: 30, matched: 12, totalFiles: 4210 } }),
      pairingStatus: () => Promise.resolve({ paired: true, companionId: "c1", serverUrl: "http://192.168.1.10:8081", issuedAt: "2026-10-01T00:00:00.000Z", encryptionAvailable: true }),
      healthStatus: () => Promise.resolve({ supported: true, installed: false, administrator: false, lastCheckedAt: null }),
      updateStatus: () => Promise.resolve({ installed: true, currentVersion: "0.2.23", readyVersion: null }),
      checkForUpdates: () => Promise.resolve({ installed: true, currentVersion: "0.2.23", readyVersion: "0.2.24" }),
      enableHealth: () => ok("Salud de discos activada. La primera revisión llega a VideoCAT en un minuto."),
      onUpdateReady: () => undefined,
      chooseFolder: () => Promise.resolve(null),
      save: () => Promise.resolve({ ok: true, path: "C:\\x\\.env" }),
      copyToken: () => Promise.resolve(true),
      close: () => undefined
    };
  });
  await page.goto(pageFile(configHtml("", "0.2.23", "en"), "settings.html"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const found = new Set<string>();
  const collect = async () => (await leftovers(page)).forEach((text) => found.add(text));
  for (const name of ["connection", "browser", "routes", "files", "advanced", "updates"]) {
    await page.locator(`[data-page-target="${name}"], [data-target="${name}"], [aria-controls="page-${name}"]`).first().click();
    await page.waitForTimeout(150);
    await collect();
    if (name === "routes") {
      await page.locator("#addDrive").click();
      await page.waitForTimeout(150);
      await collect();
      await page.getByRole("button", { name: "Pin identity…" }).first().click();
      await page.getByRole("button", { name: "Check", exact: true }).click();
      await expect(page.locator(".verdict")).toBeVisible();
      await collect();
    }
    if (name === "updates") {
      await page.locator("#checkUpdates").click();
      await page.waitForTimeout(150);
      await collect();
    }
  }
  expect([...found]).toEqual([]);
});

test("the Companion's activity window shows nothing in Spanish when its language is English", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { videocatLog: Record<string, unknown> }).videocatLog = {
      load: () => Promise.resolve([{ id: 1, timestamp: "2026-10-24T10:00:00.000Z", level: "info", source: "companion", message: "Escaneando E:\\ (línea del agente)" }]),
      onEntry: () => undefined,
      onCleared: () => undefined,
      clear: () => undefined,
      close: () => undefined
    };
  });
  await page.goto(pageFile(logHtml("0.2.23", "en"), "activity.html"));
  await expect(page.locator("#count")).toHaveText("1 event");
  expect(await leftovers(page)).toEqual([]);
});
