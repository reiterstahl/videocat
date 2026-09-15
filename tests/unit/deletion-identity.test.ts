import assert from "node:assert/strict";
import test from "node:test";

import {
  deletionFingerprintFrameIndexes,
  validateDeletionFingerprint,
  validateDeletionMetadata
} from "../../apps/agent-windows/src/deletion-identity.ts";

const fingerprint = "v1:01=0000000000000000;02=1111111111111111;03=2222222222222222;04=3333333333333333;05=4444444444444444;06=5555555555555555;07=6666666666666666;08=7777777777777777";

test("accepts unchanged deletion metadata", () => {
  assert.deepEqual(validateDeletionMetadata(
    { sizeBytes: 2048, modifiedAt: "2026-09-15T12:00:00.000Z" },
    { sizeBytes: 2048, modifiedAtMs: Date.parse("2026-09-15T12:00:00.500Z") }
  ), { ok: true });
});

test("rejects a replacement with different size or modification time", () => {
  assert.equal(validateDeletionMetadata(
    { sizeBytes: 2048, modifiedAt: "2026-09-15T12:00:00.000Z" },
    { sizeBytes: 4096, modifiedAtMs: Date.parse("2026-09-15T12:00:00.000Z") }
  ).ok, false);
  assert.equal(validateDeletionMetadata(
    { sizeBytes: 2048, modifiedAt: "2026-09-15T12:00:00.000Z" },
    { sizeBytes: 2048, modifiedAtMs: Date.parse("2026-09-15T12:00:03.000Z") }
  ).ok, false);
});

test("requires trustworthy catalog metadata before deletion", () => {
  assert.equal(validateDeletionMetadata(
    { sizeBytes: 2048, modifiedAt: null },
    { sizeBytes: 2048, modifiedAtMs: Date.now() }
  ).ok, false);
});

test("samples visual fingerprints and rejects different content", () => {
  assert.deepEqual(deletionFingerprintFrameIndexes(fingerprint), [1, 5, 8]);
  assert.deepEqual(validateDeletionFingerprint(fingerprint, [
    { index: 1, hash: "0000000000000000" },
    { index: 5, hash: "4444444444444444" },
    { index: 8, hash: "ffffffffffffffff" }
  ]), { ok: true });
  assert.equal(validateDeletionFingerprint(fingerprint, [
    { index: 1, hash: "ffffffffffffffff" },
    { index: 5, hash: "aaaaaaaaaaaaaaaa" },
    { index: 8, hash: "8888888888888888" }
  ]).ok, false);
});
