import assert from "node:assert/strict";
import test from "node:test";

import { matchKey, nameMatch, withinOneEdit } from "../../apps/server/src/lib/name-match.ts";

test("names ignore case, accents, dots and separators", () => {
  assert.equal(matchKey(".Testing_001 Ñandú"), "testing001nandu");
  for (const filename of ["testing001.mp4", "Testing001.MOV", ".Testing001.mkv", "testing_001.mp4", "Testing 001 final.mp4", "clip-TESTING.001-b.avi", "Téstíng001.mp4"]) {
    assert.equal(nameMatch(filename, "testing001"), "exact", filename);
  }
});

test("one letter of difference is a similar name", () => {
  assert.equal(nameMatch("testng001.mp4", "testing001"), "similar");
  assert.equal(nameMatch("testimg001.mp4", "testing001"), "similar");
  assert.equal(nameMatch("xx_testingg001_yy.mp4", "testing001"), "similar");
  assert.equal(nameMatch("tstng001.mp4", "testing001"), null, "two letters apart");
  assert.equal(nameMatch("testing002.mp4", "testing001"), null, "a different number is another project");
  assert.equal(nameMatch("testing01.mp4", "testing001"), null);
  assert.equal(nameMatch("vacaciones.mp4", "testing001"), null);
});

test("the extension is not part of the name and short names never match loosely", () => {
  assert.equal(nameMatch("clip.testing001", "testing001"), null);
  assert.equal(nameMatch("boda.mp4", "bod"), "exact");
  assert.equal(nameMatch("bota.mp4", "boda"), null, "fuzzy needs five characters");
  assert.equal(nameMatch("anything.mp4", "ab"), null, "too short to search");
});

test("one edit check", () => {
  assert.ok(withinOneEdit("abc", "abc"));
  assert.ok(withinOneEdit("abc", "abd"));
  assert.ok(withinOneEdit("abc", "ab"));
  assert.ok(withinOneEdit("abc", "xabc"));
  assert.ok(!withinOneEdit("abc", "bca"));
  assert.ok(!withinOneEdit("abc", "a"));
});
