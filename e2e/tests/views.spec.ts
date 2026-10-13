import { expect, test } from "@playwright/test";
import { openView } from "./helpers";

test("usage map drills into folders and opens the catalog filtered by folder", async ({ page }) => {
  await openView(page, "/esquema-de-uso");
  const tiles = page.locator(".vc-treemap-tile");
  await expect(tiles.first()).toBeVisible();
  const folder = (await page.locator(".vc-usage-row").filter({ has: page.locator(".vc-usage-name:not([disabled])") }).first().locator(".vc-usage-name span").first().textContent()) ?? "";
  await page.locator(".vc-usage-name", { hasText: folder }).first().click();
  await expect(page.locator(".vc-breadcrumbs .is-current")).toHaveText(folder);
  await page.locator(".vc-usage-summary .vc-button", { hasText: "Ver en el catálogo" }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  await expect(page.locator(".vc-filter-chip", { hasText: folder })).toBeVisible();
});

test("audit groups repeated errors, searches, lists actions and exports CSV", async ({ page }) => {
  await openView(page, "/auditoria");
  await expect(page.locator(".vc-audit-count").first()).toBeVisible();
  const groups = await page.locator(".vc-audit-row").count();
  await page.getByLabel("Agrupar repetidos").uncheck();
  await expect.poll(() => page.locator(".vc-audit-row").count()).toBeGreaterThan(groups);
  await page.getByPlaceholder("Buscar mensaje, ruta o código").fill("timed out");
  await expect.poll(async () => {
    const texts = await page.locator(".vc-audit-main strong").allTextContents();
    return texts.length > 0 && texts.every((text) => text.includes("timed out"));
  }).toBe(true);
  const href = await page.getByRole("link", { name: "Exportar CSV" }).getAttribute("href");
  const response = await page.request.get(href ?? "");
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(await response.text()).toContain("timed out");
  await page.getByRole("tab", { name: "Registro de acciones" }).click();
  await expect(page.locator(".vc-audit-status").first()).toBeVisible();
});

test("administration requires typing BORRAR before emptying a drive catalog", async ({ page }) => {
  await openView(page, "/administracion");
  await expect(page.locator(".vc-disks")).toHaveCount(0);
  const card = page.locator(".vc-admin-disk").first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Vaciar catálogo" }).click();
  const confirm = card.locator(".vc-danger-confirm button[type=submit]");
  await expect(confirm).toBeDisabled();
  await card.locator(".vc-danger-confirm input").fill("borrar");
  await expect(confirm).toBeDisabled();
  await card.getByRole("button", { name: "Cancelar" }).click();
  await expect(card.locator(".vc-danger-confirm")).toHaveCount(0);
  await expect(page.locator(".vc-admin-retention dd").first()).toContainText("días");
});

test("profile stores the Companion token and changes the theme in place", async ({ page }) => {
  await openView(page, "/perfil");
  await page.getByLabel("Token del Companion").fill("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Guardar token" }).click();
  await expect(page.getByText("Token guardado en este navegador")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("videocat-companion-token"))).toBe("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText("Sin token en este navegador")).toBeVisible();
  await page.locator(".vc-profile-theme").getByRole("button", { name: "Uva" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "uva");
});

test("downloads shows the transfer and random selection panels", async ({ page }) => {
  await openView(page, "/a-descargar");
  await expect(page.locator(".vc-transfer")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Selección aleatoria" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Procesar cola" })).toBeVisible();
  await expect(page.locator(".vc-queue")).toBeVisible();
});

test("profile explains how to install the app and the shell warns when offline", async ({ page, context }) => {
  await openView(page, "/perfil");
  const panel = page.locator("section.vc-panel", { has: page.locator("#profile-install-title") });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".vc-install-status, .vc-install-actions").first()).toBeVisible();

  await context.setOffline(true);
  await expect(page.locator(".vc-offline-banner")).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".vc-offline-banner")).toHaveCount(0);
});

