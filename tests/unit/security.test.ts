import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://videocat:videocat@localhost:5432/videocat";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough";
process.env.AGENT_TOKEN ??= "test-agent-token-that-is-long-enough";
process.env.ADMIN_USER ??= "admin";
process.env.ADMIN_PASSWORD ??= "test-password-12345";
process.env.PROTECTED_FOLDER_PIN ??= "5678";
process.env.WEB_ORIGIN ??= "http://localhost:5173";
process.env.TRUST_PROXY ??= "false";
process.env.COOKIE_SECURE ??= "false";

const { applySecurityHeaders, clearRateLimit, rateLimit, requireTrustedOrigin } = await import("../../apps/server/src/lib/security.ts");
const { isValidAdminLogin, signSession } = await import("../../apps/server/src/lib/auth.ts");
const { normalizeProtectedPatterns } = await import("../../apps/server/src/lib/protected-settings.ts");
const jwt = await import("jsonwebtoken");

function replyMock() {
  const result = { statusCode: 200, payload: undefined as unknown, headers: new Map<string, string>() };
  const reply = {
    code(statusCode: number) {
      result.statusCode = statusCode;
      return reply;
    },
    send(payload: unknown) {
      result.payload = payload;
      return reply;
    },
    header(name: string, value: string) {
      result.headers.set(name, value);
      return reply;
    }
  } as never;
  return { reply, result };
}

test("rate limits a key and can clear it", () => {
  const key = `test-${Date.now()}-${Math.random()}`;
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  assert.equal(rateLimit(key, 2, 60_000).allowed, false);
  clearRateLimit(key);
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  clearRateLimit(key);
});

test("security headers protect API responses", () => {
  const { reply, result } = replyMock();
  applySecurityHeaders({ url: "/api/auth/me", protocol: "https" } as never, reply as never, (() => undefined) as never);
  assert.match(result.headers.get("Content-Security-Policy") ?? "", /default-src 'self'/);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(result.headers.get("X-Frame-Options"), "DENY");
  assert.match(result.headers.get("Strict-Transport-Security") ?? "", /max-age=31536000/);
});

test("state-changing requests require a configured origin when authenticated", async () => {
  const allowed = { url: "/api/auth/logout", method: "POST", headers: { origin: "http://localhost:5173", cookie: "videocat_session=token" } };
  const allowedReply = replyMock();
  await requireTrustedOrigin(allowed as never, allowedReply.reply as never);
  assert.equal(allowedReply.result.statusCode, 200);

  const foreign = { url: "/api/auth/logout", method: "POST", headers: { origin: "https://attacker.example", cookie: "videocat_session=token" } };
  const foreignReply = replyMock();
  await requireTrustedOrigin(foreign as never, foreignReply.reply as never);
  assert.equal(foreignReply.result.statusCode, 403);

  const missing = { url: "/api/auth/logout", method: "POST", headers: { cookie: "videocat_session=token" } };
  const missingReply = replyMock();
  await requireTrustedOrigin(missing as never, missingReply.reply as never);
  assert.equal(missingReply.result.statusCode, 403);
});

test("admin login and session tokens use the expected credentials and claims", () => {
  assert.equal(isValidAdminLogin("admin", "test-password-12345"), true);
  assert.equal(isValidAdminLogin("admin", "wrong-password"), false);
  const token = signSession("admin");
  const payload = jwt.default.verify(token, process.env.JWT_SECRET!, {
    issuer: "videocat",
    audience: "videocat-web",
    algorithms: ["HS256"]
  });
  assert.equal(typeof payload === "string" ? undefined : payload.role, "admin");
});

test("protected folder patterns are normalized, deduplicated and bounded", () => {
  const patterns = normalizeProtectedPatterns([" Private ", "private", "Protected", "", "X".repeat(120)]);
  assert.deepEqual(patterns, ["Private", "Protected", "X".repeat(80)]);
  assert.equal(normalizeProtectedPatterns(Array.from({ length: 60 }, (_, index) => `folder-${index}`)).length, 50);
});
