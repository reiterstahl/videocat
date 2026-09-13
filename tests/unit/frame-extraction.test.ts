import assert from "node:assert/strict";
import test from "node:test";
import { frameExtractionTimestamps, shouldRetryFrameExtraction } from "../../apps/agent-windows/src/frame-extraction.ts";

test("tries earlier positions when a requested frame is outside the usable stream", () => {
  assert.deepEqual(frameExtractionTimestamps(1_755.47), [1_755.47, 1_750.47, 1_725.47, 1_316.6025]);
  assert.deepEqual(frameExtractionTimestamps(0.1), [0.1]);
});

test("only retries frame extraction failures that can be recovered by seeking", () => {
  assert.equal(shouldRetryFrameExtraction(new Error("Output file is empty because its streams received no packets")), true);
  assert.equal(shouldRetryFrameExtraction(new Error("Nothing was encoded")), true);
  assert.equal(shouldRetryFrameExtraction(new Error("Unknown decoder 'missing_codec'")), false);
});
