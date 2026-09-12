import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  const companionId = crypto.randomUUID();
  const response = await app.inject({
    method: "POST",
    url: "/api/agent/companion/heartbeat",
    headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
    payload: { version: 1, companionId, companionName: "CI Companion", mountedDiskCount: 0, mountedDiskIds: [] }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(typeof response.json().commands.processDeletesRequestedAt, "number");

  const companion = await prisma.companionAgent.findUnique({ where: { installationId: companionId } });
  assert.equal(companion?.name, "CI Companion");
  assert.equal(companion?.version, 1);

  await prisma.companionAgent.update({ where: { installationId: companionId }, data: { revokedAt: new Date() } });
  const revoked = await app.inject({
    method: "POST",
    url: "/api/agent/companion/heartbeat",
    headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
    payload: { companionId, mountedDiskIds: [] }
  });
  assert.equal(revoked.statusCode, 403);
  await prisma.companionAgent.delete({ where: { installationId: companionId } });
});

test("categories, download queue and scan reconciliation work together", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const volumeId = `phase-one-${suffix}`;
  const categoryLabel = `P1 ${suffix.slice(-12)}`;
  let diskId = "";
  let categoryKey = "";
  const deletionVideoIds: string[] = [];
  let companionId = "";

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
      payload: { label: categoryLabel, color: "#2A9FD6" }
    });
    assert.equal(categoryResponse.statusCode, 200, categoryResponse.body);
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
            modifiedAt: "2026-09-12T12:00:00.000Z",
            status: "scanned"
          },
          {
            filename: "missing.mp4",
            extension: ".mp4",
            absolutePath: "T:\\Videos\\missing.mp4",
            relativePath: "Videos/missing.mp4",
            sizeBytes: 4096,
            modifiedAt: "2026-09-12T12:01:00.000Z",
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
    const missingFile = catalogResponse.json().files.find((file: { filename: string }) => file.filename === "missing.mp4");
    assert.ok(keepFile);
    assert.ok(missingFile);
    deletionVideoIds.push(keepFile.id, missingFile.id);

    const scanIndex = await app.inject({
      method: "GET",
      url: `/api/agent/disks/${diskId}/scan-index`,
      headers: agentHeaders
    });
    assert.equal(scanIndex.statusCode, 200);
    assert.deepEqual(scanIndex.json().files, [
      { relativePath: "Videos/keep.mp4", sizeBytes: 2048, modifiedAt: "2026-09-12T12:00:00.000Z" },
      { relativePath: "Videos/missing.mp4", sizeBytes: 4096, modifiedAt: "2026-09-12T12:01:00.000Z" }
    ]);

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

    const markMissingForDeletion = await app.inject({
      method: "PATCH",
      url: `/api/files/${missingFile.id}/curation`,
      headers: webMutationHeaders(cookie),
      payload: { curationStatus: "delete" }
    });
    assert.equal(markMissingForDeletion.statusCode, 200);

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

    const deleteQueueWithAbsentFile = await app.inject({
      method: "GET",
      url: `/api/agent/disks/${diskId}/delete-queue`,
      headers: agentHeaders
    });
    assert.equal(deleteQueueWithAbsentFile.statusCode, 200);
    assert.ok(deleteQueueWithAbsentFile.json().files.some((file: { id: string }) => file.id === missingFile.id));

    const missingDeletionResult = await app.inject({
      method: "POST",
      url: `/api/agent/files/${missingFile.id}/deletion-result`,
      headers: agentHeaders,
      payload: { status: "missing" }
    });
    assert.equal(missingDeletionResult.statusCode, 200, missingDeletionResult.body);

    const markForDeletion = await app.inject({
      method: "PATCH",
      url: `/api/files/${keepFile.id}/curation`,
      headers: webMutationHeaders(cookie),
      payload: { curationStatus: "delete" }
    });
    assert.equal(markForDeletion.statusCode, 200);

    companionId = crypto.randomUUID();
    const connectedHeartbeat = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
      payload: { version: 11, companionId, companionName: "Delete Test", mountedDiskCount: 1, mountedDiskIds: [diskId] }
    });
    assert.equal(connectedHeartbeat.statusCode, 200);

    const processDeletions = await app.inject({
      method: "POST",
      url: "/api/review/deletions/process",
      headers: webMutationHeaders(cookie)
    });
    assert.equal(processDeletions.statusCode, 200);
    assert.equal(processDeletions.json().connectedDiskCount, 1);

    const heartbeatCommand = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
      payload: { version: 11, companionId, companionName: "Delete Test", mountedDiskCount: 1, mountedDiskIds: [diskId] }
    });
    assert.equal(heartbeatCommand.statusCode, 200);
    assert.ok(heartbeatCommand.json().commands.processDeletesRequestedAt > 0);

    const pendingHistory = await app.inject({
      method: "GET",
      url: "/api/review/deletions",
      headers: { cookie }
    });
    assert.equal(pendingHistory.statusCode, 200);
    assert.ok(pendingHistory.json().entries.some((entry: { videoFileId: string; status: string }) => (
      entry.videoFileId === keepFile.id && entry.status === "pending"
    )));

    const deletionResult = await app.inject({
      method: "POST",
      url: `/api/agent/files/${keepFile.id}/deletion-result`,
      headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
      payload: { status: "deleted" }
    });
    assert.equal(deletionResult.statusCode, 200, deletionResult.body);
    assert.equal(deletionResult.json().removedFromCatalog, true);

    const completedHistory = await app.inject({
      method: "GET",
      url: "/api/review/deletions",
      headers: { cookie }
    });
    assert.equal(completedHistory.statusCode, 200);
    assert.ok(completedHistory.json().entries.some((entry: { videoFileId: string; status: string }) => (
      entry.videoFileId === keepFile.id && entry.status === "deleted"
    )));
    assert.equal(await prisma.videoFile.count({ where: { id: keepFile.id } }), 0);
  } finally {
    if (deletionVideoIds.length > 0) {
      await prisma.deletionRecord.deleteMany({ where: { videoFileId: { in: deletionVideoIds } } });
    }
    if (companionId) await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
    if (diskId) await prisma.disk.deleteMany({ where: { id: diskId } });
    if (categoryKey) await prisma.curationCategory.deleteMany({ where: { key: categoryKey } });
  }
});
