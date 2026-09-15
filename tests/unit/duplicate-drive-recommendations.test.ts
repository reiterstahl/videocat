import assert from "node:assert/strict";
import test from "node:test";
import { recommendDuplicateDrives, type DuplicateDriveCandidate } from "../../apps/server/src/lib/duplicate-drive-recommendations.ts";

function candidate(overrides: Partial<DuplicateDriveCandidate> & Pick<DuplicateDriveCandidate, "id" | "diskId" | "diskName">): DuplicateDriveCandidate {
  return {
    filename: `${overrides.id}.mp4`,
    sizeBytes: 1_000,
    durationSeconds: 60,
    width: 1280,
    height: 720,
    visualFingerprint: null,
    driveLetter: null,
    volumeLabel: null,
    totalBytes: null,
    curationStatus: "none",
    categoryKeys: [],
    ...overrides
  };
}

test("prioritizes disks with duplicate files already marked for deletion", () => {
  const files = [
    candidate({ id: "best", diskId: "disk-a", diskName: "A", width: 1920, height: 1080 }),
    candidate({ id: "ready", diskId: "disk-b", diskName: "B", sizeBytes: 1_000, curationStatus: "delete" }),
    candidate({ id: "pending", diskId: "disk-c", diskName: "C", sizeBytes: 1_000 })
  ];

  const result = recommendDuplicateDrives(files, new Set(["disk-b"]));

  assert.equal(result.groupCount, 1);
  assert.equal(result.totalRecoverableBytes, 2_000);
  assert.equal(result.disks[0].diskId, "disk-b");
  assert.equal(result.disks[0].readyBytes, 1_000);
  assert.equal(result.disks[0].connected, true);
  assert.equal(result.disks[1].pendingBytes, 1_000);
});

test("never recommends deleting files explicitly marked to keep", () => {
  const files = [
    candidate({ id: "kept-a", diskId: "disk-a", diskName: "A", categoryKeys: ["keep"] }),
    candidate({ id: "kept-b", diskId: "disk-b", diskName: "B", categoryKeys: ["keep"] }),
    candidate({ id: "delete", diskId: "disk-c", diskName: "C", curationStatus: "delete" })
  ];

  const result = recommendDuplicateDrives(files, new Set());

  assert.deepEqual(result.disks.map((disk) => disk.diskId), ["disk-c"]);
  assert.equal(result.totalReadyBytes, 1_000);
});
