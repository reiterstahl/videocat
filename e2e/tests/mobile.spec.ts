import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, openView } from "./helpers";

const views = ["catalogo", "review", "a-descargar", "duplicados", "esquema-de-uso", "auditoria", "administracion", "perfil"];

test("every section fits the phone width without horizontal scrolling", async ({ page }) => {
  await openView(page, "/catalogo");
  for (const view of views) {
    await page.goto(`/${view}`);
    await expect(page.locator(".vc-frame")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page);
  }
});

test("tab bar and More sheet navigate between sections", async ({ page }) => {
  await openView(page, "/catalogo", { "videocat-catalog-filters-open": "true" });
  const tabs = page.getByRole("navigation", { name: "Secciones" });
  await expect(tabs).toBeVisible();
  await expect(page.locator(".vc-filters")).toHaveCount(0);
  await tabs.getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await tabs.getByRole("button", { name: "Más" }).click();
  const sheet = page.getByRole("dialog", { name: "Más secciones" });
  await sheet.getByRole("button", { name: "Auditoría" }).click();
  await expect(page).toHaveURL(/\/auditoria$/);
  await expect(sheet).toHaveCount(0);
  await tabs.getByRole("button", { name: "Más" }).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("filters open as a sheet with a live result count", async ({ page }) => {
  await openView(page, "/catalogo");
  await page.locator(".vc-header .vc-button", { hasText: "Filtros" }).click();
  await expect(page.locator(".vc-filters.is-sheet")).toBeVisible();
  await page.locator(".vc-filters .folder-select", { hasText: "Drone" }).first().click();
  const show = page.locator(".vc-sheet-footer .vc-button.is-primary");
  await expect(show).toHaveText(/^Ver \d+ videos?$/);
  await show.click();
  await expect(page.locator(".vc-filters")).toHaveCount(0);
  await expect(page.locator(".vc-filter-chip")).toHaveCount(1);
});

test("long press selects cards and docks bulk actions above the tab bar", async ({ page }) => {
  await openView(page, "/catalogo");
  await expect(page.locator(".vc-card-check").first()).toBeHidden();
  await page.locator(".vc-card-open").first().dispatchEvent("contextmenu");
  await page.locator(".vc-card-open").nth(1).dispatchEvent("contextmenu");
  const bulk = page.locator(".bulk-actions");
  await expect(bulk.locator("strong")).toHaveText("2 seleccionados");
  const bulkBox = await bulk.boundingBox();
  const tabsBox = await page.locator(".vc-tabbar").boundingBox();
  expect(bulkBox && tabsBox && bulkBox.y + bulkBox.height <= tabsBox.y).toBeTruthy();
});

test("review pins the file name, confirms each decision and returns to the top", async ({ page }) => {
  await openView(page, "/review");
  await page.locator(".vc-review-hero .vc-button.is-primary").click();
  const session = page.locator(".vc-review");
  await expect(session).toBeVisible();

  const title = page.locator(".vc-review-titlebar strong");
  const first = await title.textContent();
  await expect(page.locator(".vc-review-side h3")).toHaveText(first ?? "");
  await session.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect.poll(() => session.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(title).toBeInViewport();

  await page.locator(".vc-review-decision.is-keep").tap();
  await expect(page.locator(".vc-review-flash.is-keep")).toContainText("Mantenido");
  await expect(title).not.toHaveText(first ?? "");
  await expect.poll(() => session.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.locator(".vc-review-flash")).toHaveCount(0);

  const second = await title.textContent();
  await page.locator(".vc-review-decision.is-skip").tap();
  await expect(page.locator(".vc-review-flash.is-skip")).toContainText("Saltado");
  await expect(title).not.toHaveText(second ?? "");
});

test("the fullscreen gallery moves between frames with horizontal swipes", async ({ page }) => {
  await openView(page, "/review");
  await page.locator(".vc-review-hero .vc-button.is-primary").click();
  await expect(page.locator(".vc-review")).toBeVisible();
  await page.locator(".vc-review-frame").tap();
  const gallery = page.locator(".gallery-backdrop");
  const count = gallery.locator(".gallery-count");
  await expect(count).toHaveText("8 / 15");

  const swipe = async (dx: number, dy = 0) => {
    const init = { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 200, clientY: 420 };
    await gallery.dispatchEvent("pointerdown", init);
    for (const step of [0.3, 0.6, 1]) {
      await gallery.dispatchEvent("pointermove", { ...init, clientX: 200 + dx * step, clientY: 420 + dy * step });
    }
    await gallery.dispatchEvent("pointerup", { ...init, clientX: 200 + dx, clientY: 420 + dy });
  };

  await swipe(-140);
  await expect(count).toHaveText("9 / 15");
  await swipe(140);
  await expect(count).toHaveText("8 / 15");
  await swipe(-30);
  await expect(count).toHaveText("8 / 15");
  await swipe(-120, 200);
  await expect(count).toHaveText("8 / 15");

  for (let index = 0; index < 8; index += 1) await swipe(-140);
  await expect(count).toHaveText("15 / 15");
  await page.locator(".gallery-close").tap();
  await expect(gallery).toHaveCount(0);
});
