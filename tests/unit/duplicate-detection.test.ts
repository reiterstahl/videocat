import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeVisualFingerprint,
  perceptualHashFromGray9x8,
  visualFingerprintSimilarity
} from "../../packages/shared/src/perceptual-fingerprint.ts";
import { compareDuplicateCandidates, findDuplicateGroups } from "../../apps/server/src/lib/duplicate-detection.ts";

function fingerprint(seed: number, changedBits = 0): string {
  return encodeVisualFingerprint(Array.from({ length: 15 }, (_value, index) => ({
    index: index + 1,
    hash: BigInt.asUintN(
      64,
      (BigInt(seed + index) * 0x9e3779b97f4a7c15n) ^ ((1n << BigInt(changedBits)) - 1n)
    ).toString(16).padStart(16, "0")
  })))!;
}

test("creates a stable 64-bit difference hash from a 9x8 grayscale frame", () => {
  const pixels = Uint8Array.from({ length: 72 }, (_value, index) => index % 9);
  assert.equal(perceptualHashFromGray9x8(pixels), "0000000000000000");
  assert.throws(() => perceptualHashFromGray9x8(new Uint8Array(10)));
});

test("compares visual fingerprints across matching frame positions", () => {
  const original = fingerprint(100);
  assert.equal(visualFingerprintSimilarity(original, original), 1);
  assert.ok((visualFingerprintSimilarity(original, fingerprint(100, 2)) ?? 0) > 0.9);
});

test("detects the same content at different resolutions and rejects unrelated visuals", () => {
  const base = {
    filename: "original.mp4",
    sizeBytes: 1_000_000,
    durationSeconds: 600,
    width: 1920,
    height: 1080,
    visualFingerprint: fingerprint(200)
  };
  const resized = {
    ...base,
    id: "resized",
    filename: "copy-720p.mkv",
    sizeBytes: 600_000,
    durationSeconds: 600.4,
    width: 1280,
    height: 720,
    visualFingerprint: fingerprint(200, 2)
  };
  const original = { ...base, id: "original" };
  const unrelated = { ...resized, id: "unrelated", visualFingerprint: fingerprint(9_000, 32) };

  assert.equal(compareDuplicateCandidates(original, resized)?.matchType, "visual");
  assert.equal(compareDuplicateCandidates(original, unrelated), null);
  const groups = findDuplicateGroups([original, resized, unrelated]);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0].fileIds), new Set(["original", "resized"]));
});

test("keeps same-size legacy files as candidates when fingerprints are unavailable", () => {
  const left = { id: "left", filename: "a.mp4", sizeBytes: 500, durationSeconds: null, width: null, height: null, visualFingerprint: null };
  const right = { ...left, id: "right", filename: "b.mp4" };
  assert.equal(compareDuplicateCandidates(left, right)?.matchType, "same_size");
});
