import { expect, test, type Page } from "@playwright/test";
import { openView } from "./helpers";

// The Android app opens this page in a WebView and announces itself with window.VideoCatAndroid.
async function asAndroidApp(page: Page, capabilities: string[] = []) {
  await page.addInitScript((list) => {
    (window as unknown as { VideoCatAndroid: object }).VideoCatAndroid = { version: () => 1, capabilities: () => JSON.stringify(list) };
  }, capabilities);
}

// Chromecast turned on in the profile, without changing the saved profile.
async function withChromecastOn(page: Page) {
  await page.route("**/api/profile/security", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    try {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), chromecastEnabled: true } });
    } catch {
      // The page navigated away while this answer was on its way: nobody is waiting for it.
    }
  });
}

const castButton = (page: Page) => page.getByRole("button", { name: "Reproducir en Chromecast" });

test("in a browser the detail offers Chromecast when it is on", async ({ page }) => {
  await withChromecastOn(page);
  await openView(page, "/catalogo");
  await page.locator(".vc-card-open").first().click();
  await expect(page.locator(".vc-detail")).toBeVisible();
  await expect(castButton(page)).toBeVisible();
});

test("inside the Android app VideoCAT is already installed and Chromecast waits for the app to cast", async ({ page }) => {
  await asAndroidApp(page);
  await withChromecastOn(page);
  await openView(page, "/catalogo");
  await page.locator(".vc-card-open").first().click();
  await expect(page.locator(".vc-detail")).toBeVisible();
  await expect(castButton(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/perfil");
  const panel = page.locator("section.vc-panel", { has: page.locator("#profile-install-title") });
  await expect(panel.getByText("Estás usando VideoCAT como app instalada.")).toBeVisible();
});

test("Android's Back closes the detail first and then lets the app go back a section", async ({ page }) => {
  await asAndroidApp(page);
  await openView(page, "/catalogo");
  const back = () => page.evaluate(() => (window as unknown as { videocatAndroidBack: () => boolean }).videocatAndroidBack());
  await page.locator(".vc-card-open").first().click();
  await expect(page.locator(".vc-detail")).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.locator(".vc-detail")).toHaveCount(0);
  expect(await back()).toBe(false);
});

test("in a browser the page does not take over Back", async ({ page }) => {
  await openView(page, "/catalogo");
  expect(await page.evaluate(() => "videocatAndroidBack" in window)).toBe(false);
});

test("inside an app with its own settings, Perfil opens them", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { settings: 0 };
    (window as unknown as { settingsState: typeof state }).settingsState = state;
    (window as unknown as { VideoCatAndroid: object }).VideoCatAndroid = {
      version: () => 3,
      capabilities: () => '["play","settings"]',
      play: () => undefined,
      stop: () => undefined,
      openSettings: () => { state.settings += 1; }
    };
  });
  await page.goto("/perfil");
  const panel = page.locator("section.vc-panel", { has: page.locator("#profile-install-title") });
  await panel.getByRole("button", { name: "Ajustes de la app" }).click();
  expect(await page.evaluate(() => (window as unknown as { settingsState: { settings: number } }).settingsState.settings)).toBe(1);
});

test("inside an app with its own settings, the sidebar opens them from any section", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { settings: 0 };
    (window as unknown as { settingsState: typeof state }).settingsState = state;
    (window as unknown as { VideoCatAndroid: object }).VideoCatAndroid = {
      version: () => 3,
      capabilities: () => '["play","settings"]',
      openSettings: () => { state.settings += 1; }
    };
  });
  await openView(page, "/catalogo");
  await page.locator(".vc-sidebar").getByRole("button", { name: "Ajustes de la app" }).click();
  expect(await page.evaluate(() => (window as unknown as { settingsState: { settings: number } }).settingsState.settings)).toBe(1);
});

test("an app without settings (0.2.0) shows no settings button", async ({ page }) => {
  await asAndroidApp(page, ["play"]);
  await page.goto("/perfil");
  await expect(page.getByText("Estás usando VideoCAT como app instalada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajustes de la app" })).toHaveCount(0);
});

test("once the app casts natively, the detail offers Chromecast again", async ({ page }) => {
  await asAndroidApp(page, ["cast"]);
  await withChromecastOn(page);
  await openView(page, "/catalogo");
  await page.locator(".vc-card-open").first().click();
  await expect(castButton(page)).toBeVisible();
});

test("at http://<LAN address> (no crypto.randomUUID, no navigator.clipboard) changes are saved and Copiar works", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    // Kept aside only to read the result back at the end of the test.
    (window as unknown as { realClipboard: Clipboard }).realClipboard = navigator.clipboard;
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined, configurable: true });
  });
  await openView(page, "/catalogo");
  expect(await page.evaluate(() => [typeof crypto.randomUUID, typeof navigator.clipboard])).toEqual(["undefined", "undefined"]);
  await page.locator(".vc-card-open").first().click();
  const detail = page.locator(".vc-detail");
  await expect(detail).toBeVisible();

  // A change goes out with an Idempotency-Key; building it used to throw here, and nothing was saved.
  const keep = detail.locator(".curation-action.is-keep");
  for (let round = 0; round < 2; round += 1) {
    const saved = page.waitForResponse((response) => response.url().includes("/categories/keep") && response.request().method() === "PATCH");
    await keep.click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().headers()["idempotency-key"]).toMatch(/^videocat:PATCH:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }

  await detail.locator("summary", { hasText: "Más información" }).click();
  const relative = detail.locator(".info-row", { hasText: "Ruta relativa" });
  const expected = (await relative.locator("strong").textContent()) ?? "";
  await relative.locator(".copy-button").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { realClipboard: Clipboard }).realClipboard.readText())).toBe(expected);
});

