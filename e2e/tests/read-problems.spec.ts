import { expect, test, type Page } from "@playwright/test";
import { openView } from "./helpers";

// Files the drive did not let the Companion read (bad sectors). The demo catalog has none, so the
// API answers are patched here: one drive with two such files, and the catalog's first file as
// one of them. What the server does with them is covered by the API tests.
const atRisk = "Archivo en riesgo: la lectura no respondió en 30 s aunque el disco seguía conectado; puede tener sectores dañados. Los próximos escaneos no lo leen durante 30 días. Conviene copiarlo o revisar el disco.";

type FileItem = { id: string; diskId: string; errorMessage?: string | null; scanStatus: string; readRetryAt?: string | null };

async function patchApi(page: Page, retried: string[]) {
  await page.route("**/api/admin/disks/overview", async (route) => {
    const body = await (await route.fetch()).json();
    body.disks[0].catalog = { ...body.disks[0].catalog, readProblemFiles: 2, readRetryFiles: 0 };
    await route.fulfill({ json: body });
  });
  const markFile = (file: FileItem) => ({ ...file, scanStatus: "metadata_failed", errorMessage: atRisk, readRetryAt: null });
  await page.route(/\/api\/files\?/, async (route) => {
    const body = await (await route.fetch()).json();
    if (body.files?.length) body.files[0] = markFile(body.files[0]);
    await route.fulfill({ json: body });
  });
  await page.route(/\/api\/files\/[0-9a-f-]{36}$/, async (route) => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, file: markFile(body.file) } });
  });
  await page.route("**/api/files/read-retry", async (route) => {
    retried.push(route.request().postData() ?? "");
    await route.fulfill({ json: { requested: 2 } });
  });
}

test("a drive with read problems says so in Administración, opens its files and asks to read them again", async ({ page }) => {
  const retried: string[] = [];
  await patchApi(page, retried);
  await openView(page, "/administracion");
  const notice = page.locator(".vc-admin-read-problems").first();
  await expect(notice).toContainText("2 con problema de lectura");

  await notice.getByRole("button", { name: "Volver a leerlos" }).click();
  await expect(notice).toContainText("Se vuelven a leer en el próximo escaneo de este disco.");
  await expect(notice.getByRole("button", { name: "Volver a leerlos" })).toBeDisabled();
  expect(JSON.parse(retried[0])).toHaveProperty("diskId");

  const listed = page.waitForRequest((request) => /\/api\/files\?.*readProblemOnly=true/.test(request.url()));
  await notice.getByRole("button", { name: "Ver archivos" }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  const url = new URL((await listed).url());
  expect(url.searchParams.get("diskIds")?.split(",")).toHaveLength(1);
  await expect(page.locator(".vc-filter-chip", { hasText: "Con problema de lectura" })).toBeVisible();
});

test("a file with a read problem explains it and can be read again on the next scan", async ({ page }) => {
  const retried: string[] = [];
  await patchApi(page, retried);
  await openView(page, "/catalogo");
  const card = page.locator(".vc-card").first();
  await expect(card.locator(".vc-card-badge", { hasText: "En riesgo" })).toBeVisible();
  await card.locator(".vc-card-open").click();

  const notice = page.locator(".vc-detail-read-problem").first();
  await expect(notice).toContainText("Problema de lectura");
  await notice.getByRole("button", { name: "Volver a leerlo" }).click();
  await expect(notice).toContainText("Se vuelve a leer en el próximo escaneo de");
  expect(JSON.parse(retried[0]).fileIds).toHaveLength(1);
});
