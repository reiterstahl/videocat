import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://videocat:videocat@localhost:5432/videocat";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough";
process.env.AGENT_TOKEN ??= "test-agent-token-that-is-long-enough";
process.env.ADMIN_PASSWORD ??= "test-password-12345";

const { findMoves, isCatalogObject, relativeKey } = await import("../../apps/server/src/lib/bucket-scan.ts");

const object = (key: string, etag: string | null = "e1", sizeBytes = 100) => ({ key, sizeBytes, etag, lastModified: new Date("2026-10-22T12:00:00Z") });
const row = (relativePath: string, storageEtag: string | null = "e1", sizeBytes = 100n) => ({ id: relativePath, relativePath, sizeBytes, modifiedAt: new Date("2026-01-01T00:00:00Z"), storageEtag });

test("only videos inside the prefix become catalog paths", () => {
  assert.equal(relativeKey("Peliculas/a.mp4", "Peliculas/"), "a.mp4");
  assert.equal(relativeKey("Otros/a.mp4", ""), "Otros/a.mp4");
  assert.equal(isCatalogObject(object("Peliculas/a.MP4"), "Peliculas/"), true);
  assert.equal(isCatalogObject(object("Peliculas/nota.txt"), "Peliculas/"), false);
  assert.equal(isCatalogObject(object("Peliculas/carpeta/"), "Peliculas/"), false);
  assert.equal(isCatalogObject(object("Peliculas/"), "Peliculas/"), false);
});

test("an object copied to a new key keeps the entry of the key that vanished", () => {
  const moves = findMoves([object("P/Archivo/viaje.mp4"), object("P/otro.mp4", "e2")], [row("viaje.mp4"), row("otro.mp4", "e2")], "P/");
  assert.deepEqual([...moves].map(([to, source]) => [to, source.relativePath]), [["Archivo/viaje.mp4", "viaje.mp4"]]);
});

test("a copy next to its still listed original is a new video", () => {
  const moves = findMoves([object("viaje.mp4"), object("copia/viaje.mp4")], [row("viaje.mp4")], "");
  assert.equal(moves.size, 0);
});

test("several vanished keys with the same content are told apart by name, or not moved", () => {
  const rows = [row("a/uno.mp4"), row("a/dos.mp4")];
  const byName = findMoves([object("b/uno.mp4"), object("b/dos.mp4")], rows, "");
  assert.deepEqual(Object.fromEntries([...byName].map(([to, source]) => [to, source.relativePath])), { "b/uno.mp4": "a/uno.mp4", "b/dos.mp4": "a/dos.mp4" });
  assert.equal(findMoves([object("b/tres.mp4")], rows, "").size, 0);
  assert.equal(findMoves([object("x.mp4", "e1", 101)], [row("y.mp4")], "").size, 0, "a different size is another object");
  assert.equal(findMoves([object("x.mp4", null)], [row("y.mp4")], "").size, 0, "no ETag, no move");
});
