import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

test("duplicates list shows groups, recommendations and the drive ranking", async ({ page }) => {
  await openView(page, "/duplicados");
  await expect(page.locator(".vc-dup-group").first()).toBeVisible();
  await expect(page.locator(".vc-dup-drives li").first()).toBeVisible();
  await expect(page.locator(".vc-dup-file").first()).toBeVisible();
  const pendingGroups = await page.locator(".vc-dup-group .vc-button.is-small").count();
  await expect(page.locator(".vc-dup-file.is-recommended")).toHaveCount(pendingGroups);
});

test("Resolve starts at the chosen group; S skips and Enter keeps the recommendation", async ({ page }) => {
  await openView(page, "/duplicados");
  const group = page.locator(".vc-dup-group").filter({ has: page.locator(".vc-button.is-small") }).nth(1);
  await expect(group.locator(".vc-dup-file-body strong").first()).toBeVisible();
  const names = await group.locator(".vc-dup-file-body strong").allTextContents();
  await group.locator(".vc-button.is-small").click();
  const assistant = page.locator(".vc-dup-assistant");
  await expect(assistant).toBeVisible();
  await expect(page.locator(".vc-dup-choice-copy strong")).toHaveCount(2);
  for (const shown of await page.locator(".vc-dup-choice-copy strong").allTextContents()) expect(names).toContain(shown);
  await expect(page.locator(".vc-dup-choice.is-recommended")).toHaveCount(1);

  const progress = page.locator(".vc-review-pill");
  const before = await progress.textContent();
  await page.keyboard.press("s");
  await expect(progress).not.toHaveText(before ?? "");

  await expect(page.locator(".vc-dup-choice-copy strong")).toHaveCount(2);
  const pair = await page.locator(".vc-dup-choice-copy strong").allTextContents();
  const recommended = await page.locator(".vc-dup-choice.is-recommended .vc-dup-choice-copy strong").textContent();
  await page.keyboard.press("Enter");
  await expect.poll(async () => {
    const response = await page.request.get("/api/duplicates/by-size");
    const groups = (await response.json()).groups as Array<{ files: Array<{ filename: string; curationStatus: string }> }>;
    const files = groups.flatMap((item) => item.files);
    return pair.map((filename) => files.find((file) => file.filename === filename)?.curationStatus);
  }).toEqual(pair.map((filename) => (filename === recommended ? "keep" : "delete")));
  await page.keyboard.press("Escape");
  await expect(assistant).toHaveCount(0);
});

test("the Duplicates badge counts only groups that still need a decision", async ({ page }) => {
  await openView(page, "/duplicados");
  const navBadge = page.locator(".vc-nav-item", { hasText: "Duplicados" }).locator(".vc-nav-badge");
  const pendingInView = page.locator(".vc-count-badge.is-inverse");
  await expect(pendingInView).toBeVisible();
  const before = Number(await pendingInView.textContent());
  await expect(navBadge).toHaveText(String(before));

  // A pair is resolved by a single decision; larger groups need one per extra copy.
  const pairIndex = await page.locator(".vc-dup-group").evaluateAll((groups) =>
    groups.findIndex((group) => group.querySelector(".vc-button.is-small") && group.querySelectorAll(".vc-dup-file").length === 2)
  );
  expect(pairIndex).toBeGreaterThanOrEqual(0);
  await page.locator(".vc-dup-group").nth(pairIndex).locator(".vc-button.is-small").click();
  await expect(page.locator(".vc-dup-assistant")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(navBadge).toHaveText(String(before - 1));
  await page.keyboard.press("Escape");
  await expect(pendingInView).toHaveText(String(before - 1));
});