test("folder usage merges same-named folders, opens them in the catalog and can keep a name apart", async ({ page }) => {
  await openView(page, "/uso-por-carpeta");
  const tiles = page.locator(".vc-folder-tile.is-group");
  await expect(tiles.first()).toBeVisible();
  const groups = page.locator(".vc-folders-list > li");
  await expect(groups.first()).toBeVisible();
  const firstGroup = groups.first();
  const name = (await firstGroup.locator(".vc-folders-item-head strong").textContent())!.trim();
  expect(await firstGroup.locator(".vc-folders-locations li").count()).toBeGreaterThan(1);

  // Hovering shows the path; clicking opens the catalog scoped to every location of the group.
  const tile = page.locator(".vc-folder-tile.is-group", { hasText: name }).first();
  // Subfolders cover the body of a parent block; its title strip is what opens the whole folder.
  await tile.hover({ position: { x: 10, y: 6 } });
  await expect(page.locator(".vc-folders-status strong")).toContainText(name);
  await tile.click({ position: { x: 10, y: 6 } });
  await expect(page).toHaveURL(/\/catalogo$/);
  await expect(page.locator(".vc-filter-chip", { hasText: `Carpeta: ${name}` })).toBeVisible();
  await expect(page.locator(".vc-card").first()).toBeVisible();

  await openView(page, "/uso-por-carpeta");
  const group = page.locator(".vc-folders-list > li", { has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) });
  await group.getByRole("button", { name: "No agrupar" }).click();
  await expect(group).toHaveClass(/is-excluded/);
  await expect(page.locator(".vc-folder-tile.is-group", { hasText: name })).toHaveCount(0);
  await group.getByRole("button", { name: "Agrupar de nuevo" }).click();
  await expect(group).not.toHaveClass(/is-excluded/);
});

