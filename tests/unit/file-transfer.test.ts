import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { copyHasStalled, safeName, uniqueDestinationPath } from "../../apps/agent-windows/src/file-transfer.ts";

test("sanitizes names and creates unique destinations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "videocat-transfer-"));
  try {
    assert.equal(safeName('A<>:"/\\|?* video.mp4'), "A_________ video.mp4");
    assert.equal(safeName(".."), "VideoCAT");
    const first = await uniqueDestinationPath(root, "Disk:", "video.mp4");
    await writeFile(first, "video");
    const second = await uniqueDestinationPath(root, "Disk:", "video.mp4");
    assert.equal(path.basename(second), "video-2.mp4");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects stalled copies using the configured threshold", () => {
  assert.equal(copyHasStalled(1_000, 1_999, 1_000), false);
  assert.equal(copyHasStalled(1_000, 2_000, 1_000), true);
});
