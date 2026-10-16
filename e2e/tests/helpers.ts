import { expect, type Page } from "@playwright/test";

// Opens a section with a clean per-browser preference state.
const spanishPages = new WeakSet<Page>();

export async function openView(page: Page, path: string, storage: Record<string, string> = {}) {
  // The language is set before any page script runs, on every load of this page.
  if (!spanishPages.has(page)) {
    spanishPages.add(page);
    await page.addInitScript(() => localStorage.setItem("videocat-language", "es"));
  }
  await page.goto(path);
  await page.evaluate((values) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("videocat-") && key !== "videocat-language") localStorage.removeItem(key);
    }
    localStorage.setItem("videocat-language", "es");
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, storage);
  await page.reload();
  await expect(page.locator(".vc-frame")).toBeVisible();
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
