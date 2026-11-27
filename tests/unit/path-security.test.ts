import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalPathInsideRoot, cleanRelativePath, companionActionAllowed, safePathInsideRoot } from "../../apps/agent-windows/src/path-security.ts";

test("normalizes safe relative paths and rejects traversal", () => {
  assert.equal(cleanRelativePath("folder\\video.mp4"), "folder/video.mp4");
  assert.equal(cleanRelativePath("../video.mp4"), null);
  assert.equal(cleanRelativePath("folder/../../video.mp4"), null);
  assert.equal(safePathInsideRoot("/media/videos", "folder/video.mp4"), path.resolve("/media/videos/folder/video.mp4"));
  assert.equal(safePathInsideRoot("/media/videos", "../outside.mp4"), null);
});

test("rejects symlinks that escape a monitored root", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "videocat-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "videocat-outside-"));
  try {
    await writeFile(path.join(outside, "secret.mp4"), "secret");
    try {
      await symlink(path.join(outside, "secret.mp4"), path.join(root, "link.mp4"));
    } catch {
      context.skip("symbolic links are unavailable in this environment");
      return;
    }
    assert.equal(await canonicalPathInsideRoot(root, "link.mp4"), null);
    await mkdir(path.join(root, "inside"));
    await writeFile(path.join(root, "inside", "video.mp4"), "video");
    assert.equal(await canonicalPathInsideRoot(root, "inside/video.mp4"), path.join(root, "inside", "video.mp4"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a web page can open or delete only videos, and open any folder", () => {
  assert.equal(companionActionAllowed("open-file", "H:\\Videos\\viaje.MKV"), true);
  assert.equal(companionActionAllowed("delete-file", "/mnt/h/Videos/viaje.mp4"), true);
  for (const name of ["setup.exe", "run.bat", "atajo.lnk", "app.hta", "script.js", "sin-extension"]) {
    assert.equal(companionActionAllowed("open-file", `H:\\Videos\\${name}`), false, name);
    assert.equal(companionActionAllowed("delete-file", `H:\\Videos\\${name}`), false, name);
  }
  assert.equal(companionActionAllowed("open-folder", "H:\\Videos"), true);
});
