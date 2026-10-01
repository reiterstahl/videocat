import assert from "node:assert/strict";
import test from "node:test";

import { squarify } from "../../apps/web/src/lib/treemap.ts";

test("fills the box exactly with areas proportional to the values", () => {
  const values = [6, 6, 4, 3, 2, 2, 1];
  const rects = squarify(values, (value) => value, 600, 400);
  assert.equal(rects.length, values.length);
  const totalArea = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
  assert.ok(Math.abs(totalArea - 600 * 400) < 1e-6);
  for (const rect of rects) {
    assert.ok(Math.abs(rect.width * rect.height - (rect.item / 24) * 600 * 400) < 1e-6);
    assert.ok(rect.x >= -1e-9 && rect.y >= -1e-9);
    assert.ok(rect.x + rect.width <= 600 + 1e-6 && rect.y + rect.height <= 400 + 1e-6);
  }
});

test("keeps rectangles reasonably square", () => {
  const rects = squarify([50, 30, 10, 5, 5], (value) => value);
  for (const rect of rects) assert.ok(Math.max(rect.width / rect.height, rect.height / rect.width) < 4.5);
});

test("ignores empty and non-positive values", () => {
  assert.deepEqual(squarify([], (value: number) => value), []);
  assert.equal(squarify([0, -1, 3], (value) => value).length, 1);
});
