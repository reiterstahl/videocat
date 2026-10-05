import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

const portraitFrame = fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/portrait-frame.jpg"));

test("vertical videos fill a vertical canvas and gallery without cropping", async ({ page }) => {
  // Every thumbnail becomes a 9:16 frame, as phone videos produce.
  await page.route("**/thumbnails/**", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: portraitFrame }));
  await openView(page, "/review");
  await page.locator(".vc-review-hero .vc-button.is-primary").click();

  const stage = page.locator(".vc-review-stage");
  await expect(stage).toHaveClass(/is-portrait/);
  await expect(stage.locator(".vc-review-frame-ambient")).toHaveCount(1);
  const frame = stage.locator(".vc-review-frame img:not(.vc-review-frame-ambient)");
  // object-fit: contain shows the whole frame; its rendered box keeps the 9:16 shape inside the stage.
  const shown = await frame.evaluate((image: HTMLImageElement) => {
    const box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    return { width: image.naturalWidth * scale, height: image.naturalHeight * scale, boxWidth: box.width, boxHeight: box.height };
  });
  expect(shown.height).toBeGreaterThan(shown.width);
  expect(shown.height).toBeLessThanOrEqual(shown.boxHeight + 1);
  expect(shown.height).toBeGreaterThan(250);

  await page.locator(".vc-review-layout button").nth(1).click();
  const gallery = page.locator(".vc-review-gallery");
  await expect(gallery).toHaveClass(/is-portrait/);
  const tiles = page.locator(".vc-review-gallery-tile");
  await expect(tiles).toHaveCount(15);
  const tile = await tiles.first().boundingBox();
  expect(tile!.height).toBeGreaterThan(tile!.width * 1.5);
  await page.locator(".vc-review-layout button").first().click();
  await page.keyboard.press("Escape");
});
