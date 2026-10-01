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
