import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { processTransferItem, type TransferWorkItem } from "../../apps/agent-windows/src/transfer-engine";
import { openView } from "./helpers";

const agentToken = process.env.AGENT_TOKEN ?? "";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:5173";

// A Companion made of the real transfer engine working on temporary folders and the real agent API.
function simulatedCompanion(request: APIRequestContext, stagingDir: string, roots: Map<string, string>) {
  const companionId = randomUUID();
  const headers = { authorization: `Bearer ${agentToken}`, "x-videocat-companion-id": companionId };
  const agent = async <T>(url: string, data?: unknown): Promise<T> => {
    const response = data === undefined ? await request.get(url, { headers }) : await request.post(url, { headers, data });
    if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  return {
    agent,
    async run(mounted: string[]) {
      await agent("/api/agent/companion/heartbeat", {
        companionId,
        mountedDiskIds: mounted,
        staging: { configured: true, path: stagingDir, freeBytes: 400_000_000_000, totalBytes: 500_000_000_000 }
      });
      const { items } = await agent<{ items: TransferWorkItem[] }>(`/api/agent/transfers/work?mounted=${encodeURIComponent(mounted.join(","))}`);
      for (const item of items) {
        await processTransferItem({
          stagingDir,
          resolveRoot: (identifiers) => identifiers.filter((identifier) => mounted.includes(identifier)).map((identifier) => roots.get(identifier)).find(Boolean) ?? null,
          freeSpace: async () => ({ freeBytes: 400_000_000_000, totalBytes: 500_000_000_000 }),
          transition: async (current, to, extra) => {
            const response = await request.post(`/api/agent/transfers/items/${current.id}/transition`, { headers, data: { from: current.state, to, ...extra } });
            if (response.status() === 409) return (await response.text()).includes("path_taken") ? "path_taken" : "conflict";
            if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
            return "ok";
          }
        }, item);
      }
      return items.length;
    }
  };
}

test("a consolidation travels through a simulated Companion: source drive, staging, destination drive", async ({ page, request }) => {
  test.skip(!agentToken, "Needs AGENT_TOKEN to act as the Companion");
  const suffix = randomUUID().slice(0, 6);
  const folder = `Proyecto${suffix}`;
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "vc-e2e-transfer-"));
  const sourceRoot = path.join(base, "F");
  const targetRoot = path.join(base, "E");
  const stagingDir = path.join(base, "staging");
  const content = randomBytes(256 * 1024);
  const digest = createHash("sha256").update(content).digest("hex");
  await fs.mkdir(path.join(sourceRoot, folder), { recursive: true });
  await fs.mkdir(path.join(targetRoot, folder), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, folder, "toma-01.mp4"), content);
  await fs.writeFile(path.join(targetRoot, folder, "existente.mp4"), randomBytes(512 * 1024));

  const sourceVolume = `e2e-src-${suffix}`;
  const targetVolume = `e2e-dst-${suffix}`;
  const roots = new Map([[sourceVolume, sourceRoot], [targetVolume, targetRoot]]);
  const companion = simulatedCompanion(request, stagingDir, roots);
  const diskIds: string[] = [];

  try {
    // The Companion registers both drives and catalogs what is on them.
    for (const [name, volumeId, root] of [[`Origen ${suffix}`, sourceVolume, sourceRoot], [`Destino ${suffix}`, targetVolume, targetRoot]]) {
      const { disk } = await companion.agent<{ disk: { id: string } }>("/api/agent/register-disk", { name, volumeId, totalBytes: 1_000_000_000_000, freeBytes: 500_000_000_000 });
      diskIds.push(disk.id);
      const { scan } = await companion.agent<{ scan: { id: string } }>("/api/agent/scan/start", { diskId: disk.id, rootPath: root });
      const files = [];
      for (const entry of await fs.readdir(path.join(root, folder))) {
        const stats = await fs.stat(path.join(root, folder, entry));
        files.push({ filename: entry, extension: ".mp4", absolutePath: path.join(root, folder, entry), relativePath: `${folder}/${entry}`, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString(), status: "scanned" });
      }
      await companion.agent("/api/agent/files/batch", { scanId: scan.id, diskId: disk.id, files });
      await companion.agent("/api/agent/scan/finish", { scanId: scan.id });
    }

    // Star the larger location and consolidate the other one into it.
    await openView(page, "/uso-por-carpeta");
    await page.getByRole("textbox", { name: "Buscar carpeta repetida" }).fill(folder);
    const group = page.locator(".vc-folders-list > li", { hasText: folder });
    const targetRow = group.locator(".vc-folders-locations li", { hasText: `Destino ${suffix}` });
    await targetRow.getByRole("button", { name: /Marcar con estrella/ }).click();
    await group.getByRole("button", { name: /^Consolidar en / }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Crear traslado" }).click();
    await expect(page).toHaveURL(/\/traslados$/);
    await expect(page.locator(".vc-transfers-needs")).toContainText(`Conecta Origen ${suffix} para continuar`);

    // Only the source drive is connected: the file leaves it, verified, and waits in staging.
    expect(await companion.run([sourceVolume])).toBe(1);
    await expect(fs.access(path.join(sourceRoot, folder, "toma-01.mp4"))).rejects.toThrow();
    const staged = await fs.readdir(stagingDir);
    expect(staged).toHaveLength(1);
    expect(createHash("sha256").update(await fs.readFile(path.join(stagingDir, staged[0]))).digest("hex")).toBe(digest);

    await page.reload();
    const job = page.locator(".vc-transfers-list > li", { hasText: folder });
    await expect(page.locator(".vc-transfers-needs")).toContainText(`Conecta Destino ${suffix} para continuar`);
    await expect(job).toContainText("Esperando el disco de destino: 1");
    await expect(page.locator(".vc-transfers-staging")).toContainText(stagingDir);

    // The destination drive arrives: the file is delivered, verified, and the staging copy goes away.
    expect(await companion.run([targetVolume])).toBe(1);
    expect(createHash("sha256").update(await fs.readFile(path.join(targetRoot, folder, "toma-01.mp4"))).digest("hex")).toBe(digest);
    expect(await fs.readdir(stagingDir)).toEqual([]);

    await page.reload();
    await expect(job.locator(".vc-badge")).toHaveText("Terminado");
    await expect(job).toContainText("1 de 1 archivos");
    await expect(page.locator(".vc-transfers-needs")).toHaveCount(0);

    // The catalog now points at the destination drive.
    await openView(page, "/uso-por-carpeta");
    await page.getByRole("textbox", { name: "Buscar carpeta repetida" }).fill(folder);
    await expect(page.locator(".vc-folders-list > li", { hasText: folder })).toHaveCount(0);
  } finally {
    const listed = await request.get("/api/transfers/destinations").then((response) => response.json()).catch(() => ({ destinations: [] }));
    for (const destination of (listed.destinations ?? []) as Array<{ id: string; diskId: string }>) {
      if (diskIds.includes(destination.diskId)) await request.delete(`/api/transfers/destinations/${destination.id}`, { headers: { origin } }).catch(() => undefined);
    }
    for (const id of diskIds) {
      await request.delete(`/api/admin/disks/${id}/catalog`, { headers: { origin } }).catch(() => undefined);
    }
    await fs.rm(base, { recursive: true, force: true });
  }
});
