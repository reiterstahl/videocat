import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

test("usage map drills into folders and opens the catalog filtered by folder", async ({ page }) => {
  await openView(page, "/esquema-de-uso");
  const tiles = page.locator(".vc-treemap-tile");
  await expect(tiles.first()).toBeVisible();
  const folder = (await page.locator(".vc-usage-row").filter({ has: page.locator(".vc-usage-name:not([disabled])") }).first().locator(".vc-usage-name span").first().textContent()) ?? "";
  await page.locator(".vc-usage-name", { hasText: folder }).first().click();
  await expect(page.locator(".vc-breadcrumbs .is-current")).toHaveText(folder);
  await page.locator(".vc-usage-summary .vc-button", { hasText: "Ver en el catálogo" }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  await expect(page.locator(".vc-filter-chip", { hasText: folder })).toBeVisible();
});

test("audit groups repeated errors, searches, lists actions and exports CSV", async ({ page }) => {
  await openView(page, "/auditoria");
  await expect(page.locator(".vc-audit-count").first()).toBeVisible();
  const groups = await page.locator(".vc-audit-row").count();
  await page.getByLabel("Agrupar repetidos").uncheck();
  await expect.poll(() => page.locator(".vc-audit-row").count()).toBeGreaterThan(groups);
  await page.getByPlaceholder("Buscar mensaje, ruta o código").fill("timed out");
  await expect.poll(async () => {
    const texts = await page.locator(".vc-audit-main strong").allTextContents();
    return texts.length > 0 && texts.every((text) => text.includes("timed out"));
  }).toBe(true);
  const href = await page.getByRole("link", { name: "Exportar CSV" }).getAttribute("href");
  const response = await page.request.get(href ?? "");
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(await response.text()).toContain("timed out");
  await page.getByRole("tab", { name: "Registro de acciones" }).click();
  await expect(page.locator(".vc-audit-status").first()).toBeVisible();
});

test("administration requires typing BORRAR before emptying a drive catalog", async ({ page }) => {
  await openView(page, "/administracion");
  await expect(page.locator(".vc-disks")).toHaveCount(0);
  const card = page.locator(".vc-admin-disk").first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Vaciar catálogo" }).click();
  const confirm = card.locator(".vc-danger-confirm button[type=submit]");
  await expect(confirm).toBeDisabled();
  await card.locator(".vc-danger-confirm input").fill("borrar");
  await expect(confirm).toBeDisabled();
  await card.getByRole("button", { name: "Cancelar" }).click();
  await expect(card.locator(".vc-danger-confirm")).toHaveCount(0);
  await expect(page.locator(".vc-admin-retention dd").first()).toContainText("días");
});

test("profile stores the Companion token and changes the theme in place", async ({ page }) => {
  await openView(page, "/perfil");
  await page.getByLabel("Token del Companion").fill("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Guardar token" }).click();
  await expect(page.getByText("Token guardado en este navegador")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("videocat-companion-token"))).toBe("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText("Sin token en este navegador")).toBeVisible();
  await page.locator(".vc-profile-theme").getByRole("button", { name: "Uva" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "uva");
});

test("downloads shows the transfer and random selection panels", async ({ page }) => {
  await openView(page, "/a-descargar");
  await expect(page.locator(".vc-transfer")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Selección aleatoria" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Procesar cola" })).toBeVisible();
  await expect(page.locator(".vc-queue")).toBeVisible();
});
