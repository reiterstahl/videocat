import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://videocat:videocat@localhost:5432/videocat";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough";
process.env.AGENT_TOKEN ??= "test-agent-token-that-is-long-enough";
process.env.ADMIN_USER ??= "admin";
process.env.ADMIN_PASSWORD ??= "test-password-12345";
process.env.PROTECTED_FOLDER_PIN ??= "5678";
process.env.PROTECTED_FOLDER_PATTERNS ??= "Private,Protected";
process.env.WEB_ORIGIN ??= "http://localhost:5173";
process.env.TRUST_PROXY ??= "false";
process.env.COOKIE_SECURE ??= "false";

const { buildApp } = await import("../apps/server/src/app.ts");
const { prisma } = await import("../apps/server/src/lib/prisma.ts");
const app = await buildApp({ logger: false });
test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function authenticatedCookie(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "http://localhost:5173" },
    payload: { username: "admin", password: "test-password-12345" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["set-cookie"];
  assert.ok(cookie);
  return Array.isArray(cookie) ? cookie[0].split(";", 1)[0] : cookie.split(";", 1)[0];
}

const webMutationHeaders = (cookie: string) => ({
  cookie,
  origin: "http://localhost:5173"
});

const agentHeaders = {
  authorization: `Bearer ${process.env.AGENT_TOKEN}`
};

test("health endpoint responds without authentication", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
});

test("login sets a secure session cookie and authenticated routes accept it", async () => {
  const sessionCookie = await authenticatedCookie();
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
    headers: agentHeaders,
    payload: { version: 1, mountedDiskCount: 0, mountedDiskIds: [] }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
});

test("categories, download queue and scan reconciliation work together", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const volumeId = `phase-one-${suffix}`;
  let diskId = "";
  let categoryKey = "";

  try {
    const cookie = await authenticatedCookie();
    const unlockResponse = await app.inject({
      method: "POST",
      url: "/api/protected-folder/unlock",
      headers: webMutationHeaders(cookie),
      payload: { pin: "5678" }
    });
    assert.equal(unlockResponse.statusCode, 200);
    assert.equal(unlockResponse.json().unlocked, true);

    const categoryResponse = await app.inject({
      method: "POST",
      url: "/api/categories",
      headers: webMutationHeaders(cookie),
      payload: { label: `Phase One ${suffix}`, color: "#2A9FD6" }
    });
    assert.equal(categoryResponse.statusCode, 200);
    categoryKey = categoryResponse.json().category.key;

    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/agent/register-disk",
      headers: agentHeaders,
      payload: { name: `Test Disk ${suffix}`, volumeId, driveLetter: "T:" }
    });
    assert.equal(registerResponse.statusCode, 200);
    diskId = registerResponse.json().disk.id;

    const firstScanResponse = await app.inject({
      method: "POST",
      url: "/api/agent/scan/start",
      headers: agentHeaders,
      payload: { diskId, rootPath: "T:\\" }
    });
    assert.equal(firstScanResponse.statusCode, 200);
    const firstScanId = firstScanResponse.json().scan.id as string;

    const batchResponse = await app.inject({
      method: "POST",
      url: "/api/agent/files/batch",
      headers: agentHeaders,
      payload: {
        scanId: firstScanId,
        diskId,
        files: [
          {
            filename: "keep.mp4",
            extension: ".mp4",
            absolutePath: "T:\\Videos\\keep.mp4",
            relativePath: "Videos/keep.mp4",
            sizeBytes: 2048,
            status: "scanned"
          },
          {
            filename: "missing.mp4",
            extension: ".mp4",
            absolutePath: "T:\\Videos\\missing.mp4",
            relativePath: "Videos/missing.mp4",
            sizeBytes: 4096,
            status: "scanned"
          }
        ]
      }
    });
    assert.equal(batchResponse.statusCode, 200);

    const firstFinish = await app.inject({
      method: "POST",
      url: "/api/agent/scan/finish",
      headers: agentHeaders,
      payload: { scanId: firstScanId, reconcile: true, scanRoots: ["."] }
    });
    assert.equal(firstFinish.statusCode, 200);
    assert.equal(firstFinish.json().reconciliation.markedAbsent, 0);

    const catalogResponse = await app.inject({
      method: "GET",
      url: `/api/files?diskId=${diskId}&pageSize=10`,
      headers: { cookie }
    });
    assert.equal(catalogResponse.statusCode, 200);
    assert.equal(catalogResponse.json().total, 2);
    const keepFile = catalogResponse.json().files.find((file: { filename: string }) => file.filename === "keep.mp4");
    assert.ok(keepFile);

    const categoryToggle = await app.inject({
      method: "PATCH",
      url: `/api/files/${keepFile.id}/categories/${categoryKey}`,
      headers: webMutationHeaders(cookie),
      payload: { enabled: true }
    });
    assert.equal(categoryToggle.statusCode, 200);
    assert.equal(categoryToggle.json().file.categoryKeys.includes(categoryKey), true);

    const queueResponse = await app.inject({
      method: "POST",
      url: "/api/downloads/queue",
      headers: webMutationHeaders(cookie),
      payload: { fileIds: [keepFile.id] }
    });
    assert.equal(queueResponse.statusCode, 200);
    assert.equal(queueResponse.json().queued, 1);

    const agentQueue = await app.inject({
      method: "GET",
      url: `/api/agent/downloads/queue?diskId=${diskId}`,
      headers: agentHeaders
    });
    assert.equal(agentQueue.statusCode, 200);
    assert.equal(agentQueue.json().files.length, 1);
    const queueId = agentQueue.json().files[0].id as string;

    const downloading = await app.inject({
      method: "PATCH",
      url: `/api/agent/downloads/${queueId}/status`,
      headers: agentHeaders,
      payload: { status: "downloading", progressBytes: 1024 }
    });
    assert.equal(downloading.statusCode, 200);

    const secondScanResponse = await app.inject({
      method: "POST",
      url: "/api/agent/scan/start",
      headers: agentHeaders,
      payload: { diskId, rootPath: "T:\\" }
    });
    assert.equal(secondScanResponse.statusCode, 200);
    const secondScanId = secondScanResponse.json().scan.id as string;

    const seenResponse = await app.inject({
      method: "POST",
      url: `/api/agent/scans/${secondScanId}/seen`,
      headers: agentHeaders,
      payload: { paths: ["Videos/keep.mp4"] }
    });
    assert.equal(seenResponse.statusCode, 200);
    assert.equal(seenResponse.json().seen, 1);

    const secondFinish = await app.inject({
      method: "POST",
      url: "/api/agent/scan/finish",
      headers: agentHeaders,
      payload: { scanId: secondScanId, reconcile: true, scanRoots: ["."] }
    });
    assert.equal(secondFinish.statusCode, 200);
    assert.equal(secondFinish.json().reconciliation.markedAbsent, 1);

    const reconciledCatalog = await app.inject({
      method: "GET",
      url: `/api/files?diskId=${diskId}&pageSize=10`,
      headers: { cookie }
    });
    assert.equal(reconciledCatalog.statusCode, 200);
    assert.equal(reconciledCatalog.json().total, 1);
    assert.equal(reconciledCatalog.json().files[0].filename, "keep.mp4");
  } finally {
    if (diskId) await prisma.disk.deleteMany({ where: { id: diskId } });
    if (categoryKey) await prisma.curationCategory.deleteMany({ where: { key: categoryKey } });
  }
});
