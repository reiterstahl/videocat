import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canCompanionTransition, type TransferState as ServerState } from "../../apps/server/src/lib/transfer-states.ts";
import {
  hashFile,
  processTransferItem,
  staleStagingFiles,
  stagingPathFor,
  type TransferContext,
  type TransferState,
  type TransferWorkItem
} from "../../apps/agent-windows/src/transfer-engine.ts";

type World = {
  base: string;
  sourceRoot: string;
  targetRoot: string;
  stagingDir: string;
  item: TransferWorkItem;
  digest: string;
  content: Buffer;
  mounted: Set<string>;
  history: TransferState[];
  pathTaken: Set<string>;
  context: (overrides?: Partial<TransferContext>) => TransferContext;
};

async function world(options: { size?: number } = {}): Promise<World> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "vc-transfer-"));
  const sourceRoot = path.join(base, "F");
  const targetRoot = path.join(base, "E");
  const stagingDir = path.join(base, "staging");
  await fs.mkdir(path.join(sourceRoot, "Proyectos", "Testing"), { recursive: true });
  await fs.mkdir(path.join(targetRoot, "Testing"), { recursive: true });
  const content = randomBytes(options.size ?? 300_000);
  const sourceFile = path.join(sourceRoot, "Proyectos", "Testing", "clip.mp4");
  await fs.writeFile(sourceFile, content);
  const stats = await fs.stat(sourceFile);
  const item: TransferWorkItem = {
    id: randomUUID(),
    jobId: randomUUID(),
    state: "pending",
    filename: "clip.mp4",
    sizeBytes: content.length,
    sha256: null,
    source: { diskId: "f", identifiers: ["disk-f"], name: "LaCie", relativePath: "Proyectos/Testing/clip.mp4", modifiedAt: stats.mtime.toISOString() },
    target: { diskId: "e", identifiers: ["disk-e"], name: "WD", folder: "Testing", relativePath: null }
  };
  const created: World = {
    base, sourceRoot, targetRoot, stagingDir, item, content,
    digest: createHash("sha256").update(content).digest("hex"),
    mounted: new Set(["disk-f", "disk-e"]),
    history: ["pending"],
    pathTaken: new Set(),
    context: (overrides = {}) => ({
      stagingDir,
      resolveRoot: (identifiers) => identifiers.includes("disk-f") && created.mounted.has("disk-f")
        ? sourceRoot
        : identifiers.includes("disk-e") && created.mounted.has("disk-e") ? targetRoot : null,
      freeSpace: async () => ({ freeBytes: 500_000_000_000, totalBytes: 1_000_000_000_000 }),
      // A fake server that enforces the real state machine and remembers the item.
      transition: async (current, to, extra) => {
        if (created.item.state !== current.state) return "conflict";
        if (!canCompanionTransition(current.state as ServerState, to as ServerState)) throw new Error(`illegal ${current.state} -> ${to}`);
        if (to === "delivering" && extra?.targetRelativePath && created.pathTaken.has(extra.targetRelativePath)) return "path_taken";
        if (to === "delivered" && extra?.sha256 !== created.item.sha256) throw new Error("delivered without the staged hash");
        created.item = {
          ...created.item,
          state: to,
          sha256: to === "pending" ? null : extra?.sha256 ?? created.item.sha256,
          target: extra?.targetRelativePath ? { ...created.item.target, relativePath: extra.targetRelativePath } : created.item.target
        };
        created.history.push(to);
        return "ok";
      },
      ...overrides
    })
  };
  return created;
}

async function verifiedCopies(w: World): Promise<string[]> {
  const places: string[] = [];
  const candidates = [path.join(w.sourceRoot, "Proyectos", "Testing", "clip.mp4"), stagingPathFor(w.stagingDir, w.item)];
  for (const entry of await fs.readdir(path.join(w.targetRoot, "Testing"))) candidates.push(path.join(w.targetRoot, "Testing", entry));
  for (const candidate of candidates) {
    try {
      if (!candidate.endsWith(".vcpart") && (await hashFile(candidate)) === w.digest) places.push(candidate);
    } catch {
      // Not there.
    }
  }
  return places;
}

async function runUntilSettled(w: World, context = w.context()): Promise<TransferState> {
  let state = w.item.state;
  for (let round = 0; round < 6; round += 1) {
    state = await processTransferItem(context, w.item);
    if (state === "done" || state === "duplicate") break;
  }
  return state;
}

test("a file reaches the destination through staging and leaves nothing behind", async () => {
  const w = await world();
  // Only the source drive is connected: the file waits, verified, in the staging folder.
  w.mounted = new Set(["disk-f"]);
  assert.equal(await processTransferItem(w.context(), w.item), "source_removed");
  assert.equal(w.item.sha256, w.digest);
  assert.deepEqual(await verifiedCopies(w), [stagingPathFor(w.stagingDir, w.item)]);

  w.mounted = new Set(["disk-e"]);
  assert.equal(await processTransferItem(w.context(), w.item), "done");
  assert.deepEqual(await verifiedCopies(w), [path.join(w.targetRoot, "Testing", "clip.mp4")]);
  assert.deepEqual(await fs.readdir(w.stagingDir), []);
  assert.deepEqual(w.history, ["pending", "staging", "staged", "source_removed", "delivering", "delivered", "done"]);
});

