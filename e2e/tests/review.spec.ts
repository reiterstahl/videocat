import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

test("review session supports keep, undo, tag toggles, skip and delete from the keyboard", async ({ page }) => {
  await openView(page, "/review");
  const pending = page.locator(".vc-review-home .vc-kpi").first().locator("strong");
  await expect(page.locator(".vc-review-home .vc-card").first()).toBeVisible();
  const before = Number((await pending.textContent())?.replace(/\D/g, ""));
  await page.locator(".vc-review-hero .vc-button.is-primary").click();
  const session = page.locator(".vc-review");
  await expect(session).toBeVisible();
  await expect(page.locator(".vc-review-filmstrip button")).toHaveCount(15);
  const frame = page.locator(".vc-review-frame-count");
  const firstFrame = await frame.textContent();
  await page.keyboard.press("ArrowRight");
  await expect(frame).not.toHaveText(firstFrame ?? "");

  const name = page.locator(".vc-review-file h3");
  const first = await name.textContent();
  await page.keyboard.press("k");
  await expect(name).not.toHaveText(first ?? "");
  await expect(page.locator(".vc-review-last.is-keep")).toBeVisible();
  await expect(page.locator(".vc-review-session strong")).toHaveText("1");
  await page.keyboard.press("z");
  await expect(name).toHaveText(first ?? "");
  await expect(page.locator(".vc-review-session strong")).toHaveText("0");

  const tag = page.locator(".vc-review-tag").first();
  const pressed = await tag.getAttribute("aria-pressed");
  await page.keyboard.press("1");
  await expect(tag).not.toHaveAttribute("aria-pressed", pressed ?? "");
  await page.keyboard.press("1");
  await expect(tag).toHaveAttribute("aria-pressed", pressed ?? "");

  await page.keyboard.press("s");
  await expect(name).not.toHaveText(first ?? "");
  await expect(page.locator(".vc-review-session strong")).toHaveText("0");
  await page.keyboard.press("d");
  await expect(page.locator(".vc-review-last.is-delete")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(session).toHaveCount(0);
  await expect(pending).toHaveText(String(before - 1));
});