// The app's native player (bridge version 2 with "play"): it records what the page hands it.
async function asAndroidAppWithPlayer(page: Page) {
  await page.addInitScript(() => {
    const state = { plays: [] as unknown[], stops: 0 };
    (window as unknown as { nativeState: typeof state }).nativeState = state;
    (window as unknown as { VideoCatAndroid: object }).VideoCatAndroid = {
      version: () => 2,
      capabilities: () => '["play"]',
      play: (json: string) => state.plays.push(JSON.parse(json)),
      stop: () => { state.stops += 1; }
    };
    localStorage.setItem("videocat-remote-shuffle", "false");
  });
}

// A Companion online with every drive connected, and stream sessions answered without one.
async function withRemotePlayback(page: Page) {
  const sessions: string[] = [];
  const deleted: string[] = [];
  await page.route("**/api/companion/status", async (route) => {
    const { disks } = await (await page.request.get("/api/disks")).json() as { disks: Array<{ id: string }> };
    await route.fulfill({ json: { online: true, staleAfterMs: 60_000, version: 99, mountedDiskCount: disks.length, mountedDiskIds: disks.map((disk) => disk.id) } });
  });
  await page.route("**/api/stream-sessions**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/stream-sessions") {
      const id = `0b7a3f52-1c2d-4e5f-8a9b-${String(sessions.length).padStart(12, "0")}`;
      sessions.push(id);
      return route.fulfill({ json: { session: { id, status: "ready", expiresAt: new Date(Date.now() + 900_000).toISOString(), mimeType: "video/mp4", sizeBytes: 1000 } } });
    }
    if (request.method() === "DELETE") {
      deleted.push(new URL(request.url()).pathname.split("/").pop() ?? "");
      return route.fulfill({ json: { ok: true } });
    }
    return route.continue();
  });
  return { sessions, deleted };
}

type NativeState = { plays: Array<{ url: string; title: string; position: number; shuffle: boolean; canNext: boolean }>; stops: number };
const nativeState = (page: Page) => page.evaluate(() => (window as unknown as { nativeState: NativeState }).nativeState);
const sendNative = (page: Page, event: object) =>
  page.evaluate((payload) => (window as unknown as { videocatAndroidPlayer: (event: object) => void }).videocatAndroidPlayer(payload), event);

test("inside the app the video plays in the native player, and Next and closing go through the page", async ({ page }) => {
  await asAndroidAppWithPlayer(page);
  const { sessions, deleted } = await withRemotePlayback(page);
  await openView(page, "/catalogo");
  await page.locator(".vc-card-open").first().click();
  const title = (await page.locator(".vc-detail .vc-detail-title h2").textContent()) ?? "";
  await page.locator(".vc-detail .detail-primary-action.is-remote").click();

  await expect.poll(async () => (await nativeState(page)).plays.length).toBe(1);
  const first = (await nativeState(page)).plays[0];
  expect(first).toMatchObject({ url: `${new URL(page.url()).origin}/api/streams/${sessions[0]}/content`, title, position: 0, shuffle: false, canNext: true });
  await expect(page.getByText("Reproduciendo en el reproductor de la app.")).toBeVisible();
  await expect(page.locator(".vc-detail video")).toHaveCount(0);

  // Next on the native player: the page opens the following video and hands over a new session.
  await sendNative(page, { type: "next" });
  await expect.poll(async () => (await nativeState(page)).plays.length).toBe(2);
  const second = (await nativeState(page)).plays[1];
  expect(second.url).toContain(sessions[1]);
  expect(second.title).not.toBe(title);
  await expect.poll(() => deleted).toContain(sessions[0]);

  // Closed in the app: the page ends the session and does not ask the app to stop again.
  await sendNative(page, { type: "closed", position: 31.5 });
  await expect.poll(() => deleted).toContain(sessions[1]);
  expect((await nativeState(page)).stops).toBe(0);
  await expect(page.getByText("Reproduciendo en el reproductor de la app.")).toHaveCount(0);
});

test("a dropped stream resumes once where it stopped; a second failure closes the native player", async ({ page }) => {
  await asAndroidAppWithPlayer(page);
  const { sessions } = await withRemotePlayback(page);
  await openView(page, "/catalogo");
  await page.locator(".vc-card-open").first().click();
  await page.locator(".vc-detail .detail-primary-action.is-remote").click();
  await expect.poll(async () => (await nativeState(page)).plays.length).toBe(1);

  await sendNative(page, { type: "error", position: 42, format: false });
  await expect.poll(async () => (await nativeState(page)).plays.length).toBe(2);
  const resumed = (await nativeState(page)).plays[1];
  expect(resumed.url).toContain(sessions[1]);
  expect(resumed.position).toBe(42);

  await sendNative(page, { type: "error", position: 50, format: false });
  await expect.poll(async () => (await nativeState(page)).stops).toBe(1);
  await expect(page.getByText(/se interrumpió después del reintento/)).toBeVisible();
});
