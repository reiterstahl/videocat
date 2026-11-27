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
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), chromecastEnabled: true } });
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
