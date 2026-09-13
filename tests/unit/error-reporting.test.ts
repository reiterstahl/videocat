import assert from "node:assert/strict";
import test from "node:test";
import { boundedErrorMessage, boundedText } from "../../apps/agent-windows/src/error-reporting.ts";

test("bounds long tool diagnostics while preserving their useful beginning and end", () => {
  const diagnostic = `Command failed: ffmpeg ${"configuration ".repeat(500)}fatal decoder error`;
  const bounded = boundedErrorMessage(new Error(diagnostic));

  assert.equal(bounded.length, 4000);
  assert.match(bounded, /^Command failed: ffmpeg/);
  assert.match(bounded, /diagnostico truncado/);
  assert.match(bounded, /fatal decoder error$/);
});

test("removes null bytes and respects smaller API field limits", () => {
  assert.equal(boundedText("abc\0def", 20), "abcdef");
  assert.equal(boundedErrorMessage("", 20, "fallback"), "fallback");
  assert.equal(boundedErrorMessage("x".repeat(5000), 2000).length, 2000);
});
