import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

// SMART checks come from a Companion on Windows; the demo catalog has none, so the API answers
// are patched here. What the server does with them is covered by the API tests.
const failing = {
  status: "failing",
  checkedAt: "2026-10-23T12:00:00.000Z",
  model: "WDC WD40NMZW",
  serial: "WX12",
  temperature: 41,
  powerOnHours: 21345,
  items: [
    { key: "reallocated", severity: "attention", label: "Sectores reasignados", value: "12" },
    { key: "uncorrectable", severity: "failing", label: "Sectores incorregibles", value: "3" }
  ]
};

test("a failing drive warns on every section until dismissed and shows its SMART check in Administración", async ({ page }) => {
  let diskId = "";
  let dismissed = false;
  await page.route("**/api/admin/disks/overview", async (route) => {
    const body = await (await route.fetch()).json();
    diskId = body.disks[0].disk.id;
    body.disks[0].health = failing;
    body.disks[1].health = { ...failing, status: "unavailable", items: [] };
    await route.fulfill({ json: body });
  });
  await page.route("**/api/disk-health/alerts", (route) => route.fulfill({
    json: { alerts: dismissed ? [] : [{ ...failing, diskId: diskId || "00000000-0000-4000-8000-000000000001", diskName: "WD Elements" }] }
  }));
  await page.route("**/api/disk-health/*/dismiss", async (route) => {
    dismissed = true;
    await route.fulfill({ json: { ok: true } });
  });

  await openView(page, "/catalogo");
  const alert = page.locator(".vc-health-alert");
  await expect(alert).toContainText("Falla probable: WD Elements");
  await expect(alert).toContainText("Sectores incorregibles: 3");

  await alert.getByRole("button", { name: "Ver el disco" }).click();
  await expect(page).toHaveURL(/\/administracion$/);
  const health = page.locator(".vc-admin-health").first();
  await expect(health.locator(".vc-badge")).toHaveText("Falla probable");
  await expect(health).toContainText("Sectores incorregibles");
  await expect(health).toContainText(/21\s345 h de uso/);
  await expect(page.locator(".vc-admin-health.is-unavailable")).toContainText("no deja leer SMART");

  await page.getByRole("button", { name: "Descartar el aviso de WD Elements" }).click();
  await expect(alert).toHaveCount(0);
  expect(dismissed).toBe(true);
});
