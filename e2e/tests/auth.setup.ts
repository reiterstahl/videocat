import { expect, test as setup } from "@playwright/test";

setup("sign in as the admin user", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("videocat-language", "es"));
  await page.reload();
  await page.getByLabel("Usuario").fill(process.env.E2E_USER ?? process.env.ADMIN_USER ?? "admin");
  await page.getByLabel("Contrasena").fill(process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".vc-frame")).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
