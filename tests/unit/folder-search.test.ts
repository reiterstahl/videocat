import assert from "node:assert/strict";
import test from "node:test";
import { filterFolderNodes, matchesSearch } from "../../apps/web/src/lib/folder-search.ts";
import type { FolderGroupNode } from "../../apps/web/src/types.ts";

function folder(name: string, sizeBytes: number, children: FolderGroupNode[] = []): FolderGroupNode {
  return { key: name, name, kind: "folder", sizeBytes, fileCount: Math.max(1, children.length), locations: [], children };
}

test("search ignores case and accents", () => {
  assert.equal(matchesSearch("Vídeos de Playa", "videos"), true);
  assert.equal(matchesSearch("Montaña", "montana"), true);
  assert.equal(matchesSearch("Ciudad", "playa"), false);
  assert.equal(matchesSearch("anything", ""), true);
});

test("keeps matching folders whole and shrinks the ones that only lead to a match", () => {
  const playa = folder("Playa", 30, [folder("RAW", 20), folder("Edit", 10)]);
  const viajes = folder("Viajes", 100, [playa, folder("Ciudad", 70)]);
  const otros = folder("Otros", 50, [folder("Varios", 50)]);
  const files: FolderGroupNode = { ...folder("Archivos sueltos", 5), kind: "files" };
  const result = filterFolderNodes([viajes, otros, files], "playa");

  assert.equal(result.nodes.length, 1);
  const shrunk = result.nodes[0];
  assert.equal(shrunk.name, "Viajes");
  assert.equal(shrunk.sizeBytes, 30);
  assert.deepEqual(shrunk.children, [playa]);
  assert.equal(result.originals.get(shrunk), viajes);
  assert.equal(result.matches.has(playa), true);
  assert.equal(result.matches.has(shrunk), false);
});

test("an empty search keeps every block", () => {
  const nodes = [folder("A", 1), folder("B", 2)];
  const result = filterFolderNodes(nodes, "  ");
  assert.deepEqual(result.nodes, nodes);
  assert.equal(result.matches.size, 0);
});
