import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configFrom, normalizeConfig, parseEnvText, readEnvFile, serializeTargets, writeConfig } from "../../apps/agent-windows/src/config-store.ts";
import { handleTrayRequest, parseTrayApiLine, trayApiLine, type TrayApiContext } from "../../apps/agent-windows/src/tray-api.ts";

process.env.VIDEOCAT_LANGUAGE = "es";
const trayToken = "t".repeat(48);

type World = { base: string; configPath: string; drive: string; port: number; close: () => Promise<void>; server: http.Server };

// The agent's listener with only the tray API, a settings file, and a folder that plays a drive.
async function world(serverUrl = "http://127.0.0.1:9"): Promise<World> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-tray-api-"));
  const configPath = path.join(base, "settings", ".env");
  const drive = path.join(base, "drive-h");
  await fs.mkdir(drive);
  await fs.mkdir(path.join(drive, "Videos"));
  await fs.writeFile(path.join(drive, "Videos", "a.mp4"), "12345");
  await writeConfig(configPath, normalizeConfig({
    SERVER_URL: serverUrl,
    AGENT_TOKEN: "shared-token",
    COMPANION_MONITORED_TARGETS: serializeTargets([{ id: "letter-route", name: "Old H", path: drive, enabled: true }])
  }));
  const context: TrayApiContext = {
    configPath,
    driveRoots: () => [drive, path.join(base, "missing")],
    isDriveRoot: (value) => path.resolve(value) === path.resolve(drive),
    server: () => ({ url: serverUrl, credential: "shared-token" }),
    defaultStateRoot: path.join(base, "state"),
    version: 24
  };
  process.env.VIDEOCAT_TRAY_TOKEN = trayToken;
  const server = http.createServer((request, response) => void handleTrayRequest(request, response, context));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { base, configPath, drive, port, server, close: async () => { server.close(); await fs.rm(base, { recursive: true, force: true }); } };
}

async function call(w: World, method: string, route: string, body?: unknown, headers: Record<string, string> = { "X-VideoCat-Tray-Token": trayToken }) {
  const response = await fetch(`http://127.0.0.1:${w.port}${route}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("the tray announces where the agent listens in one line", () => {
  assert.equal(parseTrayApiLine(trayApiLine(29431)), 29431);
  assert.equal(parseTrayApiLine("@@videocat-status {}"), null);
  assert.equal(parseTrayApiLine("@@videocat-api {\"port\":70000}"), null);
});

test("settings files keep quoted values and get a browser token when theirs is weak", () => {
  const values = normalizeConfig({ SERVER_URL: "http://x", COMPANION_DOWNLOAD_DIR: "C:\\Users\\Ana María\\Videos \"2024\"" });
  assert.ok(values.COMPANION_TOKEN.length >= 16);
  assert.equal(values.COMPANION_PORT, "29429");
  assert.equal(parseEnvText('A="C:\\\\x \\"y\\""\nB=plain\n# c=1\n').A, 'C:\\x "y"');
  assert.equal(configFrom({}).TRAY_CLICK_ACTION, "open");
});

test("only the tray's token opens the tray API, and never from a web page", async () => {
  const w = await world();
  try {
    assert.equal((await call(w, "GET", "/tray/config", undefined, {})).status, 403);
    assert.equal((await call(w, "GET", "/tray/config", undefined, { "X-VideoCat-Tray-Token": "x".repeat(48) })).status, 403);
    assert.equal((await call(w, "GET", "/tray/config", undefined, { "X-VideoCat-Tray-Token": trayToken, Origin: "https://evil.example" })).status, 403);
    // The browser's token is not the tray's.
    assert.equal((await call(w, "GET", "/tray/config", undefined, { "X-VideoCat-Companion-Token": trayToken })).status, 403);
    const ok = await call(w, "GET", "/tray/config");
    assert.equal(ok.status, 200);
    assert.equal((ok.body.values as Record<string, string>).AGENT_TOKEN, "shared-token");
    assert.equal((await call(w, "GET", "/tray/nothing")).status, 404);
  } finally {
    await w.close();
  }
});

test("settings are checked before they are saved, and a whole drive cannot be added by its letter", async () => {
  const w = await world();
  try {
    const current = (await call(w, "GET", "/tray/config")).body.values as Record<string, string>;
    const missing = await call(w, "PUT", "/tray/config", { values: { ...current, SERVER_URL: "" } });
    assert.equal(missing.body.ok, false);
    assert.match(String(missing.body.message), /SERVER_URL es obligatorio/);

    const byLetter = serializeTargets([{ id: "letter-route", name: "Old H", path: w.drive }, { id: "new", name: "New", path: w.drive }]);
    const refused = await call(w, "PUT", "/tray/config", { values: { ...current, COMPANION_MONITORED_TARGETS: byLetter } });
    assert.equal(refused.body.ok, false);
    assert.match(String(refused.body.message), /Añadir unidad/);

    const saved = await call(w, "PUT", "/tray/config", { values: { ...current, COMPANION_NAME: "Oficina" } });
    assert.equal(saved.body.ok, true);
    assert.equal((await readEnvFile(w.configPath))?.COMPANION_NAME, "Oficina");
    // Paired with this server, no shared token is needed.
    const paired = await call(w, "PUT", "/tray/config", { values: { ...current, AGENT_TOKEN: "" }, pairedServerUrl: "http://127.0.0.1:9" });
    assert.equal(paired.body.ok, true);
  } finally {
    await w.close();
  }
});

test("a pinned identity keeps the catalog of the route that followed the letter", async () => {
  // The VideoCAT server's catalog sample for that route.
  const catalog = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer shared-token");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ disk: { name: "WD Elements" }, totalFiles: 1, files: [{ relativePath: "Videos/a.mp4", sizeBytes: 5 }] }));
  });
  await new Promise<void>((resolve) => catalog.listen(0, "127.0.0.1", resolve));
  const w = await world(`http://127.0.0.1:${(catalog.address() as { port: number }).port}`);
  try {
    const drives = (await call(w, "GET", "/tray/drives")).body.drives as Array<{ root: string; diskId?: string }>;
    assert.deepEqual(drives.map((drive) => [drive.root, drive.diskId ?? null]), [[w.drive, null]]);
    const check = await call(w, "POST", "/tray/drives/check-identity", { targetId: "letter-route", root: w.drive });
    assert.equal((check.body.check as { verdict: string }).verdict, "match");
    const pinned = await call(w, "POST", "/tray/drives/pin-identity", { targetId: "letter-route", root: w.drive, name: "WD Elements" });
    assert.equal(pinned.body.ok, true);
    assert.equal(pinned.body.diskId, "letter-route");
    assert.equal(JSON.parse(await fs.readFile(path.join(w.drive, ".videocat-disk.json"), "utf8")).diskId, "letter-route");
    // The route by letter became the marker: it leaves the settings.
    assert.equal((await readEnvFile(w.configPath))?.COMPANION_MONITORED_TARGETS, "[]");
    const mounted = (await call(w, "GET", "/tray/drives/mounted")).body.disks as Array<{ marker: { diskName: string } }>;
    assert.deepEqual(mounted.map((disk) => disk.marker.diskName), ["WD Elements"]);
    // A drive with a marker cannot be converted again.
    const again = await call(w, "POST", "/tray/drives/convert", { root: w.drive, name: "Otro" });
    assert.equal(again.body.ok, false);
  } finally {
    await w.close();
    catalog.close();
  }
});

