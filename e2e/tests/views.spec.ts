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

test("instant search on the folder map keeps only matching blocks", async ({ page }) => {
  await openView(page, "/uso-por-carpeta");
  const tiles = page.locator(".vc-folders-canvas .vc-folder-tile");
  await expect(tiles.first()).toBeVisible();
  const before = await tiles.count();
  const name = ((await page.locator(".vc-folder-tile.is-depth-1 .vc-folder-tile-label strong").first().textContent()) ?? "").trim();
  const search = page.getByLabel("Buscar en el mapa");
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill(name.toUpperCase());
  await expect(page.locator(".vc-folder-tile.is-match").first()).toBeVisible();
  await expect.poll(() => tiles.count()).toBeLessThan(before);
  await expect(page.locator(".vc-folders-status")).toContainText("coincide");
  await search.fill("zzz-no-existe");
  await expect(page.locator(".vc-folders-no-match")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect.poll(() => tiles.count()).toBe(before);
});

test("connected drives are listed first in the drive strip", async ({ page }) => {
  await openView(page, "/catalogo");
  const disks = (await (await page.request.get("/api/disks")).json()).disks as Array<{ id: string; name: string }>;
  const last = [...disks].sort((left, right) => left.name.localeCompare(right.name)).at(-1)!;
  await page.route("**/api/companion/status", (route) => route.fulfill({
    json: { online: true, version: 999, mountedDiskCount: 1, mountedDiskIds: [last.id], lastSeenAt: new Date().toISOString(), agents: [] }
  }));
  await page.getByRole("button", { name: "Mostrar conectados" }).click();
  const first = page.locator(".vc-disk-strip .vc-disk-chip").first();
  await expect(first.locator(".vc-disk-name")).toHaveText(last.name);
  await expect(first.locator(".vc-disk-dot")).toHaveClass(/is-mounted/);
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

test("a disconnected drive offers to remove it, behind typing ELIMINAR", async ({ page }) => {
  await openView(page, "/administracion");
  const card = page.locator(".vc-admin-disk", { hasText: "Desconectado" }).first();
  await card.getByRole("button", { name: "Eliminar unidad" }).click();
  const form = card.locator(".vc-danger-confirm");
  await expect(form).toContainText("No toca ningún archivo");
  const confirm = form.locator("button[type=submit]");
  await expect(confirm).toHaveText("Eliminar unidad");
  await form.locator("input").fill("BORRAR");
  await expect(confirm).toBeDisabled();
  await form.locator("input").fill("ELIMINAR");
  await expect(confirm).toBeEnabled();
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(form).toHaveCount(0);
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

test("profile saves the read-ahead for Companion playback on the server", async ({ page }) => {
  await openView(page, "/perfil");
  const buffer = page.getByLabel("Lectura anticipada");
  await expect(buffer).toHaveValue("32");
  await buffer.selectOption("64");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Perfil actualizado.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Lectura anticipada")).toHaveValue("64");
  await page.getByLabel("Lectura anticipada").selectOption("32");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Perfil actualizado.")).toBeVisible();
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

  // Hovering shows the path; a click enters the folder, deeper clicks reach its videos.
  const tile = page.locator(".vc-folder-tile.is-group", { hasText: name }).first();
  // Subfolders cover the body of a parent block; its title strip is the folder itself.
  await tile.hover({ position: { x: 10, y: 6 } });
  await expect(page.locator(".vc-folders-status strong")).toContainText(name);
  await tile.click({ position: { x: 10, y: 6 } });
  const trail = page.getByRole("navigation", { name: "Ruta de exploración" });
  await expect(trail.locator('[aria-current="page"]')).toHaveText(name);
  await expect(page).toHaveURL(/\/uso-por-carpeta$/);
  for (let level = 0; level < 6 && (await page.locator(".vc-file-tile").count()) === 0; level += 1) {
    const next = page.locator(".vc-folder-tile:not(.is-rest)").first();
    await expect(next).toBeVisible();
    await next.click({ position: { x: 10, y: 6 } });
    await page.waitForTimeout(150);
  }
  const video = page.locator(".vc-file-tile").first();
  await expect(video).toBeVisible();
  expect(await trail.locator("li").count()).toBeGreaterThan(2);

  // A click on a video opens it; Backspace goes up one level.
  await video.click();
  await expect(page.locator(".vc-detail, .detail-panel").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".vc-file-tile")).toHaveCount(0);

  // "Ir al catálogo" moved to the right click menu.
  await trail.getByRole("button", { name: "Todas las carpetas" }).click();
  await tile.click({ button: "right", position: { x: 10, y: 6 } });
  await page.getByRole("menu").getByRole("menuitem", { name: "Ir al catálogo" }).click();
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
  // Hovering a drive shows what is still due on it.
  await page.locator(".vc-transfers-needs .vc-need").first().hover();
  const due = page.locator(".vc-transfers-needs .vc-need-popover").first();
  await expect(due).toBeVisible();
  await expect(due.locator(".is-outgoing")).toContainText("de este disco");
  await expect(due.locator(".is-outgoing li").first()).toBeVisible();

  await job.getByRole("button", { name: "Pausar" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("En pausa");
  await job.getByRole("button", { name: "Reanudar" }).click();
  await expect(job.locator(".vc-badge")).toHaveText("En curso");
  await job.locator(".vc-transfers-expand").click();
  await expect(job.locator(".vc-transfers-items li").first()).toContainText("Esperando el disco de origen");

  // The catalog marks the files that are on their way.
  await openView(page, "/uso-por-carpeta");
  await page.locator(".vc-folders-list > li", { has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) }).getByRole("button", { name: "Ir al catálogo" }).click();
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

test("a right click marks a folder as favorite and its videos are no longer offered to move", async ({ page }) => {
  await openView(page, "/uso-por-carpeta");
  const group = page.locator(".vc-folders-list > li:not(.is-excluded)").first();
  const name = (await group.locator(".vc-folders-item-head strong").textContent())!.trim();
  const tile = page.locator(".vc-folder-tile.is-group", { hasText: name }).first();
  await tile.click({ button: "right", position: { x: 10, y: 6 } });
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: /Marcar como favorita/ }).click();
  await expect(page.locator(".vc-notice")).toContainText("Carpeta favorita");
  await expect(tile.locator(".vc-favorite-mark")).toBeVisible();
  await expect(group.locator(".vc-favorite-button.is-on").first()).toBeVisible();

  // Consolidating that group finds nothing to move: every location is a favorite.
  await group.locator(".vc-folders-locations li").first().getByRole("button", { name: /Marcar con estrella/ }).click();
  await group.getByRole("button", { name: /^Consolidar en / }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("En carpetas favoritas");
  await expect(dialog.getByRole("button", { name: "Crear traslado" })).toBeDisabled();
  await dialog.locator(".delete-confirm-actions").getByRole("button", { name: "Cancelar" }).click();

  await tile.click({ button: "right", position: { x: 10, y: 6 } });
  await menu.getByRole("menuitem", { name: "Quitar de favoritas" }).click();
  await expect(page.locator(".vc-notice")).toContainText("quitada de favoritas");
  await expect(tile.locator(".vc-favorite-mark")).toHaveCount(0);
  await group.locator(".vc-folders-locations li").first().getByRole("button", { name: /Quitar estrella/ }).click();
});

test("a tag rule sends tagged videos to a starred folder and can be removed", async ({ page }) => {
  await openView(page, "/traslados");
  // A starred folder to receive them.
  await page.getByRole("textbox", { name: "Buscar carpeta para agrupar archivos" }).fill("boda");
  await page.locator(".vc-transfers-folder-results li").first().getByRole("button", { name: "Agrupar aquí" }).click();
  const session = page.getByRole("dialog", { name: "Sesión para agrupar archivos" });
  await expect(session.locator(".vc-review-heading")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(session).toHaveCount(0);
  await expect(page.locator(".vc-starred-card").first()).toBeVisible();

  const section = page.getByRole("region", { name: "Mover por etiqueta" });
  const tagSelect = section.getByRole("combobox", { name: "Etiqueta para mover" });
  const options = await tagSelect.locator("option").allTextContents();
  expect(options).not.toContain("Marcado para borrar");
  await tagSelect.selectOption({ label: "Mantener" });
  await section.getByRole("combobox", { name: "Carpeta destino de la etiqueta" }).selectOption({ index: 1 });
  await section.getByRole("button", { name: "Crear regla" }).click();
  await expect(section.locator(".vc-notice")).toContainText("Regla creada");
  await expect(section.locator(".vc-tag-rules li")).toHaveCount(1);
  const running = page.getByRole("region", { name: "Traslados en curso" });
  await running.getByRole("button", { name: /^Etiqueta/ }).click();
  await expect(running.locator(".vc-transfers-list > li").first()).toContainText("Etiqueta");
  await running.getByRole("button", { name: /^Todos/ }).click();

  await section.getByRole("button", { name: "Quitar regla" }).click();
  await expect(section.locator(".vc-notice")).toContainText("Regla quitada");
  await expect(section.locator(".vc-tag-rules li")).toHaveCount(0);

  const stars = page.locator(".vc-transfers-destinations").getByRole("button", { name: "Quitar estrella" });
  while (await stars.count() > 0) {
    const count = await stars.count();
    await stars.first().click();
    await expect(stars).toHaveCount(count - 1);
  }
});

test("a drive can be renamed for everyone and keeps that name", async ({ page }) => {
  await openView(page, "/administracion");
  const card = page.locator(".vc-admin-disk").first();
  const original = (await card.locator("header strong").textContent())!.trim();
  // The pencil sits right after the name, on the same line.
  const nameBox = (await card.locator(".vc-admin-disk-name span").boundingBox())!;
  const pencilBox = (await card.locator(".vc-admin-rename-button").boundingBox())!;
  expect(pencilBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);
  expect(Math.abs(pencilBox.y + pencilBox.height / 2 - (nameBox.y + nameBox.height / 2))).toBeLessThan(8);
  await card.getByRole("button", { name: `Cambiar el nombre de ${original}` }).click();
  await card.getByRole("textbox", { name: "Nombre del disco" }).fill("Disco del cliente");
  await card.getByRole("button", { name: "Guardar" }).click();
  await expect(card.locator("header strong")).toHaveText("Disco del cliente");
  await expect(card).toContainText("nombre elegido");
  // The new name is what the rest of VideoCAT shows.
  await openView(page, "/catalogo");
  await expect(page.locator(".vc-disk-chip", { hasText: "Disco del cliente" }).first()).toBeVisible();

  await openView(page, "/administracion");
  await page.getByRole("button", { name: "Cambiar el nombre de Disco del cliente" }).click();
  const editing = page.locator(".vc-admin-rename");
  await editing.getByRole("textbox", { name: "Nombre del disco" }).fill(original);
  await editing.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".vc-admin-disk", { hasText: original }).first()).toBeVisible();
});
