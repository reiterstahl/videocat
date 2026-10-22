import assert from "node:assert/strict";
import test from "node:test";

import { MoveCandidates, resolveMoves } from "../../apps/agent-windows/src/move-detection.ts";

const mtime = Date.parse("2025-03-04T05:06:07.890Z");

test("a renamed folder's files are found by size, modification time and extension", () => {
  const candidates = new MoveCandidates({
    "Testing/clip.mp4": { modifiedAtMs: mtime, sizeBytes: 1000 },
    "Testing/other.mp4": { modifiedAtMs: mtime, sizeBytes: 2000 },
    "Testing/clip.mkv": { modifiedAtMs: mtime, sizeBytes: 1000 },
    "Old/legacy.mp4": mtime
  });
  assert.deepEqual(candidates.candidates("Testing 2024/clip.mp4", 1000, mtime), ["Testing/clip.mp4"]);
  assert.deepEqual(candidates.candidates("Testing 2024/clip.mp4", 1000, mtime + 1), [], "a different time is another file");
  assert.deepEqual(candidates.candidates("Testing 2024/clip.mp4", 1001, mtime), [], "a different size is another file");
  assert.deepEqual(candidates.candidates("Testing 2024/clip.MKV", 1000, mtime), ["Testing/clip.mkv"]);
  assert.deepEqual(candidates.candidates("Elsewhere/legacy.mp4", 0, mtime), [], "entries without size never match");
  assert.deepEqual(candidates.candidates("Testing/clip.mp4", 1000, mtime), [], "a path is never its own source");
});

test("a renamed folder moves every file, and a copy found first does not take an entry", () => {
  const moves = resolveMoves([
    { to: "Copia/clip3.mp4", gone: ["Testing/clip3.mp4"] },
    { to: "Testing 2024/clip1.mp4", gone: ["Testing/clip1.mp4"] },
    { to: "Testing 2024/clip2.mp4", gone: ["Testing/clip2.mp4"] },
    { to: "Testing 2024/clip3.mp4", gone: ["Testing/clip3.mp4"] }
  ]);
  assert.deepEqual(Object.fromEntries(moves), {
    "Testing 2024/clip1.mp4": "Testing/clip1.mp4",
    "Testing 2024/clip2.mp4": "Testing/clip2.mp4",
    "Testing 2024/clip3.mp4": "Testing/clip3.mp4"
  });
});

test("a file renamed in place or moved alone follows its entry", () => {
  assert.deepEqual(Object.fromEntries(resolveMoves([{ to: "V/new name.mp4", gone: ["V/old name.mp4"] }])), { "V/new name.mp4": "V/old name.mp4" });
  assert.deepEqual(Object.fromEntries(resolveMoves([{ to: "B/clip.mp4", gone: ["A/clip.mp4"] }])), { "B/clip.mp4": "A/clip.mp4" });
});

test("files with the same size and time are told apart by their name", () => {
  const moves = resolveMoves([
    { to: "New/x.mp4", gone: ["Old/x.mp4", "Old/y.mp4"] },
    { to: "New/Y.mp4", gone: ["Old/x.mp4", "Old/y.mp4"] }
  ]);
  assert.deepEqual(Object.fromEntries(moves), { "New/x.mp4": "Old/x.mp4", "New/Y.mp4": "Old/y.mp4" });
});

test("anything ambiguous moves nothing and is scanned as new", () => {
  // The folder was renamed to A and also copied to B: both claim the same entries equally.
  const copied = resolveMoves([
    { to: "A/clip1.mp4", gone: ["Testing/clip1.mp4"] },
    { to: "B/clip1.mp4", gone: ["Testing/clip1.mp4"] },
    { to: "A/clip2.mp4", gone: ["Testing/clip2.mp4"] },
    { to: "B/clip2.mp4", gone: ["Testing/clip2.mp4"] }
  ]);
  assert.equal(copied.size, 0);
  // Two old files with other names fit the new one equally.
  assert.equal(resolveMoves([{ to: "New/z.mp4", gone: ["Old/x.mp4", "Old/y.mp4"] }]).size, 0);
  assert.equal(resolveMoves([]).size, 0);
});
