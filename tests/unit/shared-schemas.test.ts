import assert from "node:assert/strict";
import test from "node:test";

import {
  agentFileSchema,
  companionDefaultPort,
  companionPortCandidates,
  filesBatchSchema,
  filesQuerySchema,
  encodeVisualFingerprint,
  tagsFromFilename,
  thumbnailKindSchema
} from "../../packages/shared/src/index.ts";

const validFile = {
  filename: "Rolando.Quirós.mp4",
  extension: ".mp4",
  absolutePath: "R:\\Videos\\Rolando.Quirós.mp4",
  relativePath: "Videos/Rolando.Quirós.mp4",
  sizeBytes: 1024,
  status: "scanned" as const,
  metadata: { durationSeconds: 12.5, width: 1920, height: 1080 }
};

test("accepts bounded agent file batches and rejects oversized batches", () => {
  assert.equal(agentFileSchema.parse(validFile).filename, validFile.filename);
  assert.equal(filesBatchSchema.safeParse({
    scanId: "11111111-1111-4111-8111-111111111111",
    diskId: "22222222-2222-4222-8222-222222222222",
    files: [validFile]
  }).success, true);
  assert.equal(filesBatchSchema.safeParse({
    scanId: "11111111-1111-4111-8111-111111111111",
    diskId: "22222222-2222-4222-8222-222222222222",
    files: Array.from({ length: 201 }, () => validFile)
  }).success, false);
});

test("accepts versioned visual fingerprints and rejects malformed values", () => {
  const visualFingerprint = encodeVisualFingerprint(Array.from({ length: 8 }, (_value, index) => ({
    index: index + 1,
    hash: "0123456789abcdef"
  })));
  assert.ok(visualFingerprint);
  assert.equal(agentFileSchema.safeParse({ ...validFile, visualFingerprint, fingerprintVersion: 1 }).success, true);
  assert.equal(agentFileSchema.safeParse({ ...validFile, visualFingerprint: "v1:not-a-hash", fingerprintVersion: 1 }).success, false);
});

test("bounds catalog queries and thumbnail kinds", () => {
  assert.equal(filesQuerySchema.parse({}).pageSize, 50);
  assert.equal(filesQuerySchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(filesQuerySchema.safeParse({ sortBy: "absolutePath" }).success, false);
  assert.equal(thumbnailKindSchema.safeParse("frame_15").success, true);
  assert.equal(thumbnailKindSchema.safeParse("frame_999").success, false);
});

test("normalizes filename tags and companion port candidates", () => {
  assert.deepEqual(tagsFromFilename("Rolando.Quirós.final.mp4"), ["rolando", "quiros"]);
  const ports = companionPortCandidates(companionDefaultPort);
  assert.equal(ports[0], companionDefaultPort);
  assert.equal(new Set(ports).size, ports.length);
  assert.equal(ports.every((port) => port > 0 && port <= 65535), true);
});
