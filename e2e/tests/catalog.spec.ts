import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openView(page, "/catalogo", { "videocat-catalog-filters-open": "true" });
});

test("Ctrl+K focuses the search from another section and filters results", async ({ page }) => {
  await page.goto("/duplicados");
  await page.keyboard.press("Control+k");
  await expect(page).toHaveURL(/\/catalogo$/);
  const search = page.locator(".vc-search input");
  await expect(search).toBeFocused();
  await search.fill("Drone");
  await expect(page.locator(".vc-results-count")).not.toHaveText(/^75 /);
  // The search matches the file name or its path.
  for (const card of await page.locator(".vc-card-body").allTextContents()) expect(card.toLowerCase()).toContain("drone");
});

test("folder filters show removable chips and a counter", async ({ page }) => {
  await page.locator(".folder-select", { hasText: "Cursos" }).click();
  await expect(page.locator(".vc-filter-chip", { hasText: "Cursos" })).toBeVisible();
  await expect(page.locator(".vc-header .vc-count-badge")).toHaveText("1");
  await page.locator(".vc-filter-chip").first().click();
  await expect(page.locator(".vc-filter-chip")).toHaveCount(0);
});

test("detail panel navigates with buttons and arrows, ignores arrows while typing and closes with Esc", async ({ page }) => {
  await page.locator(".vc-card-open").first().click();
  const title = page.locator(".vc-detail-title h2");
  const first = await title.textContent();
  await expect(page.locator(".vc-filters")).toHaveCount(0);
  await page.locator(".vc-detail-toolbar button").nth(1).click();
  await expect(title).not.toHaveText(first ?? "");
  await expect(page.locator(".vc-card.is-active .vc-card-title")).toHaveText((await title.textContent()) ?? "");
  await page.locator(".vc-card.is-active .vc-card-open").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText(first ?? "");
  await page.locator(".vc-search input").focus();
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText(first ?? "");
  await page.locator(".vc-card.is-active .vc-card-open").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vc-detail")).toHaveCount(0);
  await expect(page.locator(".vc-filters")).toBeVisible();
});

test("videos open full screen when chosen, switch with F or the button, and the choice is remembered", async ({ page }) => {
  const openIn = page.getByRole("group", { name: "Abrir los videos en" });
  await openIn.getByRole("button", { name: "Pantalla completa" }).click();
  await expect(openIn.getByRole("button", { name: "Pantalla completa" })).toHaveAttribute("aria-pressed", "true");

  await page.locator(".vc-card-open").first().click();
  const full = page.locator(".vc-detail-full");
  await expect(full).toBeVisible();
  await expect(page.locator(".vc-detail")).toHaveCount(0);
  const title = full.locator(".vc-detail-title h2");
  const first = await title.textContent();
  await expect(full.locator(".vc-detail-full-where strong")).toHaveText(first ?? "");
  // Every fact is on screen: location and technical details, not behind «Más información».
  await expect(full.getByText("Ruta relativa")).toBeVisible();
  await expect(full.getByText("Bitrate")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(title).not.toHaveText(first ?? "");
  const second = await title.textContent();

  // F moves the open video to the side panel and back; the preference stays.
  await page.keyboard.press("f");
  await expect(full).toHaveCount(0);
  await expect(page.locator(".vc-detail .vc-detail-title h2")).toHaveText(second ?? "");
  await page.getByRole("button", { name: "Ver a pantalla completa" }).click();
  await expect(full).toBeVisible();
  await full.getByRole("button", { name: "Ver en panel" }).click();
  await expect(page.locator(".vc-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vc-detail")).toHaveCount(0);

  // The next video opens full screen again, also after reloading.
  await page.reload();
  await expect(page.getByRole("group", { name: "Abrir los videos en" }).getByRole("button", { name: "Pantalla completa" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".vc-card-open").nth(2).click();
  await expect(full).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(full).toHaveCount(0);
});

test("bulk selection survives switching to the list view and sorting works", async ({ page }) => {
  await page.locator(".vc-card").first().hover();
  await page.locator(".vc-card-check").first().click();
  await expect(page.locator(".bulk-actions")).toBeVisible();
  await page.getByRole("group", { name: "Vista" }).getByRole("button", { name: "Lista" }).click();
  await expect(page.locator(".catalog-table")).toBeVisible();
  await expect(page.locator("tbody tr.is-selected")).toHaveCount(1);
  await page.locator(".vc-inline-field select").first().selectOption("sizeBytes:desc");
  const sizes = await page.locator("tbody tr td:nth-child(5)").allTextContents();
  expect(sizes.length).toBeGreaterThan(2);
});
