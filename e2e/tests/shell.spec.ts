import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

test("theme panel changes appearance, scheme and density and keeps them", async ({ page }) => {
  await openView(page, "/catalogo");
  await page.locator("[data-theme-trigger]").click();
  const panel = page.getByRole("dialog", { name: "Tema e idioma" });
  await panel.getByRole("button", { name: "OLED" }).click();
  await panel.getByRole("button", { name: "Cobalto" }).click();
  await panel.getByRole("button", { name: "Compacta" }).click();
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-surface", "oled");
  await expect(root).toHaveAttribute("data-accent", "cobalto");
  await expect(root).toHaveAttribute("data-density", "compact");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.reload();
  await expect(root).toHaveAttribute("data-accent", "cobalto");
});

test("language switch translates the shell", async ({ page }) => {
  await openView(page, "/catalogo");
  await page.locator("[data-theme-trigger]").click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator(".vc-sidebar")).toContainText("Catalog");
  await expect(page.locator(".vc-sidebar")).toContainText("Duplicates");
  await page.getByRole("button", { name: "Español" }).click();
  await expect(page.locator(".vc-sidebar")).toContainText("Catálogo");
});

test("sidebar collapses and navigates between sections", async ({ page }) => {
  await openView(page, "/catalogo");
  await page.locator(".vc-collapse-button").click();
  await expect(page.locator(".vc-frame")).toHaveClass(/is-sidebar-collapsed/);
  await page.locator(".vc-sidebar .vc-nav-item").nth(1).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.locator(".vc-page-title")).toHaveText("Review");
});
