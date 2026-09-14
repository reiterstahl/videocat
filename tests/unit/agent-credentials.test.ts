import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://videocat:videocat@localhost:5432/videocat";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough";
process.env.AGENT_TOKEN ??= "test-agent-token-that-is-long-enough";
process.env.ADMIN_PASSWORD ??= "test-password-12345";
process.env.PROTECTED_FOLDER_PIN ??= "5678";

const {
  constantTimeHashEqual,
  displayPairingCode,
  generateAgentCredential,
  generatePairingCode,
  hashAgentSecret,
  normalizePairingCode
} = await import("../../apps/server/src/lib/agent-credentials.ts");

test("pairing codes are readable, normalized and random", () => {
  const first = generatePairingCode();
  const second = generatePairingCode();
  assert.match(first, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
  assert.notEqual(first, second);
  assert.equal(normalizePairingCode(displayPairingCode(first).toLowerCase()), first);
});

test("agent credentials are only persisted as keyed hashes", () => {
  const credential = generateAgentCredential();
  const hash = hashAgentSecret(credential);
  assert.match(credential, /^vcat_agent_[A-Za-z0-9_-]+$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(constantTimeHashEqual(hash, hashAgentSecret(credential)), true);
  assert.equal(constantTimeHashEqual(hash, hashAgentSecret(`${credential}x`)), false);
});