test("converting a drive writes its marker and pauses a route by letter that pointed at it", async () => {
  const w = await world();
  try {
    const converted = await call(w, "POST", "/tray/drives/convert", { root: w.drive, name: "Nuevo disco" });
    assert.equal(converted.body.ok, true);
    assert.deepEqual(converted.body.pausedTargetIds, ["letter-route"]);
    const targets = JSON.parse((await readEnvFile(w.configPath))?.COMPANION_MONITORED_TARGETS ?? "[]") as Array<{ enabled: boolean }>;
    assert.equal(targets[0].enabled, false);
    assert.equal((await call(w, "POST", "/tray/drives/convert", { root: w.drive, name: "  " })).body.ok, false);
  } finally {
    await w.close();
  }
});

test("pairing hands the credential to the tray and writes nothing", async () => {
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as { code: string; version: number };
    response.writeHead(body.code === "ABCDE-23456" ? 200 : 400, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body.code === "ABCDE-23456" ? { credential: "secret-credential", issuedAt: "2026-10-29T00:00:00.000Z" } : { message: "Código vencido" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const w = await world(serverUrl);
  try {
    const before = await fs.readFile(w.configPath, "utf8");
    const values = { ...((await call(w, "GET", "/tray/config")).body.values as Record<string, string>), SERVER_URL: serverUrl };
    const paired = await call(w, "POST", "/tray/pair", { code: "ABCDE-23456", values });
    assert.equal(paired.body.ok, true);
    assert.equal(paired.body.credential, "secret-credential");
    assert.equal(paired.body.serverUrl, serverUrl);
    assert.equal(await fs.readFile(w.configPath, "utf8"), before);
    const refused = await call(w, "POST", "/tray/pair", { code: "WRONG", values });
    assert.deepEqual(refused.body, { ok: false, message: "Código vencido" });
  } finally {
    await w.close();
    server.close();
  }
});

test("drive health says it is only for Windows elsewhere", { skip: process.platform === "win32" }, async () => {
  const w = await world();
  try {
    assert.deepEqual((await call(w, "GET", "/tray/health")).body, { supported: false, installed: false, administrator: false, lastCheckedAt: null });
    assert.equal((await call(w, "POST", "/tray/health/enable")).body.ok, false);
  } finally {
    await w.close();
  }
});
