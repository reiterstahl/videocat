import assert from "node:assert/strict";
import test from "node:test";

import { folderTreeLevel } from "../../apps/server/src/lib/folder-tree.ts";

const files = [
  { diskId: "d1", diskName: "WD", relativePath: "Familia/2019/a.mp4", sizeBytes: 100 },
  { diskId: "d2", diskName: "LaCie", relativePath: "Familia/2019/Viajes/b.mp4", sizeBytes: 50 },
  { diskId: "d1", diskName: "WD", relativePath: "Familia/c.mp4", sizeBytes: 10 },
  { diskId: "d1", diskName: "WD", relativePath: "Drone\\2022\\d.mp4", sizeBytes: 300 },
  { diskId: "d1", diskName: "WD", relativePath: "root.mp4", sizeBytes: 5 }
];

test("aggregates the first level across drives, largest first", () => {
  const level = folderTreeLevel(files, "");
  assert.equal(level.sizeBytes, 465);
  assert.equal(level.fileCount, 5);
  assert.equal(level.directFileCount, 1);
  assert.deepEqual(level.children.map((child) => [child.path, child.sizeBytes, child.fileCount, child.childFolderCount]), [
    ["Drone", 300, 1, 1],
    ["Familia", 160, 3, 1]
  ]);
});

test("descends into a prefix and splits bytes per drive", () => {
  const level = folderTreeLevel(files, "Familia");
  assert.equal(level.prefix, "Familia");
  assert.equal(level.directBytes, 10);
  const year = level.children[0];
  assert.equal(year.path, "Familia/2019");
  assert.equal(year.sizeBytes, 150);
  assert.equal(year.childFolderCount, 1);
  assert.deepEqual(year.disks.map((disk) => [disk.diskName, disk.sizeBytes]), [["WD", 100], ["LaCie", 50]]);
});

test("ignores files outside the prefix and tolerates leading slashes", () => {
  const level = folderTreeLevel(files, "/Drone/");
  assert.equal(level.prefix, "Drone");
  assert.deepEqual(level.children.map((child) => child.path), ["Drone/2022"]);
});
