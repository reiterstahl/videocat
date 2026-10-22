import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

// Without an S3 service in CI: what the form says when the endpoint does not answer or cannot
// take the bucket in its host name, and that nothing is saved then. Saving a working bucket is
// covered by the API test against MinIO.
test("an S3 bucket that does not answer is explained and not saved", async ({ page }) => {
  await openView(page, "/administracion");
  const section = page.locator("section[aria-labelledby=admin-storage-title]");
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Añadir bucket" }).click();

  const form = section.locator(".vc-s3-form");
  await form.getByLabel("Nombre del disco").fill("MinIO de prueba");
  await form.getByLabel(/^Endpoint/).fill("http://127.0.0.1:59999");
  await form.getByLabel("Bucket", { exact: true }).fill("videos");
  await form.getByLabel(/^Access key/).fill("videocat");
  const save = form.getByRole("button", { name: "Guardar" });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute("title", /secret key/);
  await form.getByLabel("Secret key", { exact: true }).fill("not-a-real-secret");

  // Virtual-hosted style cannot put the bucket in front of an IP address.
  await form.getByLabel("Estilo de ruta (path-style)").uncheck();
  await form.getByRole("button", { name: "Probar conexión" }).click();
  await expect(form.locator(".vc-s3-check")).toContainText("Con una dirección IP o localhost hay que activar el estilo de ruta.");

  await form.getByLabel("Estilo de ruta (path-style)").check();
  await expect(form.locator(".vc-s3-check")).toHaveCount(0);
  await save.click();
  const check = form.locator(".vc-s3-check.is-failed");
  await expect(check).toContainText("La conexión no funcionó.");
  await expect(check.locator(".vc-s3-step.is-failed")).toContainText("no acepta conexiones");

  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(section.locator(".vc-s3-bucket")).toHaveCount(0);
  await expect(section.getByText("Todavía no hay buckets S3.")).toBeVisible();
});
