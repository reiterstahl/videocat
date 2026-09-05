import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalPathInsideRoot, cleanRelativePath, safePathInsideRoot } from "../../apps/agent-windows/src/path-security.ts";

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
