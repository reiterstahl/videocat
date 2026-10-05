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
  await page.keyboard.press("f");
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
  await page.keyboard.press("j");
  await expect(page.locator(".vc-review-last.is-delete")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(session).toHaveCount(0);
  await expect(pending).toHaveText(String(before - 1));
});

test("review gallery shows every frame at once and remembers the layout", async ({ page }) => {
  await openView(page, "/review");
  await page.locator(".vc-review-hero .vc-button.is-primary").click();
  const session = page.locator(".vc-review");
  await expect(session).toBeVisible();
  await expect(page.locator(".vc-review-gallery")).toHaveCount(0);

  await page.keyboard.press("g");
  const tiles = page.locator(".vc-review-gallery-tile");
  await expect(tiles).toHaveCount(15);
  await expect(page.locator(".vc-review-filmstrip")).toHaveCount(0);
  await expect(page.locator(".vc-review-layout button").nth(1)).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("videocat-review-layout"))).toBe("gallery");

  await page.keyboard.press("Escape");
  await expect(session).toHaveCount(0);
  await page.locator(".vc-review-hero .vc-button.is-primary").click();
  await expect(page.locator(".vc-review-gallery-tile")).toHaveCount(15);

  await page.locator(".vc-review-layout button").first().click();
  await expect(page.locator(".vc-review-filmstrip button")).toHaveCount(15);
  expect(await page.evaluate(() => localStorage.getItem("videocat-review-layout"))).toBe("frame");
  await page.keyboard.press("Escape");
});

test("Space blacks out the session without taking decisions and Enter plays the frames", async ({ page }) => {
  await openView(page, "/review");
  await page.locator(".vc-review-hero .vc-button.is-primary").click();
  const name = page.locator(".vc-review-file h3");
  const decisions = page.locator(".vc-review-session strong");
  await expect(name).toBeVisible();

  // The decision is confirmed on desktop too; the clicked button keeps focus afterwards.
  const first = await name.textContent();
  await page.locator(".vc-review-decision.is-keep").click();
  await expect(page.locator(".vc-review-flash.is-keep")).toBeVisible();
  await expect(name).not.toHaveText(first ?? "");
  await expect(decisions).toHaveText("1");
  const second = await name.textContent();

  const privacy = page.locator(".vc-review-privacy");
  await page.keyboard.press(" ");
  await expect(privacy).toBeVisible();
  for (const key of ["j", "f", "s", "Enter", "ArrowRight"]) await page.keyboard.press(key);
  await page.keyboard.press(" ");
  await expect(privacy).toHaveCount(0);
  await expect(name).toHaveText(second ?? "");
  await expect(decisions).toHaveText("1");

  const play = page.locator(".vc-review-stage-controls .vc-review-round.is-primary");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(play).toHaveAttribute("aria-pressed", "false");

  await page.locator(".vc-review-privacy-button").click();
  await expect(privacy).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(privacy).toHaveCount(0);
  await expect(page.locator(".vc-review")).toBeVisible();
  await page.locator(".vc-review-privacy-button").click();
  await privacy.click();
  await expect(privacy).toHaveCount(0);
  await expect(decisions).toHaveText("1");
  await page.keyboard.press("Escape");
});
