import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseTrayApiLine } from "../../apps/agent-windows/src/tray-api.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

// The real agent in companion mode, started the way the tray starts it.
test("the agent announces its port and answers the tray's token, never the browser's", { timeout: 60_000 }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-agent-tray-"));
  const trayToken = "a".repeat(64);
  const browserToken = "b".repeat(48);
  await fs.writeFile(path.join(base, ".env"), `COMPANION_TOKEN=${browserToken}\nCOMPANION_NAME=Prueba\n`);
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("apps/agent-windows/src/index.ts"), "companion"], {
    env: {
      ...process.env,
      COMPANION_PORT: String(await freePort()),
      COMPANION_TOKEN: browserToken,
      AGENT_STATE_DIR: path.join(base, "state"),
      VIDEOCAT_TRAY_TOKEN: trayToken,
      VIDEOCAT_CONFIG_PATH: path.join(base, ".env"),
      VIDEOCAT_LANGUAGE: "es",
      SERVER_URL: "",
      VIDEOCAT_PARENT_WATCH: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error(`no @@videocat-api line:\n${buffer}`)), 45_000);
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        for (const line of buffer.split(/\r?\n/)) {
          const found = parseTrayApiLine(line);
          if (found) {
            clearTimeout(timer);
            resolve(found);
          }
        }
      });
      child.once("exit", (code) => reject(new Error(`agent exited ${code}:\n${buffer}`)));
    });
    const get = (route: string, headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}${route}`, { headers });
    const config = await get("/tray/config", { "X-VideoCat-Tray-Token": trayToken });
    assert.equal(config.status, 200);
    assert.equal(((await config.json()) as { values: Record<string, string> }).values.COMPANION_NAME, "Prueba");
    assert.equal((await get("/tray/config", { "X-VideoCat-Companion-Token": browserToken })).status, 403);
    assert.equal((await get("/tray/config", { "X-VideoCat-Tray-Token": browserToken })).status, 403);
    // The browser's routes are as they were.
    assert.equal((await get("/health", {})).status, 200);
  } finally {
    child.kill();
    await fs.rm(base, { recursive: true, force: true });
  }
});
