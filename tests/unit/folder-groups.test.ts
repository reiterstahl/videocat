import assert from "node:assert/strict";
import test from "node:test";

import { buildFolderGroups, normalizeFolderName, type FolderGroupFile, type FolderGroupNode } from "../../apps/server/src/lib/folder-groups.ts";

const GB = 1_000_000_000;
const file = (diskId: string, relativePath: string, gigabytes: number): FolderGroupFile => ({
  diskId, diskName: diskId === "e" ? "WD" : diskId === "f" ? "LaCie" : "Toshiba", relativePath, sizeBytes: gigabytes * GB
});
const root = (map: ReturnType<typeof buildFolderGroups>, key: string) => map.roots.find((node) => node.key === key);
const total = (nodes: FolderGroupNode[]) => nodes.reduce((sum, node) => sum + node.sizeBytes, 0);

test("folder names are compared without case or accents", () => {
  assert.equal(normalizeFolderName(" Vacaciónes "), "vacaciones");
  assert.equal(normalizeFolderName("TESTING"), normalizeFolderName("testing"));
});

test("same-named folders merge across drives and depths, counting each byte once", () => {
  const map = buildFolderGroups([
    file("e", "Testing/a.mp4", 1200),
    file("e", "Testing/RAW/b.mp4", 500),
    file("f", "Proyectos/Testing/c.mp4", 230),
    file("f", "Proyectos/Cliente/d.mp4", 40),
    file("g", "suelto.mp4", 2)
  ]);
  const testing = root(map, "g:testing")!;
  assert.equal(testing.kind, "group");
  assert.equal(testing.sizeBytes, 1930 * GB);
  assert.deepEqual(testing.locations.map((location) => `${location.diskId}:${location.path}`), ["e:Testing", "f:Proyectos/Testing"]);
  // Proyectos keeps only what is not merged into Testing.
  const proyectos = map.roots.find((node) => node.name === "Proyectos")!;
  assert.equal(proyectos.sizeBytes, 40 * GB);
  assert.equal(root(map, "r:g")!.sizeBytes, 2 * GB);
  assert.equal(total(map.roots), map.sizeBytes);
  assert.deepEqual(map.repeated.map((group) => group.name), ["Testing"]);
});

test("children keep the bytes of loose files so tiles add up", () => {
  const map = buildFolderGroups([
    file("e", "Testing/a.mp4", 10),
    file("e", "Testing/RAW/b.mp4", 5),
    file("f", "Testing/RAW/c.mp4", 3)
  ]);
  const testing = root(map, "g:testing")!;
  assert.equal(total(testing.children), testing.sizeBytes);
  const raw = testing.children.find((child) => child.name === "RAW")!;
  assert.deepEqual(raw.locations.map((location) => location.path).sort(), ["Testing/RAW", "Testing/RAW"]);
  assert.equal(testing.children.find((child) => child.kind === "files")!.sizeBytes, 10 * GB);
});

test("excluded names stay apart in their own location and are listed as excluded", () => {
  const files = [file("e", "2019/a.mp4", 5), file("f", "2019/b.mp4", 7), file("f", "Viajes/2019/c.mp4", 1)];
  const merged = buildFolderGroups(files);
  assert.equal(root(merged, "g:2019")!.sizeBytes, 13 * GB);
  const apart = buildFolderGroups(files, { excludedNames: ["2019"] });
  assert.equal(root(apart, "g:2019"), undefined);
  assert.deepEqual(apart.roots.map((node) => `${node.name}:${node.sizeBytes / GB}`).sort(), ["2019:5", "2019:7", "Viajes:1"]);
  assert.deepEqual(apart.repeated.map((group) => [group.name, group.excluded]), [["2019", true]]);
  assert.equal(total(apart.roots), apart.sizeBytes);
});

test("large levels keep the biggest folders and fold the rest into one tile", () => {
  const files = Array.from({ length: 8 }, (_, index) => file("e", `Archivo/Carpeta ${index}/a.mp4`, index + 1));
  const map = buildFolderGroups(files, { maxChildren: 3 });
  const archivo = map.roots[0];
  assert.deepEqual(archivo.children.map((child) => child.kind), ["folder", "folder", "folder", "rest"]);
  assert.equal(total(archivo.children), archivo.sizeBytes);
  assert.equal(archivo.children[3].name, "5 carpetas más");
});
