import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOrCreateCompanionIdentity } from "../../apps/agent-windows/src/identity.ts";

test("companion identity is random, persistent and stored in the agent state directory", async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-companion-"));
  try {
    const first = await loadOrCreateCompanionIdentity(stateRoot);
    const second = await loadOrCreateCompanionIdentity(stateRoot);

    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(second, first);
    assert.notEqual(first, crypto.randomUUID());

    const stored = JSON.parse(await fs.readFile(path.join(stateRoot, "companion-identity.json"), "utf8")) as {
      schemaVersion: number;
      companionId: string;
    };
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.companionId, first);
  } finally {
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

