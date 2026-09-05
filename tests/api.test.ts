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

const { buildApp } = await import("../apps/server/src/app.ts");
const app = await buildApp({ logger: false });
test.after(async () => {
  await app.close();
});

test("health endpoint responds without authentication", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
});

test("login sets a secure session cookie and authenticated routes accept it", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "http://localhost:5173" },
    payload: { username: "admin", password: "test-password-12345" }
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers["set-cookie"];
  assert.ok(cookie);

  const sessionCookie = Array.isArray(cookie) ? cookie[0].split(";", 1)[0] : cookie.split(";", 1)[0];
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sessionCookie } });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { user: { username: "admin" } });
});

test("foreign origins are rejected for state-changing web requests", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "https://attacker.example" },
    payload: { username: "admin", password: "test-password-12345" }
  });
  assert.equal(response.statusCode, 403);
});

test("agent routes require the agent token before reaching the database", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/agent/companion/heartbeat",
    headers: { authorization: "Bearer wrong-token" },
    payload: {}
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { message: "Invalid agent token" });
});

test("valid agent heartbeat reaches PostgreSQL", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/agent/companion/heartbeat",
    headers: { authorization: `Bearer ${process.env.AGENT_TOKEN}` },
    payload: { version: 1, mountedDiskCount: 0, mountedDiskIds: [] }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
});
