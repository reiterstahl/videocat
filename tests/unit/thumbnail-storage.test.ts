import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isStoragePermissionError, thumbnailStorageProblem } from "../../apps/server/src/lib/thumbnail-storage.ts";

test("thumbnail storage probe accepts a writable directory and leaves nothing behind", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-thumbs-"));
  try {
    assert.equal(await thumbnailStorageProblem(path.join(dir, "nested")), null);
    assert.deepEqual(await fs.readdir(path.join(dir, "nested")), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("thumbnail storage probe reports a path that cannot hold files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-thumbs-"));
  const file = path.join(dir, "not-a-dir");
  try {
    await fs.writeFile(file, "");
    assert.match(await thumbnailStorageProblem(file) ?? "", /^E[A-Z]+: /);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("only permission and read-only errors count as storage permission errors", () => {
  for (const code of ["EACCES", "EPERM", "EROFS"]) assert.equal(isStoragePermissionError(Object.assign(new Error(code), { code })), true);
  assert.equal(isStoragePermissionError(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" })), false);
  assert.equal(isStoragePermissionError(null), false);
});