for (const point of ["staging:copied", "staged:reported", "source:removed", "delivering:reported", "target:copied", "delivered:reported", "staging:removed"]) {
  test(`stopping at "${point}" never loses the file and the transfer resumes`, async () => {
    const w = await world();
    let fired = false;
    const crashing = w.context({
      checkpoint: (name) => {
        if (name === point && !fired) {
          fired = true;
          throw new Error(`simulated stop at ${name}`);
        }
      }
    });
    await assert.rejects(processTransferItem(crashing, w.item), /simulated stop/);
    assert.ok((await verifiedCopies(w)).length >= 1, "a verified copy must exist after the stop");
    assert.equal(await runUntilSettled(w), "done");
    const copies = await verifiedCopies(w);
    assert.equal(copies.length, 1);
    assert.match(copies[0], /Testing[\\/]clip\.mp4$/);
    assert.equal((await fs.readdir(w.stagingDir)).length, 0);
  });
}

test("a source changed since the last scan is left untouched", async () => {
  const w = await world();
  await fs.utimes(path.join(w.sourceRoot, "Proyectos", "Testing", "clip.mp4"), new Date(), new Date(Date.now() + 60_000));
  assert.equal(await processTransferItem(w.context(), w.item), "pending");
  assert.equal((await verifiedCopies(w)).length, 1);
  await assert.rejects(fs.access(w.stagingDir + "/" + w.item.id + ".mp4"));
});

test("the staging folder always keeps 5 % of the local disk free", async () => {
  const w = await world();
  const full = w.context({ freeSpace: async () => ({ freeBytes: 50_000_000 + w.content.length - 1, totalBytes: 1_000_000_000 }) });
  assert.equal(await processTransferItem(full, w.item), "pending");
  assert.deepEqual(w.history, ["pending", "pending"]);
});

test("a corrupted staging copy keeps the source and starts over", async () => {
  const w = await world();
  w.mounted = new Set(["disk-f"]);
  await assert.rejects(processTransferItem(w.context({ checkpoint: (name) => { if (name === "staged:reported") throw new Error("stop"); } }), w.item));
  await fs.writeFile(stagingPathFor(w.stagingDir, w.item), Buffer.from("corrupted"));
  assert.equal(await processTransferItem(w.context(), w.item), "pending");
  assert.ok((await fs.stat(path.join(w.sourceRoot, "Proyectos", "Testing", "clip.mp4"))).size === w.content.length);
});

test("a different file with the same name is never overwritten", async () => {
  const w = await world();
  await fs.writeFile(path.join(w.targetRoot, "Testing", "clip.mp4"), Buffer.from("someone else"));
  assert.equal(await runUntilSettled(w), "done");
  assert.equal(await fs.readFile(path.join(w.targetRoot, "Testing", "clip.mp4"), "utf8"), "someone else");
  assert.equal(await hashFile(path.join(w.targetRoot, "Testing", "clip (2).mp4")), w.digest);
});

test("a catalogued path is skipped even when the file is not on disk", async () => {
  const w = await world();
  w.pathTaken.add("Testing/clip.mp4");
  assert.equal(await runUntilSettled(w), "done");
  assert.equal(w.item.target.relativePath, "Testing/clip (2).mp4");
});

test("an identical file at the destination ends as duplicate without copying", async () => {
  const w = await world();
  await fs.writeFile(path.join(w.targetRoot, "Testing", "clip.mp4"), w.content);
  assert.equal(await runUntilSettled(w), "duplicate");
  assert.deepEqual(await fs.readdir(path.join(w.targetRoot, "Testing")), ["clip.mp4"]);
  assert.deepEqual(await fs.readdir(w.stagingDir), []);
});

test("a destination without room waits until space is freed", async () => {
  const w = await world();
  let free = 1_000;
  const context = w.context({ freeSpace: async (directory) => directory.startsWith(w.stagingDir) ? { freeBytes: 500_000_000_000, totalBytes: 1_000_000_000_000 } : { freeBytes: free, totalBytes: 2_000_000_000 } });
  assert.equal(await processTransferItem(context, w.item), "blocked_space");
  assert.equal((await verifiedCopies(w)).length, 1);
  free = 1_000_000_000;
  assert.equal(await processTransferItem(context, w.item), "done");
});

test("leftover staging copies are only cleared for finished transfers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-staging-"));
  const finished = randomUUID();
  const active = randomUUID();
  await fs.writeFile(path.join(dir, `${finished}.mp4`), "a");
  await fs.writeFile(path.join(dir, `${active}.mov`), "b");
  await fs.writeFile(path.join(dir, "notes.txt"), "c");
  const stale = await staleStagingFiles(dir, async () => new Map([[finished, "done"], [active, "source_removed"]]));
  assert.deepEqual(stale.map((file) => path.basename(file)), [`${finished}.mp4`]);
});
