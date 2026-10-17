import { expect, test as setup } from "@playwright/test";

setup("sign in as the admin user", async ({ page }) => {
  // Before any page script runs, so the app never stores the test browser's own language first.
  await page.addInitScript(() => localStorage.setItem("videocat-language", "es"));
  await page.goto("/");
  await page.getByLabel("Usuario", { exact: true }).fill(process.env.E2E_USER ?? process.env.ADMIN_USER ?? "admin");
  await page.getByLabel("Contraseña", { exact: true }).fill(process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".vc-frame")).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
