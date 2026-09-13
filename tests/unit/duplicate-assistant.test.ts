import assert from "node:assert/strict";
import test from "node:test";
import {
  compareDuplicateQuality,
  isBetterDuplicateMetric,
  isPendingDuplicateContender,
  orderDuplicateContenders,
  recommendDuplicateKeep
} from "../../apps/web/src/lib/duplicate-assistant.ts";
import type { VideoFile } from "../../apps/web/src/types.ts";

function video(overrides: Partial<VideoFile> & Pick<VideoFile, "id">): VideoFile {
  return {
    id: overrides.id,
    diskId: "disk",
    filename: `${overrides.id}.mp4`,
    extension: ".mp4",
    absolutePath: `F:\\${overrides.id}.mp4`,
    relativePath: `${overrides.id}.mp4`,
    sizeBytes: 1_000,
    scanStatus: "ok",
    width: 1920,
    height: 1080,
    durationSeconds: 60,
    curationStatus: "none",
    categoryKeys: [],
    thumbnails: [],
    tags: [],
    duplicateCount: 2,
    isProbableDuplicate: true,
    ...overrides
  };
}

test("recommends the highest resolution before file size", () => {
  const hd = video({ id: "hd", sizeBytes: 4_000 });
  const uhd = video({ id: "uhd", width: 3840, height: 2160, sizeBytes: 2_000 });

  assert.ok(compareDuplicateQuality(uhd, hd) > 0);
  assert.deepEqual(recommendDuplicateKeep(hd, uhd), { fileId: "uhd", reason: "resolution" });
});

test("uses file size and then duration to break resolution ties", () => {
  const compact = video({ id: "compact", sizeBytes: 1_000, durationSeconds: 120 });
  const large = video({ id: "large", sizeBytes: 2_000, durationSeconds: 60 });
  const longer = video({ id: "longer", sizeBytes: 2_000, durationSeconds: 180 });

  assert.equal(recommendDuplicateKeep(compact, large).fileId, "large");
  assert.deepEqual(recommendDuplicateKeep(large, longer), { fileId: "longer", reason: "duration" });
  assert.equal(isBetterDuplicateMetric(longer, large, "duration"), true);
});

test("keeps an existing decision first and omits deletion candidates", () => {
  const recommended = video({ id: "recommended", width: 3840, height: 2160 });
  const kept = video({ id: "kept", curationStatus: "keep", categoryKeys: ["keep"] });
  const deleted = video({ id: "deleted", curationStatus: "delete", categoryKeys: ["delete"] });

  assert.equal(orderDuplicateContenders([recommended, kept])[0].id, "kept");
  assert.equal(isPendingDuplicateContender(kept), true);
  assert.equal(isPendingDuplicateContender(deleted), false);
});
