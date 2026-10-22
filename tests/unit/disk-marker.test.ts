import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkIdentitySample,
  cleanDiskName,
  createDiskMarker,
  identityVerdict,
  isDriveRoot,
  markerFileName,
  renameDiskMarker
} from "../../apps/agent-windows/src/disk-marker.ts";

async function withDrive(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "videocat-drive-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("only whole drives are followed by a marker", () => {
  assert.equal(isDriveRoot("H:\\"), true);
  assert.equal(isDriveRoot("h:"), true);
  assert.equal(isDriveRoot("H:/"), true);
  assert.equal(isDriveRoot("H:\\Videos"), false);
  assert.equal(isDriveRoot("\\\\NAS\\Videos"), false);
  assert.equal(isDriveRoot("/media/disk"), false);
});

test("disk names are trimmed and bounded", () => {
  assert.equal(cleanDiskName("  WD   6TB  "), "WD 6TB");
  assert.equal(cleanDiskName("   "), null);
  assert.equal(cleanDiskName("x".repeat(81)), null);
});

test("the sample verdict tells the same drive, a mixed catalog and another drive apart", () => {
  assert.equal(identityVerdict(0, 0), "empty");
  assert.equal(identityVerdict(30, 30), "match");
  assert.equal(identityVerdict(24, 30), "match");
  assert.equal(identityVerdict(23, 30), "mixed");
  assert.equal(identityVerdict(6, 30), "mixed");
  assert.equal(identityVerdict(5, 30), "mismatch");
  assert.equal(identityVerdict(0, 30), "mismatch");
});

test("a sampled file matches only at the same path, inside the drive, with the same size", async () => {
  await withDrive(async (root) => {
    await mkdir(path.join(root, "Videos"));
    await writeFile(path.join(root, "Videos", "a.mp4"), "12345");
    await writeFile(path.join(root, "Videos", "b.mp4"), "123");
    const check = await checkIdentitySample(root, [
      { relativePath: "Videos/a.mp4", sizeBytes: 5 },
      { relativePath: "Videos/b.mp4", sizeBytes: 5 },
      { relativePath: "Videos/missing.mp4", sizeBytes: 5 },
      { relativePath: "../outside.mp4", sizeBytes: 5 }
    ], 1200);
    assert.deepEqual(check, { verdict: "mixed", checked: 4, matched: 1, totalFiles: 1200 });
  });
});

test("a marker is written once, read back and never replaced", async () => {
  await withDrive(async (root) => {
    const marker = await createDiskMarker(root, { diskId: "4a1c2e8e-3b5f-4c2d-9a0b-1e2f3a4b5c6d", diskName: " WD 6TB " }, new Date("2026-10-22T12:00:00Z"));
    assert.deepEqual(JSON.parse(await readFile(path.join(root, markerFileName), "utf8")), {
      schemaVersion: 1,
      diskId: "4a1c2e8e-3b5f-4c2d-9a0b-1e2f3a4b5c6d",
      diskName: "WD 6TB",
      createdAt: "2026-10-22T12:00:00.000Z",
      scanRoots: ["."]
    });
    assert.equal(marker.diskName, "WD 6TB");
    await assert.rejects(createDiskMarker(root, { diskId: "other", diskName: "Otro" }), /No lo sobrescribo/);
    assert.equal(JSON.parse(await readFile(path.join(root, markerFileName), "utf8")).diskId, "4a1c2e8e-3b5f-4c2d-9a0b-1e2f3a4b5c6d");
  });
});

test("routes saved by older builds keep their id when pinned, and bad input writes nothing", async () => {
  await withDrive(async (root) => {
    await assert.rejects(createDiskMarker(root, { diskId: "../x", diskName: "WD" }), /identificador/);
    await assert.rejects(createDiskMarker(root, { diskId: "ok-id", diskName: "  " }), /nombre/);
    assert.deepEqual(await readdir(root), []);
    const marker = await createDiskMarker(root, { diskId: "target-lx2k9-4f8a", diskName: "H:" });
    assert.equal(marker.diskId, "target-lx2k9-4f8a");
  });
});

test("a name chosen in the web replaces only diskName, atomically, and only for that disk", async () => {
  await withDrive(async (root) => {
    const original = {
      schemaVersion: 1,
      diskId: "disk-1",
      diskName: "WD 6TB",
      createdAt: "2026-01-01T00:00:00.000Z",
      scanRoots: ["Videos", "Archive"],
      notes: "garage shelf"
    };
    await writeFile(path.join(root, markerFileName), JSON.stringify(original));

    assert.deepEqual(await renameDiskMarker(root, "disk-1", "  RQR-04N-UCM "), { changed: true, previous: "WD 6TB", next: "RQR-04N-UCM" });
    assert.deepEqual(JSON.parse(await readFile(path.join(root, markerFileName), "utf8")), { ...original, diskName: "RQR-04N-UCM" });
    assert.deepEqual(await readdir(root), [markerFileName], "no temporary file is left behind");

    assert.deepEqual(await renameDiskMarker(root, "disk-1", "RQR-04N-UCM"), { changed: false });
    await assert.rejects(renameDiskMarker(root, "disk-2", "Otro"), /ya no es el del disco/);
    await assert.rejects(renameDiskMarker(root, "disk-1", " "), /no es válido/);
    assert.equal(JSON.parse(await readFile(path.join(root, markerFileName), "utf8")).diskName, "RQR-04N-UCM");
  });
});
