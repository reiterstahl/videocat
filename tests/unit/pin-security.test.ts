import assert from "node:assert/strict";
import test from "node:test";

import { constantTimeStringEqual, hashPin, verifyHashedPin } from "../../apps/server/src/lib/pin-security.ts";

test("hashes PINs with a random salt and verifies them", () => {
  const first = hashPin("5678");
  const second = hashPin("5678");
  assert.notEqual(first, second);
  assert.match(first, /^pbkdf2-sha256\$120000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(verifyHashedPin("5678", first), true);
  assert.equal(verifyHashedPin("0000", first), false);
});

test("rejects malformed or deliberately expensive PIN hashes", () => {
  const valid = hashPin("5678");
  assert.equal(verifyHashedPin("5678", valid.replace("$120000$", "$99999$")), false);
  assert.equal(verifyHashedPin("5678", valid.replace("$120000$", "$1000001$")), false);
  assert.equal(verifyHashedPin("5678", `${valid}$extra`), false);
  assert.equal(verifyHashedPin("5678", "not-a-hash"), false);
});

test("compares plain secrets without early length exits", () => {
  assert.equal(constantTimeStringEqual("same", "same"), true);
  assert.equal(constantTimeStringEqual("short", "a much longer value"), false);
});
