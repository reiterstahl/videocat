import assert from "node:assert/strict";
import test from "node:test";

import {
  generateCompanionToken,
  isLocalRequestAuthorized,
  minimumCompanionTokenLength
} from "../../apps/agent-windows/src/local-auth.ts";

const token = "0123456789abcdef0123456789abcdef";

test("rejects every local request when no token is configured", () => {
  assert.equal(isLocalRequestAuthorized(undefined, { "x-videocat-companion-token": token }), false);
  assert.equal(isLocalRequestAuthorized("", {}), false);
  assert.equal(isLocalRequestAuthorized("   ", { authorization: "Bearer x" }), false);
});

test("rejects configured tokens that are too short", () => {
  assert.equal(isLocalRequestAuthorized("short", { "x-videocat-companion-token": "short" }), false);
});

test("accepts the matching token from the header or a bearer authorization", () => {
  assert.equal(isLocalRequestAuthorized(token, { "x-videocat-companion-token": token }), true);
  assert.equal(isLocalRequestAuthorized(token, { authorization: `Bearer ${token}` }), true);
});

test("rejects missing, wrong or non-bearer credentials", () => {
  assert.equal(isLocalRequestAuthorized(token, {}), false);
  assert.equal(isLocalRequestAuthorized(token, { "x-videocat-companion-token": `${token}x` }), false);
  assert.equal(isLocalRequestAuthorized(token, { authorization: token }), false);
  assert.equal(isLocalRequestAuthorized(token, { "x-videocat-companion-token": ["a", "b"] }), false);
});

test("generates unique tokens long enough to be accepted", () => {
  const first = generateCompanionToken();
  const second = generateCompanionToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= minimumCompanionTokenLength);
  assert.equal(isLocalRequestAuthorized(first, { "x-videocat-companion-token": first }), true);
});