test("a starred folder consolidates its namesakes and the transfer shows up in Traslados", async ({ page }) => {
  await openView(page, "/uso-por-carpeta");
  const groups = page.locator(".vc-folders-list > li:not(.is-excluded)");
  await expect(groups.first()).toBeVisible();
  const group = groups.first();
  const name = (await group.locator(".vc-folders-item-head strong").textContent())!.trim();
  const locations = group.locator(".vc-folders-locations li");

  // Starring a smaller location warns that the largest one would move less data.
  const sizes = await locations.locator("em").allTextContents();
  expect(sizes.length).toBeGreaterThan(1);
  await locations.last().getByRole("button", { name: /Marcar con estrella/ }).click();
  await expect(locations.last()).toHaveClass(/is-starred/);
  await expect(group.locator(".vc-folders-warning")).toContainText("La ubicación más grande es");
  await locations.last().getByRole("button", { name: /Quitar estrella/ }).click();
  await expect(group.locator(".vc-folders-warning")).toHaveCount(0);

  await locations.first().getByRole("button", { name: /Marcar con estrella/ }).click();
  await expect(locations.first()).toHaveClass(/is-starred/);
  await expect(group.locator(".vc-folders-warning")).toHaveCount(0);
  await group.getByRole("button", { name: /^Consolidar en / }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Llevar todo a ${name}` })).toBeVisible();
  await expect(dialog.locator(".vc-consolidate-sources li").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Crear traslado" }).click();

  await expect(page).toHaveURL(/\/traslados$/);
  const job = page.locator(".vc-transfers-list > li", { hasText: name }).first();
  await expect(job).toBeVisible();
  await expect(page.locator(".vc-transfers-needs .vc-status-banner").first()).toContainText("Conecta");

  await job.getByRole("button", { name: "Pausar" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("En pausa");
  await job.getByRole("button", { name: "Reanudar" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("En curso");
  await job.locator(".vc-transfers-expand").click();
  await expect(job.locator(".vc-transfers-items li").first()).toContainText("Esperando el disco de origen");

  // The catalog marks the files that are on their way.
  await openView(page, "/uso-por-carpeta");
  await page.locator(".vc-folders-list > li", { has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) }).getByRole("button", { name: "Ver en catálogo" }).click();
  await expect(page.locator(".vc-card-badge.is-transit").first()).toHaveText("Por trasladar");

  await openView(page, "/traslados");
  await job.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar traslado" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("Cancelado");
  await expect(page.locator(".vc-transfers-needs")).toHaveCount(0);

  // The star can be removed once nothing is on its way.
  await page.locator(".vc-transfers-destinations").getByRole("button", { name: "Quitar estrella" }).first().click();
  await expect(page.locator(".vc-transfers-destinations")).toContainText("Ninguna todavía");
});

test("grouping files finds similar names and decides them like Review", async ({ page }) => {
  await openView(page, "/traslados");
  const card = page.locator(".vc-transfers-group");
  await card.getByRole("textbox", { name: "Buscar carpeta para agrupar archivos" }).fill("boda");
  const results = card.locator(".vc-transfers-folder-results li");
  await expect(results.first()).toBeVisible();
  await results.first().getByRole("button", { name: "Agrupar aquí" }).click();

  const session = page.getByRole("dialog", { name: "Sesión para agrupar archivos" });
  await expect(session.getByRole("heading", { name: "Agrupar archivos" })).toBeVisible();
  await expect(session.locator(".vc-group-note")).toContainText("Destino:");
  const title = session.locator(".vc-review-titlebar strong");
  const first = (await title.textContent())!;
  expect(first.toLowerCase()).toContain("boda");

  // F groups, J ignores, Z brings the last one back.
  await page.keyboard.press("f");
  await expect(session.locator(".vc-review-last")).toContainText(`Agrupado: ${first}`);
  await expect(session.locator(".vc-review-stats")).toContainText("Agrupados1");
  const second = (await title.textContent())!;
  expect(second).not.toBe(first);
  await page.keyboard.press("j");
  await expect(session.locator(".vc-review-stats")).toContainText("Ignorados1");
  await page.keyboard.press("z");
  await expect(title).toHaveText(second);
  await expect(session.locator(".vc-review-stats")).toContainText("Ignorados0");
  await page.keyboard.press("Escape");
  await expect(session).toHaveCount(0);

  // The grouped file is now a grouping transfer into the chosen folder.
  const job = page.locator(".vc-transfers-list > li", { hasText: "Agrupar" }).first();
  await expect(job).toBeVisible();
  await expect(job).toContainText("Boda");
  await job.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar traslado" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("Cancelado");
});

test("the catalog folder tree opens Agrupar archivos with that folder name", async ({ page }) => {
  await openView(page, "/catalogo");
  const option = page.locator(".folder-option", { has: page.locator(".folder-group") }).first();
  await expect(option).toBeVisible();
  const label = (await option.locator(".folder-select span").textContent())!.trim();
  await option.hover();
  await option.locator(".folder-group").click();
  await expect(page).toHaveURL(/\/traslados$/);
  await expect(page.getByRole("textbox", { name: "Buscar carpeta para agrupar archivos" })).toHaveValue(label);
  await expect(page.locator(".vc-transfers-folder-results li").first()).toBeVisible();
});

test("a destination without room still accepts the transfer and asks to free space", async ({ page }) => {
  await openView(page, "/uso-por-carpeta");
  const group = page.locator(".vc-folders-list > li:not(.is-excluded)").first();
  const smallest = group.locator(".vc-folders-locations li").last();
  const diskName = (await smallest.locator("span").first().textContent())!.trim();
  await smallest.getByRole("button", { name: /Marcar con estrella/ }).click();
  await group.getByRole("button", { name: /^Consolidar en / }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".vc-status-banner.is-warning", { hasText: "Hoy no cabe" })).toBeVisible();
  await dialog.getByRole("button", { name: "Crear traslado" }).click();
  await expect(page).toHaveURL(/\/traslados$/);
  await expect(page.locator(".vc-transfers-needs")).toContainText(`Faltará espacio en ${diskName}`);

  // Leave the demo as it was for the next tests.
  const job = page.locator(".vc-transfers-list > li").first();
  await job.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar traslado" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("Cancelado");
  const stars = page.locator(".vc-transfers-destinations").getByRole("button", { name: "Quitar estrella" });
  while (await stars.count() > 0) {
    const before = await stars.count();
    await stars.first().click();
    await expect(stars).toHaveCount(before - 1);
  }
  await expect(page.locator(".vc-transfers-destinations")).toContainText("Ninguna todavía");
});

test("optional keywords make Agrupar archivos find more files", async ({ page }) => {
  await openView(page, "/traslados");
  await page.getByRole("textbox", { name: "Buscar carpeta para agrupar archivos" }).fill("boda");
  await page.locator(".vc-transfers-folder-results li").first().getByRole("button", { name: "Agrupar aquí" }).click();
  const session = page.getByRole("dialog", { name: "Sesión para agrupar archivos" });
  await expect(session.locator(".vc-review-pill")).toBeVisible();
  const before = Number((await session.locator(".vc-review-pill").textContent())!.replace(/\D/g, ""));
  await page.keyboard.press("Escape");

  const card = page.locator(".vc-starred-card", { hasText: "Boda" }).first();
  await card.locator(".vc-keywords").getByRole("button", { name: "Agregar" }).click();
  await card.getByRole("textbox", { name: "Nueva palabra clave" }).fill("Graduacion");
  await card.getByRole("textbox", { name: "Nueva palabra clave" }).press("Enter");
  await card.getByRole("button", { name: "Guardar" }).click();
  await expect(card.locator(".vc-keywords-list")).toContainText("Graduacion");

  await card.getByRole("button", { name: "Agrupar archivos" }).click();
  await expect(session.locator(".vc-review-pill")).toBeVisible();
  const after = Number((await session.locator(".vc-review-pill").textContent())!.replace(/\D/g, ""));
  expect(after).toBeGreaterThan(before);
  await page.keyboard.press("Escape");

  // Leave the demo as it was.
  const stars = page.locator(".vc-transfers-destinations").getByRole("button", { name: "Quitar estrella" });
  while (await stars.count() > 0) {
    const count = await stars.count();
    await stars.first().click();
    await expect(stars).toHaveCount(count - 1);
  }
});
