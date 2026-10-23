import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import { once } from "node:events";
import test from "node:test";
import WebSocket from "ws";

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
process.env.STORAGE_SECRET_KEY ??= "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

const { buildApp } = await import("../apps/server/src/app.ts");
const { prisma } = await import("../apps/server/src/lib/prisma.ts");
const app = await buildApp({ logger: false });
let liveServerUrl: string | null = null;
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

async function websocketServerUrl(): Promise<string> {
  if (!liveServerUrl) liveServerUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  return liveServerUrl;
}

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
  assert.deepEqual(response.json(), { message: "Invalid agent credentials" });
});

test("one-time pairing creates and revokes an individual Companion credential", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const companionId = crypto.randomUUID();
  const cookie = await authenticatedCookie();
  try {
    const codeResponse = await app.inject({
      method: "POST",
      url: "/api/companions/pairing-code",
      headers: webMutationHeaders(cookie),
      payload: {}
    });
    assert.equal(codeResponse.statusCode, 200, codeResponse.body);
    assert.match(codeResponse.json().code, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);

    const pairResponse = await app.inject({
      method: "POST",
      url: "/api/agent/pair",
      payload: {
        code: codeResponse.json().code,
        companionId,
        companionName: "Paired CI Companion",
        version: 13
      }
    });
    assert.equal(pairResponse.statusCode, 200, pairResponse.body);
    assert.match(pairResponse.json().credential, /^vcat_agent_[A-Za-z0-9_-]+$/);

    const reused = await app.inject({
      method: "POST",
      url: "/api/agent/pair",
      payload: { code: codeResponse.json().code, companionId: crypto.randomUUID(), version: 13 }
    });
    assert.equal(reused.statusCode, 401);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: {
        authorization: `Bearer ${pairResponse.json().credential}`,
        "x-videocat-companion-id": companionId
      },
      payload: { companionId, version: 13, mountedDiskIds: [] }
    });
    assert.equal(heartbeat.statusCode, 200, heartbeat.body);

    const stored = await prisma.companionAgent.findUnique({ where: { installationId: companionId } });
    assert.equal(stored?.authMode, "paired");
    assert.ok(stored?.credentialHash);
    assert.notEqual(stored?.credentialHash, pairResponse.json().credential);

    const revoke = await app.inject({
      method: "POST",
      url: `/api/companions/${companionId}/revoke`,
      headers: webMutationHeaders(cookie),
      payload: {}
    });
    assert.equal(revoke.statusCode, 200, revoke.body);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: {
        authorization: `Bearer ${pairResponse.json().credential}`,
        "x-videocat-companion-id": companionId
      },
      payload: { companionId, mountedDiskIds: [] }
    });
    assert.equal(rejected.statusCode, 403);
  } finally {
    await prisma.companionPairingCode.deleteMany({ where: { claimedById: companionId } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
  }
});

test("a paired Companion opens a control tunnel and revocation closes it", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const companionId = crypto.randomUUID();
  let tunnel: WebSocket | null = null;
  try {
    const cookie = await authenticatedCookie();
    const codeResponse = await app.inject({
      method: "POST",
      url: "/api/companions/pairing-code",
      headers: webMutationHeaders(cookie),
      payload: {}
    });
    assert.equal(codeResponse.statusCode, 200, codeResponse.body);
    const pairResponse = await app.inject({
      method: "POST",
      url: "/api/agent/pair",
      payload: {
        code: codeResponse.json().code,
        companionId,
        companionName: "Tunnel CI Companion",
        version: 14
      }
    });
    assert.equal(pairResponse.statusCode, 200, pairResponse.body);

    const serverUrl = await websocketServerUrl();
    tunnel = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/api/agent/tunnel`);
    await once(tunnel, "open");
    tunnel.send(JSON.stringify({
      type: "tunnel.hello",
      protocolVersion: 1,
      companionId,
      credential: pairResponse.json().credential,
      companionName: "Tunnel CI Companion",
      version: 14,
      capabilities: { control: true, streamRead: false, streamRemux: false }
    }));
    const [message] = await once(tunnel, "message");
    assert.deepEqual(JSON.parse(String(message)), {
      type: "tunnel.ready",
      protocolVersion: 1,
      companionId,
      capabilities: { control: true, streamRead: false, streamRemux: false }
    });

    const companions = await app.inject({ method: "GET", url: "/api/companions", headers: { cookie } });
    assert.equal(companions.statusCode, 200, companions.body);
    assert.equal(companions.json().companions.find((item: { installationId: string }) => item.installationId === companionId)?.tunnel.connected, true);

    const closed = once(tunnel, "close");
    const revoke = await app.inject({
      method: "POST",
      url: `/api/companions/${companionId}/revoke`,
      headers: webMutationHeaders(cookie),
      payload: {}
    });
    assert.equal(revoke.statusCode, 200, revoke.body);
    const [code] = await closed;
    assert.equal(code, 4003);
  } finally {
    tunnel?.terminate();
    await prisma.companionPairingCode.deleteMany({ where: { claimedById: companionId } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
  }
});

test("remote playback streams an open range with read-ahead and the admin picks the buffer", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const companionId = crypto.randomUUID();
  const diskId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const size = 1_700_000;
  const file = Buffer.from(Array.from({ length: size }, (_, index) => index % 253));
  let tunnel: WebSocket | null = null;
  try {
    const cookie = await authenticatedCookie();
    const invalidBuffer = await app.inject({ method: "PATCH", url: "/api/profile/security", headers: webMutationHeaders(cookie), payload: { protectedFolderPatterns: ["Private"], remoteStreamBufferMb: 7 } });
    assert.equal(invalidBuffer.statusCode, 400, invalidBuffer.body);
    const savedBuffer = await app.inject({ method: "PATCH", url: "/api/profile/security", headers: webMutationHeaders(cookie), payload: { protectedFolderPatterns: ["Private", "Protected"], remoteStreamBufferMb: 8 } });
    assert.equal(savedBuffer.statusCode, 200, savedBuffer.body);
    assert.equal(savedBuffer.json().remoteStreamBufferMb, 8);

    const codeResponse = await app.inject({ method: "POST", url: "/api/companions/pairing-code", headers: webMutationHeaders(cookie), payload: {} });
    const pairResponse = await app.inject({
      method: "POST",
      url: "/api/agent/pair",
      payload: { code: codeResponse.json().code, companionId, companionName: "Read-ahead CI Companion", version: 15 }
    });
    assert.equal(pairResponse.statusCode, 200, pairResponse.body);
    await prisma.disk.create({ data: { id: diskId, name: "Read-ahead CI Disk", volumeId: `stream-${diskId}` } });
    await prisma.videoFile.create({
      data: { id: fileId, diskId, filename: "big.mp4", extension: ".mp4", absolutePath: "X:\\Videos\\big.mp4", relativePath: "Videos/big.mp4", sizeBytes: size }
    });
    await prisma.companionAgent.update({ where: { installationId: companionId }, data: { mountedDiskIds: [diskId] } });

    const serverUrl = await websocketServerUrl();
    tunnel = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/api/agent/tunnel`);
    await once(tunnel, "open");
    tunnel.send(JSON.stringify({
      type: "tunnel.hello", protocolVersion: 1, companionId, credential: pairResponse.json().credential,
      companionName: "Read-ahead CI Companion", version: 15, capabilities: { control: true, streamRead: true, streamRemux: false }
    }));
    await once(tunnel, "message");
    let inFlight = 0;
    let peak = 0;
    tunnel.on("message", (message, isBinary) => {
      if (isBinary) return;
      const input = JSON.parse(String(message));
      if (input.type === "stream.open") {
        tunnel?.send(JSON.stringify({ type: "stream.ready", requestId: input.requestId, sessionId: input.sessionId, sizeBytes: size, mimeType: "video/mp4" }));
      }
      if (input.type === "stream.range") {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const chunk = file.subarray(input.offset, input.offset + input.length);
        // Later ranges answer first: the server must keep the order.
        setTimeout(() => {
          inFlight -= 1;
          tunnel?.send(JSON.stringify({ type: "stream.chunk", requestId: input.requestId, sessionId: input.sessionId, sequence: 0, bytes: chunk.length, eof: input.offset + chunk.length >= size }));
          tunnel?.send(chunk);
        }, 40 - Math.floor(input.offset / 100_000));
      }
    });

    const sessionResponse = await app.inject({ method: "POST", url: "/api/stream-sessions", headers: webMutationHeaders(cookie), payload: { fileId } });
    assert.equal(sessionResponse.statusCode, 200, sessionResponse.body);
    const sessionId = sessionResponse.json().session.id as string;
    const content = await app.inject({ method: "GET", url: `/api/streams/${sessionId}/content`, headers: { cookie, range: "bytes=100-" } });
    assert.equal(content.statusCode, 206, content.body);
    assert.equal(content.headers["content-range"], `bytes 100-${size - 1}/${size}`);
    assert.equal(Number(content.headers["content-length"]), size - 100);
    assert.deepEqual(content.rawPayload, file.subarray(100));
    assert.ok(peak > 1, "ranges are read ahead in parallel");
  } finally {
    tunnel?.terminate();
    await app.inject({ method: "PATCH", url: "/api/profile/security", headers: webMutationHeaders(await authenticatedCookie()), payload: { protectedFolderPatterns: ["Private", "Protected"], remoteStreamBufferMb: 32 } });
    await prisma.streamSession.deleteMany({ where: { videoFileId: fileId } });
    await prisma.videoFile.deleteMany({ where: { id: fileId } });
    await prisma.disk.deleteMany({ where: { id: diskId } });
    await prisma.companionPairingCode.deleteMany({ where: { claimedById: companionId } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
  }
});

test("a paired streaming Companion serves a bounded HTTP range without exposing a local path", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const companionId = crypto.randomUUID();
  const diskId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  let tunnel: WebSocket | null = null;
  try {
    const cookie = await authenticatedCookie();
    const codeResponse = await app.inject({ method: "POST", url: "/api/companions/pairing-code", headers: webMutationHeaders(cookie), payload: {} });
    const pairResponse = await app.inject({
      method: "POST",
      url: "/api/agent/pair",
      payload: { code: codeResponse.json().code, companionId, companionName: "Streaming CI Companion", version: 15 }
    });
    assert.equal(pairResponse.statusCode, 200, pairResponse.body);
    await prisma.disk.create({ data: { id: diskId, name: "Streaming CI Disk", volumeId: `stream-${diskId}` } });
    await prisma.videoFile.create({
      data: {
        id: fileId,
        diskId,
        filename: "sample.mp4",
        extension: ".mp4",
        absolutePath: "X:\\Videos\\sample.mp4",
        relativePath: "Videos/sample.mp4",
        sizeBytes: 12
      }
    });
    await prisma.companionAgent.update({ where: { installationId: companionId }, data: { mountedDiskIds: [diskId] } });

    const serverUrl = await websocketServerUrl();
    tunnel = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/api/agent/tunnel`);
    await once(tunnel, "open");
    tunnel.send(JSON.stringify({
      type: "tunnel.hello", protocolVersion: 1, companionId, credential: pairResponse.json().credential,
      companionName: "Streaming CI Companion", version: 15, capabilities: { control: true, streamRead: true, streamRemux: false }
    }));
    await once(tunnel, "message");
    tunnel.on("message", (message, isBinary) => {
      if (isBinary) return;
      const input = JSON.parse(String(message));
      if (input.type === "stream.open") {
        tunnel?.send(JSON.stringify({ type: "stream.ready", requestId: input.requestId, sessionId: input.sessionId, sizeBytes: 12, mimeType: "video/mp4" }));
      }
      if (input.type === "stream.range") {
        const chunk = Buffer.from("abcdefghijkl".slice(input.offset, input.offset + input.length));
        setTimeout(() => {
          tunnel?.send(JSON.stringify({ type: "stream.chunk", requestId: input.requestId, sessionId: input.sessionId, sequence: 0, bytes: chunk.length, eof: input.offset + chunk.length >= 12 }));
          tunnel?.send(chunk);
        }, 20);
      }
    });

    const sessionResponse = await app.inject({ method: "POST", url: "/api/stream-sessions", headers: webMutationHeaders(cookie), payload: { fileId } });
    assert.equal(sessionResponse.statusCode, 200, sessionResponse.body);
    const sessionId = sessionResponse.json().session.id as string;
    const incompatibleRemux = await app.inject({ method: "POST", url: "/api/stream-sessions", headers: webMutationHeaders(cookie), payload: { fileId, mode: "remux" } });
    assert.equal(incompatibleRemux.statusCode, 400, incompatibleRemux.body);
    const content = await app.inject({ method: "GET", url: `/api/streams/${sessionId}/content`, headers: { cookie, range: "bytes=2-8" } });
    assert.equal(content.statusCode, 206, content.body);
    assert.equal(content.headers["content-range"], "bytes 2-8/12");
    assert.equal(content.headers["accept-ranges"], "bytes");
    assert.equal(content.body, "cdefghi");
    assert.equal(content.body.includes("X:\\Videos"), false);

    const [firstSeek, secondSeek] = await Promise.all([
      app.inject({ method: "GET", url: `/api/streams/${sessionId}/content`, headers: { cookie, range: "bytes=0-2" } }),
      app.inject({ method: "GET", url: `/api/streams/${sessionId}/content`, headers: { cookie, range: "bytes=9-11" } })
    ]);
    assert.equal(firstSeek.statusCode, 206, firstSeek.body);
    assert.equal(secondSeek.statusCode, 206, secondSeek.body);
    assert.equal(firstSeek.body, "abc");
    assert.equal(secondSeek.body, "jkl");

    await prisma.streamSession.update({ where: { id: sessionId }, data: { ownerUsername: "another-admin" } });
    const foreignOwner = await app.inject({ method: "GET", url: `/api/stream-sessions/${sessionId}`, headers: { cookie } });
    assert.equal(foreignOwner.statusCode, 404);

    await prisma.streamSession.update({ where: { id: sessionId }, data: { ownerUsername: "admin", lastAccessedAt: new Date(Date.now() - 5 * 60 * 1000) } });
    const expired = await app.inject({ method: "GET", url: `/api/stream-sessions/${sessionId}`, headers: { cookie } });
    assert.equal(expired.statusCode, 200, expired.body);
    assert.equal(expired.json().session.status, "expired");
    const unavailable = await app.inject({ method: "GET", url: `/api/streams/${sessionId}/content`, headers: { cookie, range: "bytes=0-1" } });
    assert.equal(unavailable.statusCode, 404);

    const activeResponse = await app.inject({ method: "POST", url: "/api/stream-sessions", headers: webMutationHeaders(cookie), payload: { fileId } });
    assert.equal(activeResponse.statusCode, 200, activeResponse.body);
    const activeSessionId = activeResponse.json().session.id as string;
    const replacementResponse = await app.inject({
      method: "POST",
      url: "/api/stream-sessions",
      headers: webMutationHeaders(cookie),
      payload: { fileId, replaceSessionId: activeSessionId }
    });
    assert.equal(replacementResponse.statusCode, 200, replacementResponse.body);
    assert.notEqual(replacementResponse.json().session.id, activeSessionId);
    assert.equal((await prisma.streamSession.findUnique({ where: { id: activeSessionId } }))?.status, "cancelled");
  } finally {
    tunnel?.terminate();
    await prisma.streamSession.deleteMany({ where: { videoFileId: fileId } });
    await prisma.videoFile.deleteMany({ where: { id: fileId } });
    await prisma.disk.deleteMany({ where: { id: diskId } });
    await prisma.companionPairingCode.deleteMany({ where: { claimedById: companionId } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
  }
});

test("folders added by hand with legacy ids keep heartbeats, deletions and downloads working", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const companionId = crypto.randomUUID();
  const legacyId = `target-${Date.now().toString(36)}-ab12cd`;
  const disk = await prisma.disk.create({ data: { name: `Manual ${legacyId}`, volumeId: legacyId } });
  try {
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
      payload: { version: 7, companionId, companionName: "Legacy folders", mountedDiskCount: 3, mountedDiskIds: [crypto.randomUUID(), legacyId, "bad id with spaces"] }
    });
    assert.equal(heartbeat.statusCode, 200);
    const stored = await prisma.companionAgent.findUnique({ where: { installationId: companionId } });
    assert.deepEqual((stored?.mountedDiskIds as string[]).includes(legacyId), true);
    assert.equal((stored?.mountedDiskIds as string[]).includes("bad id with spaces"), false);

    const cookie = await authenticatedCookie();
    const status = await app.inject({ method: "GET", url: "/api/companion/status", headers: { cookie } });
    assert.equal(status.statusCode, 200);
    assert.ok((status.json().mountedDiskIds as string[]).includes(disk.id));

    for (const url of [`/api/agent/disks/${legacyId}/delete-queue`, `/api/agent/disks/${legacyId}/scan-index`, `/api/agent/downloads/queue?diskId=${legacyId}`]) {
      const response = await app.inject({ method: "GET", url, headers: { ...agentHeaders, "x-videocat-companion-id": companionId } });
      assert.equal(response.statusCode, 200, url);
    }
  } finally {
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
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

    const guardedDeleteQueue = await app.inject({
      method: "GET",
      url: `/api/agent/disks/${diskId}/delete-queue`,
      headers: agentHeaders
    });
    assert.equal(guardedDeleteQueue.statusCode, 200);
    const guardedEntry = guardedDeleteQueue.json().files.find((file: { id: string }) => file.id === keepFile.id);
    assert.equal(guardedEntry.sizeBytes, 2048);
    assert.equal(guardedEntry.modifiedAt, "2026-09-12T12:00:00.000Z");
    assert.equal(guardedEntry.visualFingerprint, null);

    const rejectedReplacement = await app.inject({
      method: "POST",
      url: `/api/agent/files/${keepFile.id}/deletion-result`,
      headers: agentHeaders,
      payload: { status: "identity_mismatch", errorMessage: "File identity changed" }
    });
    assert.equal(rejectedReplacement.statusCode, 200);
    assert.equal(rejectedReplacement.json().deleteMarkCleared, true);
    assert.equal((await prisma.videoFile.findUnique({ where: { id: keepFile.id } }))?.curationStatus, "none");

    const remarkForDeletion = await app.inject({
      method: "PATCH",
      url: `/api/files/${keepFile.id}/curation`,
      headers: webMutationHeaders(cookie),
      payload: { curationStatus: "delete" }
    });
    assert.equal(remarkForDeletion.statusCode, 200);

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

test("stats count pending duplicate groups and drop them once resolved", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let diskId = "";
  try {
    const cookie = await authenticatedCookie();
    const stats = async () => (await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })).json() as { duplicateGroupCount: number; pendingDuplicateGroupCount: number };
    const before = await stats();
    const disk = await prisma.disk.create({ data: { name: `Dupes ${suffix}`, volumeId: `dupes-${suffix}` } });
    diskId = disk.id;
    const sizeBytes = BigInt(7_000_000_000 + Math.floor(Math.random() * 1_000_000));
    const [keep, remove] = await Promise.all(["keep", "remove"].map((name) => prisma.videoFile.create({
      data: { diskId, filename: `${name}-${suffix}.mp4`, extension: "mp4", absolutePath: `X:/${name}-${suffix}.mp4`, relativePath: `${name}-${suffix}.mp4`, sizeBytes, durationSeconds: 600 }
    })));

    const detected = await stats();
    assert.equal(detected.duplicateGroupCount, before.duplicateGroupCount + 1);
    assert.equal(detected.pendingDuplicateGroupCount, before.pendingDuplicateGroupCount + 1);

    const decision = await app.inject({
      method: "POST",
      url: "/api/duplicates/assisted/decision",
      headers: webMutationHeaders(cookie),
      payload: { keepFileId: keep.id, deleteFileId: remove.id, groupFileIds: [keep.id, remove.id] }
    });
    assert.equal(decision.statusCode, 200);

    const resolved = await stats();
    assert.equal(resolved.duplicateGroupCount, before.duplicateGroupCount + 1);
    assert.equal(resolved.pendingDuplicateGroupCount, before.pendingDuplicateGroupCount);
  } finally {
    if (diskId) await prisma.disk.delete({ where: { id: diskId } }).catch(() => undefined);
  }
});

test("folder groups merge same-named folders, filter the catalog by location and honour exclusions", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Testing${suffix}`;
  const disks = await Promise.all(["E", "F"].map((letter) => prisma.disk.create({ data: { name: `Grupo ${letter} ${suffix}`, volumeId: `group-${letter}-${suffix}` } })));
  const cookie = await authenticatedCookie();
  try {
    await prisma.videoFile.createMany({
      data: [
        { diskId: disks[0].id, filename: "a.mp4", extension: "mp4", absolutePath: `E:/${name}/a.mp4`, relativePath: `${name}/a.mp4`, sizeBytes: 1700n },
        { diskId: disks[1].id, filename: "b.mp4", extension: "mp4", absolutePath: `F:/Proyectos/${name}/b.mp4`, relativePath: `Proyectos/${name}/b.mp4`, sizeBytes: 230n },
        { diskId: disks[1].id, filename: "c.mp4", extension: "mp4", absolutePath: "F:/Proyectos/Otro/c.mp4", relativePath: "Proyectos/Otro/c.mp4", sizeBytes: 40n }
      ]
    });
    const diskIds = disks.map((disk) => disk.id).join(",");
    const map = (await app.inject({ method: "GET", url: `/api/folder-groups?diskIds=${diskIds}`, headers: { cookie } })).json();
    const group = map.roots.find((root: { name: string }) => root.name === name);
    assert.equal(group.kind, "group");
    assert.equal(group.sizeBytes, 1930);
    assert.equal(group.locations.length, 2);

    const locations = group.locations.map((location: { diskId: string; path: string }) => ({ d: location.diskId, p: location.path }));
    const files = await app.inject({ method: "GET", url: `/api/files?locations=${encodeURIComponent(JSON.stringify(locations))}&pageSize=50`, headers: { cookie } });
    assert.equal(files.statusCode, 200);
    assert.deepEqual(files.json().files.map((file: { filename: string }) => file.filename).sort(), ["a.mp4", "b.mp4"]);
    const invalid = await app.inject({ method: "GET", url: "/api/files?locations=not-json", headers: { cookie } });
    assert.equal(invalid.statusCode, 400);

    const saved = await app.inject({ method: "PUT", url: "/api/folder-groups/exclusions", headers: webMutationHeaders(cookie), payload: { names: [name, name.toUpperCase()] } });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json().excludedNames, [name]);
    const apart = (await app.inject({ method: "GET", url: `/api/folder-groups?diskIds=${diskIds}`, headers: { cookie } })).json();
    assert.equal(apart.roots.some((root: { kind: string; name: string }) => root.kind === "group" && root.name === name), false);
    assert.equal(apart.repeated.find((entry: { name: string }) => entry.name === name).excluded, true);
  } finally {
    await app.inject({ method: "PUT", url: "/api/folder-groups/exclusions", headers: webMutationHeaders(cookie), payload: { names: [] } });
    for (const disk of disks) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("transfers move a file through staging to a starred folder without losing it in the catalog", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const companionId = crypto.randomUUID();
  const otherCompanion = crypto.randomUUID();
  const agent = (id = companionId) => ({ ...agentHeaders, "x-videocat-companion-id": id });
  const target = await prisma.disk.create({ data: { name: `Destino ${suffix}`, volumeId: `dst-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 1_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `Origen ${suffix}`, volumeId: `src-${suffix}`, totalBytes: 1_000_000_000_000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  try {
    const modifiedAt = new Date("2024-05-01T10:00:00Z");
    await prisma.videoFile.createMany({
      data: [
        { diskId: target.id, filename: "ya.mp4", extension: "mp4", absolutePath: "E:/Testing/ya.mp4", relativePath: "Testing/ya.mp4", sizeBytes: 50n, modifiedAt },
        { diskId: source.id, filename: "clip.mp4", extension: "mp4", absolutePath: "F:/Proyectos/Testing/clip.mp4", relativePath: "Proyectos/Testing/clip.mp4", sizeBytes: 2_000_000n, modifiedAt },
        { diskId: source.id, filename: "ya.mp4", extension: "mp4", absolutePath: "F:/Proyectos/Testing/ya.mp4", relativePath: "Proyectos/Testing/ya.mp4", sizeBytes: 50n, modifiedAt }
      ]
    });
    const clip = await prisma.videoFile.findFirstOrThrow({ where: { diskId: source.id, filename: "clip.mp4" } });
    const copyOfExisting = await prisma.videoFile.findFirstOrThrow({ where: { diskId: source.id, filename: "ya.mp4" } });
    await prisma.videoFileCategory.create({ data: { videoFileId: clip.id, categoryKey: "keep" } });

    const missingFolder = await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: "NoExiste" } });
    assert.equal(missingFolder.statusCode, 404);
    const starred = await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: "Testing/" } });
    assert.equal(starred.statusCode, 200);
    const destinationId = starred.json().destination.id as string;

    const created = await app.inject({ method: "POST", url: "/api/transfers", headers: webMutationHeaders(cookie), payload: { kind: "consolidate", destinationId, fileIds: [clip.id, copyOfExisting.id] } });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().items, 1);
    assert.deepEqual(created.json().skipped, [{ fileId: copyOfExisting.id, reason: "duplicate_at_destination" }]);
    const again = await app.inject({ method: "POST", url: "/api/transfers", headers: webMutationHeaders(cookie), payload: { kind: "consolidate", destinationId, fileIds: [clip.id] } });
    assert.equal(again.statusCode, 409);

    const noIdentity = await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=src-${suffix}`, headers: agentHeaders });
    assert.equal(noIdentity.statusCode, 400);
    const work = (await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=src-${suffix}`, headers: agent() })).json().items;
    assert.equal(work.length, 1);
    const itemId = work[0].id as string;
    assert.deepEqual(work[0].source.identifiers, [`src-${suffix}`, source.id]);
    const step = (from: string, to: string, extra: Record<string, string> = {}, id = companionId) =>
      app.inject({ method: "POST", url: `/api/agent/transfers/items/${itemId}/transition`, headers: agent(id), payload: { from, to, ...extra } });

    assert.equal((await step("pending", "staging")).statusCode, 200);
    assert.equal((await step("staging", "staged", {}, otherCompanion)).statusCode, 409);
    assert.equal((await step("staging", "staged")).statusCode, 400, "the staged copy needs its hash");
    const sha = "a".repeat(64);
    assert.equal((await step("staging", "staged", { sha256: sha })).statusCode, 200);
    assert.equal((await step("staged", "done")).statusCode, 400, "illegal shortcut");
    assert.equal((await step("staging", "staged", { sha256: sha })).statusCode, 409, "stale from state");

    // Marked for deletion while in transit: the delete queue must leave it alone.
    await prisma.videoFile.update({ where: { id: clip.id }, data: { curationStatus: "delete" } });
    const deletes = (await app.inject({ method: "GET", url: `/api/agent/disks/src-${suffix}/delete-queue`, headers: agent() })).json();
    assert.equal(JSON.stringify(deletes).includes(clip.id), false);
    await prisma.videoFile.update({ where: { id: clip.id }, data: { curationStatus: "none" } });

    assert.equal((await step("staged", "source_removed")).statusCode, 200);
    const delivery = (await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=dst-${suffix}`, headers: agent() })).json().items;
    assert.equal(delivery[0].state, "source_removed");
    assert.equal((await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=dst-${suffix}`, headers: agent(otherCompanion) })).json().items.length, 0, "only the Companion holding the copy delivers it");

    assert.equal((await step("source_removed", "delivering", { targetRelativePath: "Otra/clip.mp4" })).statusCode, 400);
    assert.equal((await step("source_removed", "delivering", { targetRelativePath: "Testing/ya.mp4" })).json().reason, "path_taken");
    assert.equal((await step("source_removed", "delivering", { targetRelativePath: "Testing/clip.mp4" })).statusCode, 200);
    assert.equal((await step("delivering", "delivered", { sha256: "b".repeat(64) })).statusCode, 400, "the destination copy must match");
    assert.equal((await step("delivering", "delivered", { sha256: sha, absolutePath: "E:\\Testing\\clip.mp4" })).statusCode, 200);

    const moved = await prisma.videoFile.findUniqueOrThrow({ where: { id: clip.id }, include: { categories: true } });
    assert.equal(moved.diskId, target.id);
    assert.equal(moved.relativePath, "Testing/clip.mp4");
    assert.deepEqual(moved.categories.map((category) => category.categoryKey), ["keep"]);

    assert.equal((await step("delivered", "done")).statusCode, 200);
    const jobs = (await app.inject({ method: "GET", url: "/api/transfers", headers: { cookie } })).json().jobs;
    const job = jobs.find((entry: { destination: { id: string } }) => entry.destination.id === destinationId);
    assert.equal(job.status, "done");
    assert.equal(job.states.done.files, 1);

    const lookup = (await app.inject({ method: "POST", url: "/api/agent/transfers/lookup", headers: agent(), payload: { ids: [itemId] } })).json();
    assert.deepEqual(lookup.items, [{ id: itemId, state: "done" }]);

    // Space is checked against the last scan of the destination, minus files already on their way.
    await prisma.disk.update({ where: { id: target.id }, data: { freeBytes: 1_000_000_000n } });
    // Not enough room is a warning, not a refusal: the file waits in staging until space is freed.
    const identical = await app.inject({ method: "POST", url: "/api/transfers", headers: webMutationHeaders(cookie), payload: { kind: "group", destinationId, fileIds: [copyOfExisting.id] } });
    assert.equal(identical.statusCode, 409, "an identical file at the destination stays for Duplicates");
    const big = await prisma.videoFile.create({ data: { diskId: source.id, filename: "grande.mp4", extension: "mp4", absolutePath: "F:/Proyectos/Testing/grande.mp4", relativePath: "Proyectos/Testing/grande.mp4", sizeBytes: 5_000_000_000n, modifiedAt } });
    const full = await app.inject({ method: "POST", url: "/api/transfers", headers: webMutationHeaders(cookie), payload: { kind: "group", destinationId, fileIds: [big.id] } });
    assert.equal(full.statusCode, 200);
    assert.equal(full.json().spaceWarning.reason, "no_space");
    assert.ok(full.json().spaceWarning.shortBytes > 0);
    const shortNeed = (await app.inject({ method: "GET", url: "/api/transfers/summary", headers: { cookie } })).json().needs
      .find((need: { kind: string; diskId: string }) => need.kind === "space_short" && need.diskId === target.id);
    assert.equal(shortNeed.files, 1);
  } finally {
    await prisma.transferItem.deleteMany({ where: { OR: [{ sourceDiskId: source.id }, { targetDiskId: target.id }] } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: target.id } } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("a drive that no longer exists can be removed, but not while files from it are in staging", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const gone = await prisma.disk.create({ data: { name: `Gone ${suffix}`, volumeId: `gone-${suffix}` } });
  const other = await prisma.disk.create({ data: { name: `Other ${suffix}`, volumeId: `other-${suffix}` } });
  try {
    const cookie = await authenticatedCookie();
    await prisma.videoFile.createMany({
      data: ["a", "b"].map((name) => ({ diskId: gone.id, filename: `${name}.mp4`, extension: "mp4", absolutePath: `G:/V/${name}.mp4`, relativePath: `V/${name}.mp4`, sizeBytes: 10n }))
    });
    const [a, b] = await prisma.videoFile.findMany({ where: { diskId: gone.id }, orderBy: { filename: "asc" } });
    // A transfer from the gone drive to another one, and a starred folder on the gone drive.
    const outDestination = await prisma.transferDestination.create({ data: { diskId: other.id, path: `Dest-${suffix}`, nameKey: "dest" } });
    const outJob = await prisma.transferJob.create({ data: { kind: "group", destinationId: outDestination.id, label: "out" } });
    const pending = await prisma.transferItem.create({
      data: { jobId: outJob.id, videoFileId: a.id, filename: "a.mp4", sourceDiskId: gone.id, sourceRelativePath: "V/a.mp4", targetDiskId: other.id, targetFolder: `Dest-${suffix}`, sizeBytes: 10n, state: "pending" }
    });
    const staged = await prisma.transferItem.create({
      data: { jobId: outJob.id, videoFileId: b.id, filename: "b.mp4", sourceDiskId: gone.id, sourceRelativePath: "V/b.mp4", targetDiskId: other.id, targetFolder: `Dest-${suffix}`, sizeBytes: 10n, state: "source_removed" }
    });
    await prisma.transferDestination.create({ data: { diskId: gone.id, path: `Starred-${suffix}`, nameKey: "starred" } });
    await prisma.folderFavorite.create({ data: { diskId: gone.id, path: "V" } });

    const blocked = await app.inject({ method: "DELETE", url: `/api/admin/disks/${gone.id}`, headers: webMutationHeaders(cookie) });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().inStaging, 1);
    assert.ok(await prisma.disk.findUnique({ where: { id: gone.id } }), "nothing removed while a copy waits in staging");

    await prisma.transferItem.update({ where: { id: staged.id }, data: { state: "done" } });
    const removed = await app.inject({ method: "DELETE", url: `/api/admin/disks/${gone.id}`, headers: webMutationHeaders(cookie) });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.deepEqual(removed.json().deleted, { files: 2, thumbnails: 0, transfersCancelled: 1, transferJobs: 0 });
    assert.equal(await prisma.disk.findUnique({ where: { id: gone.id } }), null);
    assert.equal(await prisma.transferDestination.count({ where: { diskId: gone.id } }), 0);
    assert.equal(await prisma.folderFavorite.count({ where: { diskId: gone.id } }), 0);
    assert.equal((await prisma.transferItem.findUniqueOrThrow({ where: { id: pending.id } })).state, "cancelled");
    assert.equal((await prisma.transferJob.findUniqueOrThrow({ where: { id: outJob.id } })).status, "done");
    const disks = (await app.inject({ method: "GET", url: "/api/disks", headers: { cookie } })).json().disks as Array<{ id: string }>;
    assert.equal(disks.some((disk) => disk.id === gone.id), false);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/admin/disks/${gone.id}`, headers: webMutationHeaders(cookie) })).statusCode, 404);
  } finally {
    await prisma.transferItem.deleteMany({ where: { OR: [{ sourceDiskId: gone.id }, { targetDiskId: other.id }] } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: { in: [gone.id, other.id] } } } });
    for (const disk of [gone, other]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("a catalog search reports the size of every match, not just the page", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Search ${suffix}`, volumeId: `search-${suffix}` } });
  try {
    const cookie = await authenticatedCookie();
    await prisma.videoFile.createMany({
      data: [["cumple_mateo_01", 10], ["cumple_mateo_02", 20], ["playa_2020", 30]].map(([name, size]) => ({
        diskId: disk.id, filename: `${name}.mp4`, extension: "mp4", absolutePath: `S:/V/${name}.mp4`, relativePath: `V/${name}.mp4`, sizeBytes: BigInt(size as number)
      }))
    });
    const page = await app.inject({ method: "GET", url: `/api/files?q=cumple&diskIds=${disk.id}&page=1&pageSize=1`, headers: { cookie } });
    assert.equal(page.statusCode, 200, page.body);
    assert.equal(page.json().files.length, 1);
    assert.equal(page.json().total, 2);
    assert.equal(page.json().totalBytes, 30, "both matches, even with one per page");
    const everything = (await app.inject({ method: "GET", url: `/api/files?diskIds=${disk.id}`, headers: { cookie } })).json();
    assert.equal(everything.totalBytes, 60);
  } finally {
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("a damaged video is reported as such and not retried on every scan", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Damaged ${suffix}`, volumeId: `damaged-${suffix}` } });
  try {
    const scanId = (await app.inject({ method: "POST", url: "/api/agent/scan/start", headers: agentHeaders, payload: { diskId: disk.id, rootPath: "D:\\" } })).json().scan.id;
    const damaged = "Archivo de video incompleto o dañado: falta el índice del MP4 (moov): la grabación o la copia se cortó antes de terminar. Si todavía se está copiando, se vuelve a leer cuando cambie.\nDetalle: moov atom not found";
    const batch = await app.inject({
      method: "POST",
      url: "/api/agent/files/batch",
      headers: agentHeaders,
      payload: {
        scanId,
        diskId: disk.id,
        files: [
          { filename: "cut.mp4", extension: ".mp4", absolutePath: "D:\\cut.mp4", relativePath: "cut.mp4", sizeBytes: 10, modifiedAt: "2026-10-01T10:00:00.000Z", status: "metadata_failed", errorMessage: damaged },
          { filename: "probe.mp4", extension: ".mp4", absolutePath: "D:\\probe.mp4", relativePath: "probe.mp4", sizeBytes: 10, modifiedAt: "2026-10-01T10:00:00.000Z", status: "metadata_failed", errorMessage: "ffprobe timed out after 60 s" },
          { filename: "stuck.mp4", extension: ".mp4", absolutePath: "D:\\stuck.mp4", relativePath: "stuck.mp4", sizeBytes: 10, modifiedAt: "2026-10-01T10:00:00.000Z", status: "metadata_failed", errorMessage: "Archivo en riesgo: la lectura no respondió en 180 s aunque el disco seguía conectado; puede tener sectores dañados. Los próximos escaneos no lo leen durante 30 días. Conviene copiarlo o revisar el disco." }
        ]
      }
    });
    assert.equal(batch.statusCode, 200, batch.body);
    const errors = await prisma.agentError.findMany({ where: { diskId: disk.id }, orderBy: { relativePath: "asc" } });
    assert.deepEqual(errors.map((error) => [error.relativePath, error.category]), [["cut.mp4", "damaged_file"], ["probe.mp4", "metadata"], ["stuck.mp4", "at_risk_file"]]);
    const queue = (await app.inject({ method: "GET", url: `/api/agent/disks/${disk.id}/thumbnail-repair-queue`, headers: agentHeaders })).json();
    assert.deepEqual(queue.files.map((file: { relativePath: string }) => file.relativePath), ["probe.mp4"], "a tool failure is retried, a damaged or at-risk file is not");
  } finally {
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("files with a read problem are listed, counted per drive and read again on the next scan when asked", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Failing ${suffix}`, volumeId: `failing-${suffix}` } });
  try {
    const cookie = await authenticatedCookie();
    const atRisk = "Archivo en riesgo: la lectura no respondió en 30 s aunque el disco seguía conectado; puede tener sectores dañados. Los próximos escaneos no lo leen durante 30 días. Conviene copiarlo o revisar el disco.";
    const file = (name: string, status: string, errorMessage: string | null) => ({
      filename: name, extension: ".mp4", absolutePath: `D:\\${name}`, relativePath: name, sizeBytes: 10, modifiedAt: "2026-10-01T10:00:00.000Z", status, errorMessage
    });
    const upload = async (files: unknown[]) => {
      const scanId = (await app.inject({ method: "POST", url: "/api/agent/scan/start", headers: agentHeaders, payload: { diskId: disk.id, rootPath: "D:\\" } })).json().scan.id;
      const batch = await app.inject({ method: "POST", url: "/api/agent/files/batch", headers: agentHeaders, payload: { scanId, diskId: disk.id, files } });
      assert.equal(batch.statusCode, 200, batch.body);
    };
    await upload([file("stuck.mp4", "metadata_failed", atRisk), file("stuck2.mp4", "metadata_failed", atRisk), file("fine.mp4", "scanned", null)]);

    const listed = (await app.inject({ method: "GET", url: `/api/files?diskIds=${disk.id}&readProblemOnly=true`, headers: { cookie } })).json();
    assert.deepEqual(listed.files.map((item: { filename: string }) => item.filename).sort(), ["stuck.mp4", "stuck2.mp4"]);
    const overview = async () => ((await app.inject({ method: "GET", url: "/api/admin/disks/overview", headers: { cookie } })).json().disks as Array<{ disk: { id: string }; catalog: { readProblemFiles: number; readRetryFiles: number } }>)
      .find((item) => item.disk.id === disk.id)!.catalog;
    assert.deepEqual(await overview(), { ...(await overview()), readProblemFiles: 2, readRetryFiles: 0 });

    // One file from its detail, then the whole drive; a file without a read problem is never touched.
    const stuck = listed.files.find((item: { filename: string }) => item.filename === "stuck.mp4");
    const one = await app.inject({ method: "POST", url: "/api/files/read-retry", headers: webMutationHeaders(cookie), payload: { fileIds: [stuck.id] } });
    assert.equal(one.json().requested, 1);
    assert.equal((await overview()).readRetryFiles, 1);
    const all = await app.inject({ method: "POST", url: "/api/files/read-retry", headers: webMutationHeaders(cookie), payload: { diskId: disk.id } });
    assert.equal(all.json().requested, 2);
    assert.equal(await prisma.videoFile.count({ where: { diskId: disk.id, readRetryAt: { not: null } } }), 2);

    const index = (await app.inject({ method: "GET", url: `/api/agent/disks/${disk.id}/scan-index`, headers: agentHeaders })).json();
    assert.deepEqual(index.readRetry.sort(), ["stuck.mp4", "stuck2.mp4"]);

    // The next scan read one fine and the other failed again: neither waits for a retry any more.
    await upload([file("stuck.mp4", "scanned", null), file("stuck2.mp4", "metadata_failed", atRisk)]);
    assert.deepEqual((await app.inject({ method: "GET", url: `/api/agent/disks/${disk.id}/scan-index`, headers: agentHeaders })).json().readRetry, []);
    const after = await overview();
    assert.equal(after.readProblemFiles, 1);
    assert.equal(after.readRetryFiles, 0);
  } finally {
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("SMART checks from the Companion give each drive its health and a dismissible alert when it is failing", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Smart ${suffix}`, volumeId: `smart-${suffix}` } });
  try {
    const cookie = await authenticatedCookie();
    const report = (reallocated: number, uncorrectable: number) => ({
      smartPassed: true, model: "WDC WD40NMZW", serial: `SN-${suffix}`, protocol: "ATA", temperature: 39, powerOnHours: 1200,
      attributes: [{ id: 5, name: "Reallocated_Sector_Ct", raw: reallocated }, { id: 198, name: "Offline_Uncorrectable", raw: uncorrectable }],
      nvme: null, messages: []
    });
    const upload = (checkedAt: string, value: ReturnType<typeof report> | null) => app.inject({
      method: "POST", url: "/api/agent/disk-health", headers: agentHeaders,
      // The Companion names drives by their marker id (volumeId here) or catalog id.
      payload: { disks: [{ diskId: disk.volumeId, checkedAt, report: value }, { diskId: "not-a-drive", checkedAt, report: value }] }
    });
    const health = async () => ((await app.inject({ method: "GET", url: "/api/admin/disks/overview", headers: { cookie } })).json().disks as Array<{ disk: { id: string }; health: { status: string; items: Array<{ key: string }> } | null }>)
      .find((item) => item.disk.id === disk.id)!.health;
    const alerts = async () => ((await app.inject({ method: "GET", url: "/api/disk-health/alerts", headers: { cookie } })).json().alerts as Array<{ diskId: string }>)
      .filter((alert) => alert.diskId === disk.id);

    assert.equal(await health(), null);
    assert.equal((await upload("2026-10-20T10:00:00.000Z", report(4, 0))).json().saved, 1);
    assert.equal((await health())!.status, "attention");
    assert.equal((await alerts()).length, 0, "only a probable failure raises the alert");

    await upload("2026-10-21T10:00:00.000Z", report(4, 2));
    assert.equal((await health())!.status, "failing");
    assert.equal((await alerts()).length, 1);
    const dismissed = await app.inject({ method: "POST", url: `/api/disk-health/${disk.id}/dismiss`, headers: webMutationHeaders(cookie) });
    assert.equal(dismissed.statusCode, 200);
    assert.equal((await alerts()).length, 0);

    // An older check arriving late changes nothing; a worse one brings the alert back.
    await upload("2026-10-19T10:00:00.000Z", report(0, 0));
    assert.equal((await health())!.status, "failing");
    await upload("2026-10-22T10:00:00.000Z", report(9, 2));
    assert.ok((await health())!.items.some((item) => item.key === "reallocatedGrowing"));
    assert.equal((await alerts()).length, 1);

    // A USB adapter that blocks SMART: no data, no alert.
    await upload("2026-10-23T10:00:00.000Z", null);
    assert.equal((await health())!.status, "unavailable");
    assert.equal((await alerts()).length, 0);
  } finally {
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("a scan of the source drive does not hide a file that is waiting in staging", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Scan ${suffix}`, volumeId: `scan-${suffix}`, totalBytes: 10n, freeBytes: 10n } });
  try {
    const modifiedAt = "2026-09-12T12:00:00.000Z";
    await prisma.videoFile.createMany({
      data: ["seen", "moving", "gone"].map((name) => ({ diskId: disk.id, filename: `${name}.mp4`, extension: "mp4", absolutePath: `S:/V/${name}.mp4`, relativePath: `V/${name}.mp4`, sizeBytes: 10n, modifiedAt: new Date(modifiedAt) }))
    });
    const moving = await prisma.videoFile.findFirstOrThrow({ where: { diskId: disk.id, filename: "moving.mp4" } });
    const destination = await prisma.transferDestination.create({ data: { diskId: disk.id, path: `Destino-${suffix}`, nameKey: "destino" } });
    const job = await prisma.transferJob.create({ data: { kind: "group", destinationId: destination.id, label: "test" } });
    await prisma.transferItem.create({
      data: { jobId: job.id, videoFileId: moving.id, filename: "moving.mp4", sourceDiskId: disk.id, sourceRelativePath: "V/moving.mp4", targetDiskId: disk.id, targetFolder: `Destino-${suffix}`, sizeBytes: 10n, state: "source_removed" }
    });

    const scanId = (await app.inject({ method: "POST", url: "/api/agent/scan/start", headers: agentHeaders, payload: { diskId: disk.id, rootPath: "S:\\" } })).json().scan.id;
    await app.inject({
      method: "POST",
      url: "/api/agent/files/batch",
      headers: agentHeaders,
      payload: { scanId, diskId: disk.id, files: [{ filename: "seen.mp4", extension: ".mp4", absolutePath: "S:\\V\\seen.mp4", relativePath: "V/seen.mp4", sizeBytes: 10, modifiedAt, status: "scanned" }] }
    });
    const finish = await app.inject({ method: "POST", url: "/api/agent/scan/finish", headers: agentHeaders, payload: { scanId, reconcile: true, scanRoots: ["."] } });
    assert.equal(finish.statusCode, 200);
    assert.equal(finish.json().reconciliation.markedAbsent, 1, "only the file that really vanished");
    const states = await prisma.videoFile.findMany({ where: { diskId: disk.id }, select: { filename: true, isPresent: true }, orderBy: { filename: "asc" } });
    assert.deepEqual(states.map((file) => [file.filename, file.isPresent]), [["gone.mp4", false], ["moving.mp4", true], ["seen.mp4", true]]);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: disk.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: disk.id } } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("paused and cancelled transfers stop handing out new work", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const companionId = crypto.randomUUID();
  const agent = { ...agentHeaders, "x-videocat-companion-id": companionId };
  const target = await prisma.disk.create({ data: { name: `D ${suffix}`, volumeId: `pd-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 2_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `S ${suffix}`, volumeId: `ps-${suffix}` } });
  const cookie = await authenticatedCookie();
  try {
    await prisma.videoFile.createMany({
      data: [
        { diskId: target.id, filename: "a.mp4", extension: "mp4", absolutePath: "E:/Dest/a.mp4", relativePath: "Dest/a.mp4", sizeBytes: 1n },
        { diskId: source.id, filename: "b.mp4", extension: "mp4", absolutePath: "F:/b.mp4", relativePath: "Dest/b.mp4", sizeBytes: 1n }
      ]
    });
    const file = await prisma.videoFile.findFirstOrThrow({ where: { diskId: source.id } });
    const destinationId = (await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: "Dest" } })).json().destination.id;
    const jobId = (await app.inject({ method: "POST", url: "/api/transfers", headers: webMutationHeaders(cookie), payload: { kind: "group", destinationId, fileIds: [file.id] } })).json().job.id;
    const work = () => app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=ps-${suffix}`, headers: agent }).then((response) => response.json().items.length);

    assert.equal(await work(), 1);
    assert.equal((await app.inject({ method: "POST", url: `/api/transfers/${jobId}/pause`, headers: webMutationHeaders(cookie) })).statusCode, 200);
    assert.equal(await work(), 0);
    assert.equal((await app.inject({ method: "POST", url: `/api/transfers/${jobId}/resume`, headers: webMutationHeaders(cookie) })).statusCode, 200);
    assert.equal(await work(), 1);
    const blocked = await app.inject({ method: "DELETE", url: `/api/transfers/destinations/${destinationId}`, headers: webMutationHeaders(cookie) });
    assert.equal(blocked.statusCode, 409);
    const cancelled = await app.inject({ method: "POST", url: `/api/transfers/${jobId}/cancel`, headers: webMutationHeaders(cookie) });
    assert.equal(cancelled.json().cancelledFiles, 1);
    assert.equal(await work(), 0);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/transfers/destinations/${destinationId}`, headers: webMutationHeaders(cookie) })).statusCode, 200);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: source.id } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("consolidation plans folders, creates the transfer and tells what to connect", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const companionId = crypto.randomUUID();
  const agent = { ...agentHeaders, "x-videocat-companion-id": companionId };
  const target = await prisma.disk.create({ data: { name: `Grande ${suffix}`, volumeId: `cg-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 1_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `Chico ${suffix}`, volumeId: `cc-${suffix}`, totalBytes: 1_000_000_000_000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  try {
    await prisma.videoFile.createMany({
      data: [
        { diskId: target.id, filename: "a.mp4", extension: "mp4", absolutePath: "E:/Testing/a.mp4", relativePath: "Testing/a.mp4", sizeBytes: 70n },
        { diskId: source.id, filename: "b.mp4", extension: "mp4", absolutePath: "F:/Testing/b.mp4", relativePath: "Testing/b.mp4", sizeBytes: 30n },
        { diskId: source.id, filename: "c.mp4", extension: "mp4", absolutePath: "F:/Testing/sub/c.mp4", relativePath: "Testing/sub/c.mp4", sizeBytes: 20n },
        { diskId: source.id, filename: "a.mp4", extension: "mp4", absolutePath: "F:/Testing/a.mp4", relativePath: "Testing/a.mp4", sizeBytes: 70n },
        { diskId: source.id, filename: "fuera.mp4", extension: "mp4", absolutePath: "F:/TestingX/fuera.mp4", relativePath: "TestingX/fuera.mp4", sizeBytes: 5n }
      ]
    });
    const destinationId = (await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: "Testing" } })).json().destination.id;
    const payload = { destinationId, sources: [{ d: source.id, p: "Testing" }, { d: target.id, p: "Testing" }] };

    // The starred folder lists its size and its namesakes, and knows another one is larger.
    const starredList = (await app.inject({ method: "GET", url: "/api/transfers/destinations", headers: { cookie } })).json().destinations;
    const starredHere = starredList.find((entry: { id: string }) => entry.id === destinationId);
    assert.deepEqual([starredHere.sizeBytes, starredHere.fileCount, starredHere.largest], [70, 1, false]);
    assert.deepEqual(starredHere.namesakes.map((entry: { diskId: string; path: string; sizeBytes: number }) => [entry.diskId, entry.path, entry.sizeBytes]), [[source.id, "Testing", 120]]);

    const preview = await app.inject({ method: "POST", url: "/api/transfers/consolidate/preview", headers: webMutationHeaders(cookie), payload });
    assert.equal(preview.statusCode, 200);
    const plan = preview.json();
    assert.equal(plan.files, 2, "b and c move; the identical a stays for Duplicates; TestingX is another folder");
    assert.equal(plan.neededBytes, 50);
    assert.equal(plan.fits, true);
    assert.equal(plan.skipped.duplicates, 1);
    assert.deepEqual(plan.sources.map((entry: { path: string; files: number }) => [entry.path, entry.files]), [["Testing", 2]], "the destination itself is not a source");
    assert.equal(await prisma.transferJob.count({ where: { destinationId } }), 0, "a preview creates nothing");

    const onlyDestination = await app.inject({ method: "POST", url: "/api/transfers/consolidate/preview", headers: webMutationHeaders(cookie), payload: { destinationId, sources: [{ d: target.id, p: "Testing/" }] } });
    assert.equal(onlyDestination.statusCode, 400);

    const created = await app.inject({ method: "POST", url: "/api/transfers/consolidate", headers: webMutationHeaders(cookie), payload });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().items, 2);
    const repeated = await app.inject({ method: "POST", url: "/api/transfers/consolidate", headers: webMutationHeaders(cookie), payload });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.json().reason, "nothing_to_move");

    // The catalog shows the file as in transit and the stats count the transfer.
    const listed = (await app.inject({ method: "GET", url: `/api/files?diskId=${source.id}&pageSize=50`, headers: { cookie } })).json();
    const moving = listed.files.find((file: { filename: string }) => file.filename === "b.mp4");
    assert.deepEqual(moving.transfer, { state: "pending", targetDiskId: target.id, targetFolder: "Testing" });
    assert.equal(listed.files.find((file: { filename: string }) => file.filename === "fuera.mp4").transfer, null);
    assert.ok((await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })).json().activeTransferJobs >= 1);

    // The Companion reports its staging folder and the source drive.
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: agent,
      payload: { companionId, mountedDiskIds: [`cc-${suffix}`], staging: { configured: true, path: "D:\\VideoCAT\\temp", freeBytes: 500, totalBytes: 1000 } }
    });
    assert.equal(heartbeat.statusCode, 200);
    const summary = (await app.inject({ method: "GET", url: "/api/transfers/summary", headers: { cookie } })).json();
    assert.equal(summary.staging.freeBytes, 500);
    const sourceNeed = summary.needs.find((need: { diskId: string }) => need.diskId === source.id);
    assert.deepEqual([sourceNeed.kind, sourceNeed.files, sourceNeed.bytes, sourceNeed.connected, sourceNeed.diskName], ["connect_source", 2, 50, true, `Chico ${suffix}`]);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: source.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: target.id } } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("grouping finds similar file names, groups with F, ignores with J and undoes both", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const folder = `Testing${suffix}001`;
  const target = await prisma.disk.create({ data: { name: `Destino ${suffix}`, volumeId: `gt-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 1_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `Origen ${suffix}`, volumeId: `gs-${suffix}`, totalBytes: 1_000_000_000_000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  const file = (diskId: string, relativePath: string, sizeBytes = 10n) => ({ diskId, filename: relativePath.split("/").pop()!, extension: "mp4", absolutePath: `X:/${relativePath}`, relativePath, sizeBytes });
  try {
    await prisma.videoFile.createMany({
      data: [
        file(target.id, `Proyectos/${folder}/ya-dentro_${folder}.mp4`),
        file(target.id, `Proyectos/${folder}/igual.mp4`, 77n),
        file(source.id, `Sueltos/.${folder.toUpperCase()}_toma1.mp4`),
        file(source.id, `Sueltos/${folder.replace("001", "_001")} toma2.mp4`),
        file(source.id, `Sueltos/${folder.replace("ing", "ng")}.mp4`),
        file(source.id, `Sueltos/${folder.replace("001", "002")}.mp4`),
        file(source.id, `Sueltos/otro.mp4`),
        file(source.id, `Copia/igual_${folder}.mp4`, 77n),
        file(source.id, `Private/${folder}_secreto.mp4`)
      ]
    });
    await prisma.videoFile.updateMany({ where: { diskId: source.id, filename: `igual_${folder}.mp4` }, data: { filename: "igual.mp4" } });

    const folders = (await app.inject({ method: "GET", url: `/api/transfers/folders?q=${encodeURIComponent(`testing ${suffix}`)}`, headers: { cookie } })).json().folders;
    const found = folders.find((entry: { diskId: string }) => entry.diskId === target.id);
    assert.deepEqual([found.path, found.files, found.destinationId], [`Proyectos/${folder}`, 2, null]);

    const destinationId = (await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: found.path } })).json().destination.id;
    const candidates = async () => (await app.inject({ method: "POST", url: "/api/transfers/group/candidates", headers: webMutationHeaders(cookie), payload: { destinationId } })).json();
    const first = await candidates();
    assert.equal(first.exact, 2, "upper case with a dot and the separated name");
    assert.equal(first.similar, 1, "one letter missing; a different number does not count");
    assert.equal(first.skipped.inside, 1);
    assert.equal(first.skipped.duplicates, 0, "igual.mp4 does not carry the name");
    assert.equal(first.items.length, 3);
    assert.equal(first.items[2].match, "similar");

    const cards = (await app.inject({ method: "POST", url: "/api/files/by-ids", headers: webMutationHeaders(cookie), payload: { ids: first.items.map((item: { id: string }) => item.id).reverse() } })).json().files;
    assert.equal(cards.length, 3);
    assert.equal(cards[0].id, first.items[2].id, "cards come back in the requested order");

    const decide = (fileId: string, decision: "group" | "ignore", url = "/api/transfers/group/decide") =>
      app.inject({ method: "POST", url, headers: webMutationHeaders(cookie), payload: { destinationId, fileId, decision } });
    const [grouped, alsoGrouped, ignored] = first.items.map((item: { id: string }) => item.id);
    assert.equal((await decide(grouped, "group")).statusCode, 200);
    assert.equal((await decide(alsoGrouped, "group")).statusCode, 200);
    assert.equal((await decide(ignored, "ignore")).statusCode, 200);
    const jobs = await prisma.transferJob.findMany({ where: { destinationId }, include: { items: true } });
    assert.equal(jobs.length, 1, "one grouping transfer collects the session");
    assert.equal(jobs[0].kind, "group");
    assert.equal(jobs[0].items.length, 2);
    const after = await candidates();
    assert.deepEqual([after.total, after.skipped.inTransfer, after.skipped.ignored], [0, 2, 1]);
    assert.equal((await decide(grouped, "group")).statusCode, 409, "already in a transfer");

    // Undo: an ignore is forgotten; a grouped file leaves while still pending, not once it started.
    assert.equal((await decide(ignored, "ignore", "/api/transfers/group/undo")).statusCode, 200);
    assert.equal((await decide(grouped, "group", "/api/transfers/group/undo")).statusCode, 200);
    await prisma.transferItem.updateMany({ where: { videoFileId: alsoGrouped }, data: { state: "staging" } });
    const late = await decide(alsoGrouped, "group", "/api/transfers/group/undo");
    assert.equal(late.statusCode, 409);
    assert.equal(late.json().reason, "already_started");
    assert.equal((await candidates()).total, 2);

    // Optional keywords widen the search; the folder name is always searched.
    const aliasFile = await prisma.videoFile.create({ data: file(source.id, `Otros/sesion-alias${suffix}-final.mp4`) });
    const keywordsUrl = `/api/transfers/destinations/${destinationId}/keywords`;
    const tooShort = await app.inject({ method: "PUT", url: keywordsUrl, headers: webMutationHeaders(cookie), payload: { keywords: ["ab"] } });
    assert.equal(tooShort.statusCode, 400);
    const saved = await app.inject({ method: "PUT", url: keywordsUrl, headers: webMutationHeaders(cookie), payload: { keywords: [`Alias ${suffix}`, folder, `alias-${suffix}`] } });
    assert.deepEqual(saved.json().keywords, [`Alias ${suffix}`], "the folder name and repeated spellings are dropped");
    const starredNow = (await app.inject({ method: "GET", url: "/api/transfers/destinations", headers: { cookie } })).json().destinations.find((entry: { id: string }) => entry.id === destinationId);
    assert.deepEqual(starredNow.groupKeywords, [`Alias ${suffix}`]);
    const widened = await candidates();
    assert.deepEqual(widened.keywords, [folder, `Alias ${suffix}`]);
    const byAlias = widened.items.find((item: { id: string }) => item.id === aliasFile.id);
    assert.deepEqual([byAlias.match, byAlias.keyword], ["exact", `Alias ${suffix}`]);
    assert.ok(widened.items.filter((item: { keyword: string }) => item.keyword === folder).length >= 1);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: source.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: target.id } } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("transfer transitions cannot overwrite a cancel or a claim made at the same moment", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Race ${suffix}`, volumeId: `race-${suffix}`, totalBytes: 10n, freeBytes: 10n } });
  try {
    await prisma.videoFile.createMany({
      data: ["a", "b"].map((name) => ({ diskId: disk.id, filename: `${name}.mp4`, extension: "mp4", absolutePath: `R:/${name}.mp4`, relativePath: `V/${name}.mp4`, sizeBytes: 1n }))
    });
    const files = await prisma.videoFile.findMany({ where: { diskId: disk.id }, orderBy: { filename: "asc" } });
    const destination = await prisma.transferDestination.create({ data: { diskId: disk.id, path: `D-${suffix}`, nameKey: "d" } });
    const job = await prisma.transferJob.create({ data: { kind: "group", destinationId: destination.id, label: "race" } });
    const [first, second] = await Promise.all(files.map((file) => prisma.transferItem.create({
      data: { jobId: job.id, videoFileId: file.id, filename: file.filename, sourceDiskId: disk.id, sourceRelativePath: file.relativePath, targetDiskId: disk.id, targetFolder: `D-${suffix}`, sizeBytes: 1n }
    })));
    const claim = (itemId: string, companion: string) => app.inject({
      method: "POST",
      url: `/api/agent/transfers/items/${itemId}/transition`,
      headers: { ...agentHeaders, "x-videocat-companion-id": companion },
      payload: { from: "pending", to: "staging" }
    });

    // Two Companions claim the same file at once: exactly one gets it.
    const results = await Promise.all([claim(first.id, crypto.randomUUID()), claim(first.id, crypto.randomUUID())]);
    assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 409]);

    // A cancel lands first: the Companion's claim based on the old state is refused.
    await prisma.transferItem.update({ where: { id: second.id }, data: { state: "cancelled" } });
    const late = await claim(second.id, crypto.randomUUID());
    assert.equal(late.statusCode, 409);
    assert.equal((await prisma.transferItem.findUniqueOrThrow({ where: { id: second.id } })).state, "cancelled");
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: disk.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: disk.id } } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("the Companion reports live activity and the free space of connected drives", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const companionId = crypto.randomUUID();
  const agent = { ...agentHeaders, "x-videocat-companion-id": companionId };
  const disk = await prisma.disk.create({ data: { name: `Vivo ${suffix}`, volumeId: `live-${suffix}`, totalBytes: 1000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  try {
    const copying = { kind: "transfer", phase: "staging", filename: "clip.mp4", from: "LaCie", to: "Carpeta temporal", bytesDone: 40, bytesTotal: 100, bytesPerSecond: 20, startedAt: Date.now() };
    const mismatch = await app.inject({ method: "POST", url: "/api/agent/companion/activity", headers: agent, payload: { companionId: crypto.randomUUID(), activities: [copying] } });
    assert.equal(mismatch.statusCode, 400, "a Companion only reports for itself");
    const reported = await app.inject({ method: "POST", url: "/api/agent/companion/activity", headers: agent, payload: { companionId, activities: [copying] } });
    assert.equal(reported.statusCode, 200);
    const activity = (await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json();
    const mine = activity.companions.find((entry: { companionId: string }) => entry.companionId === companionId);
    assert.deepEqual([mine.activities[0].filename, mine.activities[0].bytesDone], ["clip.mp4", 40]);
    assert.equal(typeof activity.waiting.transfers, "number");
    assert.ok(Array.isArray(activity.recent));

    // The heartbeat keeps free space current and an empty activity list means idle.
    const beat = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: agent,
      payload: { companionId, mountedDiskIds: [`live-${suffix}`], disks: [{ diskId: `live-${suffix}`, freeBytes: 600, totalBytes: 1000 }, { diskId: "bad id!", freeBytes: 1, totalBytes: 2 }], activities: [] }
    });
    assert.equal(beat.statusCode, 200);
    const updated = await prisma.disk.findUniqueOrThrow({ where: { id: disk.id } });
    assert.deepEqual([Number(updated.freeBytes), Number(updated.totalBytes)], [600, 1000]);
    const idle = (await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json();
    assert.equal(idle.companions.some((entry: { companionId: string }) => entry.companionId === companionId), false);

    // Downloads come first: while they run, Traslados says transfers are waiting.
    const waiting = await app.inject({ method: "POST", url: "/api/agent/companion/activity", headers: agent, payload: { companionId, activities: [], transfersWaiting: true } });
    assert.equal(waiting.statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/transfers/summary", headers: { cookie } })).json().waitingForDownloads, true);
    assert.equal((await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json().transfersWaitingForDownloads, true);
    await app.inject({ method: "POST", url: "/api/agent/companion/activity", headers: agent, payload: { companionId, activities: [], transfersWaiting: false } });
    assert.equal((await app.inject({ method: "GET", url: "/api/transfers/summary", headers: { cookie } })).json().waitingForDownloads, false);

    // The accent chosen in the web reaches the Companion, for its tray icon.
    assert.equal((await app.inject({ method: "PUT", url: "/api/profile/appearance", headers: webMutationHeaders(cookie), payload: { accent: "lila" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url: "/api/profile/appearance", headers: webMutationHeaders(cookie), payload: { accent: "uva" } })).statusCode, 200);
    const painted = await app.inject({ method: "POST", url: "/api/agent/companion/heartbeat", headers: agent, payload: { companionId, mountedDiskIds: [`live-${suffix}`], activities: [] } });
    assert.equal(painted.json().appearance.accent, "#8b5cf6");
    await app.inject({ method: "PUT", url: "/api/profile/appearance", headers: webMutationHeaders(cookie), payload: { accent: "naranja" } });

    // "Detener traslados": the order reaches the Companion in its heartbeat; the web shows it pending
    // until the Companion reports stopping (finishing its file) and then stopped.
    const stop = await app.inject({ method: "POST", url: "/api/transfers/companion/stop", headers: webMutationHeaders(cookie), payload: {} });
    assert.equal(stop.statusCode, 200, stop.body);
    assert.deepEqual(stop.json().transfers, { live: true, mode: "running", pending: "stop" });
    const orders = await app.inject({ method: "POST", url: "/api/agent/companion/heartbeat", headers: agent, payload: { companionId, mountedDiskIds: [`live-${suffix}`], activities: [], transfersMode: "stopping" } });
    assert.ok(orders.json().commands.transfersStopRequestedAt > 0);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json().transfers, { live: true, mode: "stopping", pending: null });
    await app.inject({ method: "POST", url: "/api/agent/companion/activity", headers: agent, payload: { companionId, activities: [], transfersMode: "stopped" } });
    assert.equal((await app.inject({ method: "GET", url: "/api/transfers/summary", headers: { cookie } })).json().transfersMode, "stopped");
    const resume = await app.inject({ method: "POST", url: "/api/transfers/companion/resume", headers: webMutationHeaders(cookie), payload: {} });
    assert.deepEqual(resume.json().transfers, { live: true, mode: "stopped", pending: "resume" });
    const resumed = await app.inject({ method: "POST", url: "/api/agent/companion/heartbeat", headers: agent, payload: { companionId, mountedDiskIds: [`live-${suffix}`], activities: [], transfersMode: "running" } });
    assert.ok(resumed.json().commands.transfersResumeRequestedAt >= resumed.json().commands.transfersStopRequestedAt);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json().transfers, { live: true, mode: "running", pending: null });
    assert.equal(await prisma.actionAudit.count({ where: { action: { in: ["transfers.stop", "transfers.resume"] } } }) >= 2, true);

    // With that drive connected, Actividad says how much is left before it can be unplugged.
    const destination = await prisma.transferDestination.create({ data: { diskId: disk.id, path: `Dest-${suffix}`, nameKey: "dest" } });
    const job = await prisma.transferJob.create({ data: { kind: "group", destinationId: destination.id, label: "live" } });
    const other = crypto.randomUUID();
    await prisma.transferItem.createMany({
      data: [
        { jobId: job.id, filename: "leaving.mp4", sourceDiskId: disk.id, sourceRelativePath: "V/leaving.mp4", targetDiskId: other, targetFolder: "X", sizeBytes: 30n, state: "pending" },
        { jobId: job.id, filename: "left.mp4", sourceDiskId: disk.id, sourceRelativePath: "V/left.mp4", targetDiskId: other, targetFolder: "X", sizeBytes: 20n, state: "source_removed", stagedAt: new Date(Date.now() + 1000) }
      ]
    });
    const work = (await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json().connected;
    const drive = work.disks.find((entry: { diskId: string }) => entry.diskId === disk.id);
    assert.deepEqual([drive.diskName, drive.remaining, drive.total, drive.canDisconnect], [`Vivo ${suffix}`, { files: 1, bytes: 30 }, { files: 2, bytes: 50 }, false]);
    await prisma.transferItem.updateMany({ where: { jobId: job.id, state: "pending" }, data: { state: "cancelled" } });
    const ready = (await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })).json().connected;
    assert.equal(ready.disks.find((entry: { diskId: string }) => entry.diskId === disk.id).canDisconnect, true);
  } finally {
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: disk.id } } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("favourite folders never offer their videos to move", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const target = await prisma.disk.create({ data: { name: `Fav destino ${suffix}`, volumeId: `fd-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 1_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `Fav origen ${suffix}`, volumeId: `fo-${suffix}`, totalBytes: 1_000_000_000_000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  const name = `Favorita${suffix}`;
  try {
    await prisma.videoFile.createMany({
      data: [
        { diskId: target.id, filename: "base.mp4", extension: "mp4", absolutePath: "E:/x", relativePath: `${name}/base.mp4`, sizeBytes: 10n },
        { diskId: source.id, filename: `${name}-a.mp4`, extension: "mp4", absolutePath: "F:/a", relativePath: `${name}/${name}-a.mp4`, sizeBytes: 5n },
        { diskId: source.id, filename: `${name}-b.mp4`, extension: "mp4", absolutePath: "F:/b", relativePath: `${name}/Sub/${name}-b.mp4`, sizeBytes: 5n }
      ]
    });
    const destinationId = (await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: name } })).json().destination.id;
    const sources = [{ d: source.id, p: name }];
    // A transfer created before the folder becomes a favourite.
    const created = await app.inject({ method: "POST", url: "/api/transfers/consolidate", headers: webMutationHeaders(cookie), payload: { destinationId, sources } });
    assert.equal(created.json().items, 2);

    const marked = await app.inject({ method: "POST", url: "/api/folder-favorites", headers: webMutationHeaders(cookie), payload: { locations: [{ d: source.id, p: `${name}/` }] } });
    assert.equal(marked.statusCode, 200);
    assert.equal(marked.json().cancelledPending, 2, "files that had not left their drive leave the transfer");
    const listed = (await app.inject({ method: "GET", url: "/api/folder-favorites", headers: { cookie } })).json().favorites;
    assert.ok(listed.some((entry: { diskId: string; path: string }) => entry.diskId === source.id && entry.path === name));

    const preview = (await app.inject({ method: "POST", url: "/api/transfers/consolidate/preview", headers: webMutationHeaders(cookie), payload: { destinationId, sources } })).json();
    assert.deepEqual([preview.files, preview.skipped.favorites], [0, 2], "subfolders are protected too");
    const group = (await app.inject({ method: "POST", url: "/api/transfers/group/candidates", headers: webMutationHeaders(cookie), payload: { destinationId } })).json();
    assert.equal(group.total, 0);
    assert.equal(group.skipped.favorites, 2);
    const fileId = (await prisma.videoFile.findFirstOrThrow({ where: { diskId: source.id, filename: `${name}-a.mp4` } })).id;
    const decided = await app.inject({ method: "POST", url: "/api/transfers/group/decide", headers: webMutationHeaders(cookie), payload: { destinationId, fileId, decision: "group" } });
    assert.deepEqual([decided.statusCode, decided.json().reason], [409, "favorite"]);

    const removed = await app.inject({ method: "POST", url: "/api/folder-favorites/remove", headers: webMutationHeaders(cookie), payload: { locations: [{ d: source.id, p: name }] } });
    assert.equal(removed.json().removed, 1);
    const again = (await app.inject({ method: "POST", url: "/api/transfers/consolidate/preview", headers: webMutationHeaders(cookie), payload: { destinationId, sources } })).json();
    assert.equal(again.files, 2);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: source.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: target.id } } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("folder usage can be explored folder by folder down to its videos", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Explorar ${suffix}`, volumeId: `ex-${suffix}`, totalBytes: 10n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  const root = `Raiz${suffix}`;
  try {
    await prisma.videoFile.createMany({
      data: [
        { diskId: disk.id, filename: "grande.mp4", extension: "mp4", absolutePath: "X:/1", relativePath: `${root}/grande.mp4`, sizeBytes: 300n },
        { diskId: disk.id, filename: "chico.mp4", extension: "mp4", absolutePath: "X:/2", relativePath: `${root}/chico.mp4`, sizeBytes: 100n },
        { diskId: disk.id, filename: "hondo.mp4", extension: "mp4", absolutePath: "X:/3", relativePath: `${root}/a/b/c/d/e/hondo.mp4`, sizeBytes: 50n },
        { diskId: disk.id, filename: "secreto.mp4", extension: "mp4", absolutePath: "X:/4", relativePath: `${root}/Private/secreto.mp4`, sizeBytes: 999n }
      ]
    });
    const subtree = await app.inject({ method: "POST", url: "/api/folder-groups/subtree", headers: webMutationHeaders(cookie), payload: { locations: [{ d: disk.id, p: root }] } });
    assert.equal(subtree.statusCode, 200);
    const node = subtree.json().node;
    assert.deepEqual([node.sizeBytes, node.fileCount], [450, 3], "protected folders stay hidden without the PIN");
    assert.ok(node.children.some((child: { kind: string; sizeBytes: number }) => child.kind === "files" && child.sizeBytes === 400));
    const deep = await app.inject({ method: "POST", url: "/api/folder-groups/subtree", headers: webMutationHeaders(cookie), payload: { locations: [{ d: disk.id, p: `${root}/a/b/c` }] } });
    assert.equal(deep.json().node.children[0].name, "d", "any depth can be explored");

    const direct = (await app.inject({ method: "POST", url: "/api/folder-groups/files", headers: webMutationHeaders(cookie), payload: { locations: [{ d: disk.id, p: root }] } })).json();
    assert.deepEqual(direct.files.map((file: { filename: string }) => file.filename), ["grande.mp4", "chico.mp4"], "only the files of the folder itself, largest first");
    assert.deepEqual([direct.total, direct.totalBytes], [2, 400]);
    const all = (await app.inject({ method: "POST", url: "/api/folder-groups/files", headers: webMutationHeaders(cookie), payload: { locations: [{ d: disk.id, p: root }], direct: false } })).json();
    assert.equal(all.total, 3);
    const missing = await app.inject({ method: "POST", url: "/api/folder-groups/subtree", headers: webMutationHeaders(cookie), payload: { locations: [{ d: disk.id, p: "NoExiste" }] } });
    assert.equal(missing.statusCode, 404);
  } finally {
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("after an access proxy sign-in the server sends people back to the same page of this site", async () => {
  const back = await app.inject({ method: "GET", url: "/api/session/return?to=%2Fcatalogo%3Fq%3Dboda" });
  assert.equal(back.statusCode, 303);
  assert.equal(back.headers.location, "/catalogo?q=boda");
  assert.equal(back.headers["cache-control"], "no-store");
  for (const target of ["https%3A%2F%2Fevil.example", "%2F%2Fevil.example", "%2Fapi%2Ffiles"]) {
    const response = await app.inject({ method: "GET", url: `/api/session/return?to=${target}` });
    assert.equal(response.headers.location, "/", target);
  }
});

test("a scan that no longer finds a file cancels its transfers that had not started", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Movido ${suffix}`, volumeId: `mv-${suffix}`, totalBytes: 10n, freeBytes: 10n } });
  try {
    const modifiedAt = "2026-10-13T12:00:00.000Z";
    await prisma.videoFile.createMany({
      data: ["sigue", "movido", "viajando"].map((name) => ({ diskId: disk.id, filename: `${name}.mp4`, extension: "mp4", absolutePath: `M:/V/${name}.mp4`, relativePath: `V/${name}.mp4`, sizeBytes: 10n, modifiedAt: new Date(modifiedAt) }))
    });
    const files = await prisma.videoFile.findMany({ where: { diskId: disk.id } });
    const byName = (name: string) => files.find((file) => file.filename === `${name}.mp4`)!;
    const destination = await prisma.transferDestination.create({ data: { diskId: disk.id, path: `Destino-${suffix}`, nameKey: "destino" } });
    const job = await prisma.transferJob.create({ data: { kind: "group", destinationId: destination.id, label: "test" } });
    const item = (name: string, state: string) => prisma.transferItem.create({
      data: { jobId: job.id, videoFileId: byName(name).id, filename: `${name}.mp4`, sourceDiskId: disk.id, sourceRelativePath: `V/${name}.mp4`, targetDiskId: disk.id, targetFolder: `Destino-${suffix}`, sizeBytes: 10n, state }
    });
    const pendingMoved = await item("movido", "pending");
    const inStaging = await item("viajando", "source_removed");

    // The person moved "movido" by hand: the next scan only sees "sigue".
    const scanId = (await app.inject({ method: "POST", url: "/api/agent/scan/start", headers: agentHeaders, payload: { diskId: disk.id, rootPath: "M:\\" } })).json().scan.id;
    await app.inject({
      method: "POST",
      url: "/api/agent/files/batch",
      headers: agentHeaders,
      payload: { scanId, diskId: disk.id, files: [{ filename: "sigue.mp4", extension: ".mp4", absolutePath: "M:\\V\\sigue.mp4", relativePath: "V/sigue.mp4", sizeBytes: 10, modifiedAt, status: "scanned" }] }
    });
    const finish = await app.inject({ method: "POST", url: "/api/agent/scan/finish", headers: agentHeaders, payload: { scanId, reconcile: true, scanRoots: ["."] } });
    assert.equal(finish.statusCode, 200);
    assert.deepEqual(finish.json().reconciliation, { markedAbsent: 1, cancelledTransfers: 1 });
    const cancelled = await prisma.transferItem.findUniqueOrThrow({ where: { id: pendingMoved.id } });
    assert.equal(cancelled.state, "cancelled");
    assert.match(cancelled.error ?? "", /ya no estaba en su disco/);
    assert.equal((await prisma.transferItem.findUniqueOrThrow({ where: { id: inStaging.id } })).state, "source_removed", "a file already in staging keeps its way");
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: disk.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: disk.id } } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("a tag rule moves every video with that tag to a starred folder, now and later", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const tag = `proyecto-${suffix}`;
  const companionId = crypto.randomUUID();
  const agent = { ...agentHeaders, "x-videocat-companion-id": companionId };
  const target = await prisma.disk.create({ data: { name: `Etiqueta destino ${suffix}`, volumeId: `td-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 1_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `Etiqueta origen ${suffix}`, volumeId: `ts-${suffix}`, totalBytes: 1_000_000_000_000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  try {
    await prisma.curationCategory.create({ data: { key: tag, label: `Proyecto ${suffix}`, color: "#2A9FD6" } });
    await prisma.videoFile.createMany({
      data: [
        { diskId: target.id, filename: "base.mp4", extension: "mp4", absolutePath: "E:/x", relativePath: "Destino/base.mp4", sizeBytes: 10n },
        { diskId: source.id, filename: "uno.mp4", extension: "mp4", absolutePath: "F:/1", relativePath: "A/uno.mp4", sizeBytes: 5n },
        { diskId: source.id, filename: "dos.mp4", extension: "mp4", absolutePath: "F:/2", relativePath: "B/dos.mp4", sizeBytes: 6n },
        { diskId: source.id, filename: "sin.mp4", extension: "mp4", absolutePath: "F:/3", relativePath: "C/sin.mp4", sizeBytes: 7n }
      ]
    });
    const files = await prisma.videoFile.findMany({ where: { diskId: source.id } });
    const id = (name: string) => files.find((file) => file.filename === `${name}.mp4`)!.id;
    await prisma.videoFileCategory.create({ data: { videoFileId: id("uno"), categoryKey: tag } });
    const destinationId = (await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: "Destino" } })).json().destination.id;

    const forDelete = await app.inject({ method: "POST", url: "/api/transfers/tag-rules", headers: webMutationHeaders(cookie), payload: { categoryKey: "delete", destinationId } });
    assert.equal(forDelete.statusCode, 400, "videos marked for deletion are not moved");
    const created = await app.inject({ method: "POST", url: "/api/transfers/tag-rules", headers: webMutationHeaders(cookie), payload: { categoryKey: tag, destinationId } });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().added, 1, "the video that already has the tag joins right away");
    const again = await app.inject({ method: "POST", url: "/api/transfers/tag-rules", headers: webMutationHeaders(cookie), payload: { categoryKey: tag, destinationId } });
    assert.equal(again.statusCode, 409, "one folder per tag");
    const job = await prisma.transferJob.findFirstOrThrow({ where: { tagRule: { categoryKey: tag } } });
    assert.equal(job.kind, "tag");

    // Tagged later: it joins when its drive connects (the Companion asks for work).
    await prisma.videoFileCategory.create({ data: { videoFileId: id("dos"), categoryKey: tag } });
    const work = (await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=ts-${suffix}`, headers: agent })).json().items;
    assert.deepEqual(work.map((item: { filename: string }) => item.filename).sort(), ["dos.mp4", "uno.mp4"]);

    // The tag is removed before the file left its drive: it leaves the transfer.
    await prisma.videoFileCategory.delete({ where: { videoFileId_categoryKey: { videoFileId: id("uno"), categoryKey: tag } } });
    await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=ts-${suffix}`, headers: agent });
    const withdrawn = await prisma.transferItem.findFirstOrThrow({ where: { videoFileId: id("uno") } });
    assert.equal(withdrawn.state, "cancelled");
    assert.match(withdrawn.error ?? "", /Ya no tiene la etiqueta/);

    const listed = (await app.inject({ method: "GET", url: "/api/transfers/tag-rules", headers: { cookie } })).json().rules.find((rule: { category: { key: string } }) => rule.category.key === tag);
    assert.deepEqual([listed.taggedFiles, listed.onTheirWay, listed.destination.path], [1, 1, "Destino"]);

    const removed = await app.inject({ method: "DELETE", url: `/api/transfers/tag-rules/${listed.id}`, headers: webMutationHeaders(cookie) });
    assert.equal(removed.json().withdrawn, 1, "removing the rule withdraws what had not started");
    assert.equal(await prisma.transferTagRule.count({ where: { categoryKey: tag } }), 0);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: source.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: target.id } } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
    await prisma.curationCategory.deleteMany({ where: { key: tag } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
  }
});

test("a favorite folder always wins over tag rules, also when it is marked afterwards", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const tag = `fav-${suffix}`;
  const companionId = crypto.randomUUID();
  const agent = { ...agentHeaders, "x-videocat-companion-id": companionId };
  const target = await prisma.disk.create({ data: { name: `Fav destino ${suffix}`, volumeId: `ft-${suffix}`, totalBytes: 4_000_000_000_000n, freeBytes: 1_000_000_000_000n } });
  const source = await prisma.disk.create({ data: { name: `Fav origen ${suffix}`, volumeId: `fs-${suffix}`, totalBytes: 1_000_000_000_000n, freeBytes: 10n } });
  const cookie = await authenticatedCookie();
  try {
    await prisma.curationCategory.create({ data: { key: tag, label: `Fav ${suffix}`, color: "#2A9FD6" } });
    await prisma.videoFile.createMany({
      data: [
        { diskId: target.id, filename: "base.mp4", extension: "mp4", absolutePath: "E:/x", relativePath: "Destino/base.mp4", sizeBytes: 10n },
        { diskId: source.id, filename: "protegido.mp4", extension: "mp4", absolutePath: "F:/1", relativePath: "Favorita/protegido.mp4", sizeBytes: 5n },
        { diskId: source.id, filename: "luego.mp4", extension: "mp4", absolutePath: "F:/2", relativePath: "Luego/luego.mp4", sizeBytes: 6n }
      ]
    });
    const files = await prisma.videoFile.findMany({ where: { diskId: source.id } });
    for (const file of files) await prisma.videoFileCategory.create({ data: { videoFileId: file.id, categoryKey: tag } });
    const later = files.find((file) => file.filename === "luego.mp4")!;
    await app.inject({ method: "POST", url: "/api/folder-favorites", headers: webMutationHeaders(cookie), payload: { locations: [{ d: source.id, p: "Favorita" }] } });
    const destinationId = (await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId: target.id, path: "Destino" } })).json().destination.id;

    const rule = await app.inject({ method: "POST", url: "/api/transfers/tag-rules", headers: webMutationHeaders(cookie), payload: { categoryKey: tag, destinationId } });
    assert.equal(rule.json().added, 1, "the tagged video in the favorite folder is never queued");

    // Marked as favorite after the rule queued it: it leaves, and the rule does not bring it back.
    const marked = await app.inject({ method: "POST", url: "/api/folder-favorites", headers: webMutationHeaders(cookie), payload: { locations: [{ d: source.id, p: "Luego" }] } });
    assert.equal(marked.json().cancelledPending, 1);
    const work = (await app.inject({ method: "GET", url: `/api/agent/transfers/work?mounted=fs-${suffix}`, headers: agent })).json().items;
    assert.equal(work.length, 0);
    assert.equal(await prisma.transferItem.count({ where: { videoFileId: later.id, state: { notIn: ["cancelled"] } } }), 0);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: source.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: target.id } } });
    for (const disk of [source, target]) await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
    await prisma.curationCategory.deleteMany({ where: { key: tag } });
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
  }
});

test("a drive keeps the name chosen in the web across scans, until it is reset", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const cookie = await authenticatedCookie();
  const registered = (await app.inject({ method: "POST", url: "/api/agent/register-disk", headers: agentHeaders, payload: { name: "H:\\", volumeId: `nm-${suffix}` } })).json().disk;
  try {
    const renamed = await app.inject({ method: "PATCH", url: `/api/disks/${registered.id}`, headers: webMutationHeaders(cookie), payload: { name: "  Backup cliente  " } });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().disk.name, "Backup cliente");
    await app.inject({ method: "POST", url: "/api/agent/register-disk", headers: agentHeaders, payload: { name: "H:\\", volumeId: `nm-${suffix}` } });
    assert.equal((await prisma.disk.findUniqueOrThrow({ where: { id: registered.id } })).name, "Backup cliente", "a scan does not overwrite it");
    const empty = await app.inject({ method: "PATCH", url: `/api/disks/${registered.id}`, headers: webMutationHeaders(cookie), payload: { name: "" } });
    assert.equal(empty.statusCode, 400);
    await app.inject({ method: "PATCH", url: `/api/disks/${registered.id}`, headers: webMutationHeaders(cookie), payload: { name: null } });
    await app.inject({ method: "POST", url: "/api/agent/register-disk", headers: agentHeaders, payload: { name: "Detectado", volumeId: `nm-${suffix}` } });
    assert.equal((await prisma.disk.findUniqueOrThrow({ where: { id: registered.id } })).name, "Detectado", "after a reset the detected name comes back");
  } finally {
    await prisma.disk.delete({ where: { id: registered.id } }).catch(() => undefined);
  }
});

test("audit errors filter, group and export safely; folder tree and maintenance report", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let diskId = "";
  try {
    const cookie = await authenticatedCookie();
    const disk = await prisma.disk.create({ data: { name: `Audit ${suffix}`, volumeId: `audit-${suffix}` } });
    diskId = disk.id;
    const repeated = `=cmd|'/C calc'!A0 ${suffix}`;
    await prisma.agentError.createMany({
      data: [
        { diskId, category: "metadata", phase: "ffprobe", code: "E1", message: repeated, relativePath: "Familia/a.mp4", createdAt: new Date(Date.now() - 3_600_000) },
        { diskId, category: "metadata", phase: "ffprobe", code: "E1", message: repeated, relativePath: "Familia/b.mp4" },
        { diskId, category: "thumbnail", phase: "extract", code: "E2", message: `Other ${suffix}`, relativePath: "Drone/c.mp4", createdAt: new Date(Date.now() - 40 * 86_400_000) }
      ]
    });
    await prisma.videoFile.createMany({
      data: [
        { diskId, filename: "a.mp4", extension: "mp4", absolutePath: "X:/Familia/2019/a.mp4", relativePath: "Familia/2019/a.mp4", sizeBytes: 100n },
        { diskId, filename: "b.mp4", extension: "mp4", absolutePath: "X:/Familia/b.mp4", relativePath: "Familia/b.mp4", sizeBytes: 50n },
        { diskId, filename: "c.mp4", extension: "mp4", absolutePath: "X:/Drone/c.mp4", relativePath: "Drone/c.mp4", sizeBytes: 300n }
      ]
    });

    const searched = await app.inject({ method: "GET", url: `/api/audit/errors?diskIds=${diskId}&q=${encodeURIComponent(suffix)}&category=metadata`, headers: { cookie } });
    assert.equal(searched.statusCode, 200);
    assert.equal(searched.json().total, 2);
    assert.equal(searched.json().errors.length, 2);

    const recent = await app.inject({ method: "GET", url: `/api/audit/errors?diskIds=${diskId}&sinceDays=7`, headers: { cookie } });
    assert.equal(recent.json().total, 2);

    const paged = await app.inject({ method: "GET", url: `/api/audit/errors?diskIds=${diskId}&limit=1`, headers: { cookie } });
    assert.equal(paged.json().errors.length, 1);
    assert.ok(paged.json().nextCursor);
    const second = await app.inject({ method: "GET", url: `/api/audit/errors?diskIds=${diskId}&limit=1&cursor=${paged.json().nextCursor}`, headers: { cookie } });
    assert.notEqual(second.json().errors[0].id, paged.json().errors[0].id);

    const grouped = await app.inject({ method: "GET", url: `/api/audit/errors?diskIds=${diskId}&grouped=true`, headers: { cookie } });
    const groups = grouped.json().groups as Array<{ message: string; count: number }>;
    assert.equal(groups.find((group) => group.message === repeated)?.count, 2);

    const exported = await app.inject({ method: "GET", url: `/api/audit/export?type=errors&diskIds=${diskId}`, headers: { cookie } });
    assert.equal(exported.statusCode, 200);
    assert.match(String(exported.headers["content-type"]), /text\/csv/);
    assert.match(String(exported.headers["content-disposition"]), /attachment; filename="videocat-audit-errors-\d{8}\.csv"/);
    assert.ok(exported.body.includes(`"'=cmd|`));
    assert.ok(!exported.body.includes(`,"=cmd|`));

    const unauthenticated = await app.inject({ method: "GET", url: "/api/audit/export?type=actions" });
    assert.equal(unauthenticated.statusCode, 401);

    const tree = await app.inject({ method: "GET", url: `/api/folder-usage/tree?diskIds=${diskId}`, headers: { cookie } });
    assert.deepEqual(tree.json().children.map((child: { path: string; sizeBytes: number }) => [child.path, child.sizeBytes]), [["Drone", 300], ["Familia", 150]]);
    const nested = await app.inject({ method: "GET", url: `/api/folder-usage/tree?diskIds=${diskId}&prefix=Familia`, headers: { cookie } });
    assert.equal(nested.json().directBytes, 50);
    assert.equal(nested.json().children[0].path, "Familia/2019");

    const maintenance = await app.inject({ method: "GET", url: "/api/admin/maintenance", headers: { cookie } });
    assert.equal(maintenance.statusCode, 200);
    assert.equal(typeof maintenance.json().retentionDays.agentErrors, "number");
    assert.ok(maintenance.json().totals.agentErrors >= 3);
  } finally {
    if (diskId) await prisma.disk.deleteMany({ where: { id: diskId } });
  }
});

test("the identity sample lists catalog files of a disk, leaving out files on their way through a transfer", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const legacyId = crypto.randomUUID();
  const disk = await prisma.disk.create({ data: { name: `Letter ${suffix}`, volumeId: legacyId } });
  try {
    await prisma.videoFile.createMany({
      data: ["a", "b", "moving"].map((name) => ({ diskId: disk.id, filename: `${name}.mp4`, extension: "mp4", absolutePath: `H:/V/${name}.mp4`, relativePath: `V/${name}.mp4`, sizeBytes: 1000n, isPresent: name !== "b" }))
    });
    const moving = await prisma.videoFile.findFirstOrThrow({ where: { diskId: disk.id, filename: "moving.mp4" } });
    const destination = await prisma.transferDestination.create({ data: { diskId: disk.id, path: `Destino-${suffix}`, nameKey: "destino" } });
    const job = await prisma.transferJob.create({ data: { kind: "group", destinationId: destination.id, label: "test" } });
    await prisma.transferItem.create({
      data: { jobId: job.id, videoFileId: moving.id, filename: "moving.mp4", sourceDiskId: disk.id, sourceRelativePath: "V/moving.mp4", targetDiskId: disk.id, targetFolder: `Destino-${suffix}`, sizeBytes: 1000n, state: "staged" }
    });

    const response = await app.inject({ method: "GET", url: `/api/agent/disks/${legacyId}/identity-sample?limit=10`, headers: agentHeaders });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.disk.name, `Letter ${suffix}`);
    assert.equal(body.totalFiles, 2, "present and missing files count, files in transit do not");
    assert.deepEqual(body.files.map((file: { relativePath: string }) => file.relativePath).sort(), ["V/a.mp4", "V/b.mp4"]);
    assert.deepEqual(body.files[0].sizeBytes, 1000);

    const limited = (await app.inject({ method: "GET", url: `/api/agent/disks/${legacyId}/identity-sample?limit=1`, headers: agentHeaders })).json();
    assert.equal(limited.files.length, 1);
    const unknown = await app.inject({ method: "GET", url: `/api/agent/disks/${crypto.randomUUID()}/identity-sample`, headers: agentHeaders });
    assert.deepEqual(unknown.json(), { disk: null, totalFiles: 0, files: [] });
    const unauthenticated = await app.inject({ method: "GET", url: `/api/agent/disks/${legacyId}/identity-sample` });
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: disk.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: disk.id } } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

test("the heartbeat hands the Companion the names chosen in the web for its connected drives", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const companionId = crypto.randomUUID();
  const renamedId = crypto.randomUUID();
  const detectedId = crypto.randomUUID();
  const renamed = await prisma.disk.create({ data: { name: "Detected name", volumeId: renamedId } });
  const detected = await prisma.disk.create({ data: { name: "WD 6TB", volumeId: detectedId } });
  try {
    const cookie = await authenticatedCookie();
    const rename = await app.inject({ method: "PATCH", url: `/api/disks/${renamed.id}`, headers: webMutationHeaders(cookie), payload: { name: "RQR-04N-UCM" } });
    assert.equal(rename.statusCode, 200);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
      payload: { version: 21, companionId, mountedDiskIds: [renamedId, detectedId, crypto.randomUUID()] }
    });
    assert.equal(heartbeat.statusCode, 200);
    assert.deepEqual(heartbeat.json().diskNames, [{ diskId: renamedId, name: "RQR-04N-UCM" }]);

    // Back to the detected name: the marker keeps whatever it has.
    await app.inject({ method: "PATCH", url: `/api/disks/${renamed.id}`, headers: webMutationHeaders(cookie), payload: { name: null } });
    const after = await app.inject({
      method: "POST",
      url: "/api/agent/companion/heartbeat",
      headers: { ...agentHeaders, "x-videocat-companion-id": companionId },
      payload: { version: 21, companionId, mountedDiskIds: [renamedId] }
    });
    assert.deepEqual(after.json().diskNames, []);
  } finally {
    await prisma.companionAgent.deleteMany({ where: { installationId: companionId } });
    await prisma.disk.deleteMany({ where: { id: { in: [renamed.id, detected.id] } } });
  }
});

test("a renamed folder moves catalog entries with their tags and thumbnails, and rejects anything that does not match", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Moves ${suffix}`, volumeId: `moves-${suffix}` } });
  const categoryKey = `fav-${suffix}`;
  try {
    const modifiedAt = "2025-03-04T05:06:07.890Z";
    await prisma.videoFile.createMany({
      data: ["clip", "changed", "taken", "moving"].map((name) => ({
        diskId: disk.id, filename: `${name}.mp4`, extension: ".mp4", absolutePath: `H:\\Testing\\${name}.mp4`, relativePath: `Testing/${name}.mp4`,
        sizeBytes: 1000n, modifiedAt: new Date(modifiedAt), visualFingerprint: "v1:01=0123456789abcdef", curationStatus: name === "clip" ? "keep" : "none"
      }))
    });
    await prisma.videoFile.create({ data: { diskId: disk.id, filename: "taken.mp4", extension: ".mp4", absolutePath: "H:\\Testing 2024\\taken.mp4", relativePath: "Testing 2024/taken.mp4", sizeBytes: 5n } });
    const clip = await prisma.videoFile.findFirstOrThrow({ where: { diskId: disk.id, relativePath: "Testing/clip.mp4" } });
    await prisma.curationCategory.create({ data: { key: categoryKey, label: `Fav ${suffix}`, color: "#ff0000" } });
    await prisma.videoFileCategory.create({ data: { videoFileId: clip.id, categoryKey } });
    await prisma.thumbnail.create({ data: { videoFileId: clip.id, kind: "frame_01", relativePath: `${disk.id}/${clip.id}/frame_01.jpg` } });
    const moving = await prisma.videoFile.findFirstOrThrow({ where: { diskId: disk.id, relativePath: "Testing/moving.mp4" } });
    const destination = await prisma.transferDestination.create({ data: { diskId: disk.id, path: `Destino-${suffix}`, nameKey: "destino" } });
    const job = await prisma.transferJob.create({ data: { kind: "group", destinationId: destination.id, label: "test" } });
    await prisma.transferItem.create({
      data: { jobId: job.id, videoFileId: moving.id, filename: "moving.mp4", sourceDiskId: disk.id, sourceRelativePath: "Testing/moving.mp4", targetDiskId: disk.id, targetFolder: `Destino-${suffix}`, sizeBytes: 1000n, state: "pending" }
    });

    const scanId = (await app.inject({ method: "POST", url: "/api/agent/scan/start", headers: agentHeaders, payload: { diskId: disk.id, rootPath: "H:\\" } })).json().scan.id;
    const move = (name: string, overrides: Record<string, unknown> = {}) => ({
      from: `Testing/${name}.mp4`, to: `Testing 2024/${name}.mp4`, absolutePath: `H:\\Testing 2024\\${name}.mp4`, sizeBytes: 1000, modifiedAt, folderSizeBytes: 4000, ...overrides
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/agent/scans/${scanId}/relocate`,
      headers: agentHeaders,
      payload: { moves: [move("clip"), move("changed", { sizeBytes: 999 }), move("taken"), move("moving"), move("ghost")] }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().relocated, ["Testing 2024/clip.mp4"]);
    assert.deepEqual(response.json().rejected, [
      { to: "Testing 2024/changed.mp4", reason: "changed" },
      { to: "Testing 2024/taken.mp4", reason: "occupied" },
      { to: "Testing 2024/moving.mp4", reason: "in_transfer" },
      { to: "Testing 2024/ghost.mp4", reason: "not_found" }
    ]);

    const relocated = await prisma.videoFile.findUniqueOrThrow({ where: { id: clip.id }, include: { categories: true, thumbnails: true } });
    assert.equal(relocated.relativePath, "Testing 2024/clip.mp4");
    assert.equal(relocated.absolutePath, "H:\\Testing 2024\\clip.mp4");
    assert.equal(relocated.filename, "clip.mp4");
    assert.equal(relocated.folderSizeBytes, 4000n);
    assert.equal(relocated.curationStatus, "keep");
    assert.equal(relocated.visualFingerprint, "v1:01=0123456789abcdef");
    assert.deepEqual(relocated.categories.map((category) => category.categoryKey), [categoryKey]);
    assert.equal(relocated.thumbnails.length, 1);

    await app.inject({ method: "POST", url: `/api/agent/scans/${scanId}/seen`, headers: agentHeaders, payload: { paths: ["Testing 2024/clip.mp4", "Testing 2024/taken.mp4", "Testing/moving.mp4"] } });
    const finish = await app.inject({ method: "POST", url: "/api/agent/scan/finish", headers: agentHeaders, payload: { scanId, reconcile: true, scanRoots: ["."] } });
    assert.equal(finish.statusCode, 200);
    const present = await prisma.videoFile.findUniqueOrThrow({ where: { id: clip.id } });
    assert.equal(present.isPresent, true, "the moved entry is not marked absent at the end of the scan");

    const audit = await prisma.actionAudit.findFirst({ where: { action: "scan.relocate", diskId: disk.id } });
    assert.ok(audit);
    assert.deepEqual((audit.result as { sample: unknown[] }).sample, [{ from: "Testing/clip.mp4", to: "Testing 2024/clip.mp4" }]);

    const closed = await app.inject({ method: "POST", url: `/api/agent/scans/${scanId}/relocate`, headers: agentHeaders, payload: { moves: [move("changed")] } });
    assert.equal(closed.statusCode, 409, "a finished scan cannot move entries");
  } finally {
    await prisma.actionAudit.deleteMany({ where: { diskId: disk.id } });
    await prisma.transferItem.deleteMany({ where: { sourceDiskId: disk.id } });
    await prisma.transferJob.deleteMany({ where: { destination: { diskId: disk.id } } });
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
    await prisma.curationCategory.deleteMany({ where: { key: categoryKey } });
  }
});

test("a copy on the same drive never takes the catalog entry of a file that is still there", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const disk = await prisma.disk.create({ data: { name: `Copies ${suffix}`, volumeId: `copies-${suffix}` } });
  try {
    const modifiedAt = "2025-03-04T05:06:07.890Z";
    const record = (relativePath: string) => ({ filename: "clip.mp4", extension: ".mp4", absolutePath: `H:\\${relativePath}`, relativePath, sizeBytes: 1000, modifiedAt, status: "scanned" });
    await prisma.videoFile.create({ data: { diskId: disk.id, filename: "clip.mp4", extension: ".mp4", absolutePath: "H:\\Old\\clip.mp4", relativePath: "Old/clip.mp4", sizeBytes: 1000n, modifiedAt: new Date(modifiedAt) } });
    const original = await prisma.videoFile.findFirstOrThrow({ where: { diskId: disk.id } });
    const start = async () => (await app.inject({ method: "POST", url: "/api/agent/scan/start", headers: agentHeaders, payload: { diskId: disk.id, rootPath: "H:\\" } })).json().scan.id as string;
    const finish = (scanId: string) => app.inject({ method: "POST", url: "/api/agent/scan/finish", headers: agentHeaders, payload: { scanId, reconcile: false, scanRoots: ["."] } });

    // A current Companion decides moves itself: a new path is always a new entry.
    let scanId = await start();
    await app.inject({ method: "POST", url: "/api/agent/files/batch", headers: agentHeaders, payload: { scanId, diskId: disk.id, movesReported: true, files: [record("Copy A/clip.mp4")] } });
    await finish(scanId);
    assert.equal((await prisma.videoFile.findUniqueOrThrow({ where: { id: original.id } })).relativePath, "Old/clip.mp4");

    // An older Companion still gets the guess, but not over an entry this scan already saw in place.
    scanId = await start();
    await app.inject({ method: "POST", url: `/api/agent/scans/${scanId}/seen`, headers: agentHeaders, payload: { paths: ["Old/clip.mp4", "Copy A/clip.mp4"] } });
    await app.inject({ method: "POST", url: "/api/agent/files/batch", headers: agentHeaders, payload: { scanId, diskId: disk.id, files: [record("Copy B/clip.mp4")] } });
    await finish(scanId);
    const paths = (await prisma.videoFile.findMany({ where: { diskId: disk.id }, select: { relativePath: true }, orderBy: { relativePath: "asc" } })).map((file) => file.relativePath);
    assert.deepEqual(paths, ["Copy A/clip.mp4", "Copy B/clip.mp4", "Old/clip.mp4"]);

    // And it still follows a real move from an older Companion, as before.
    const solo = await prisma.videoFile.create({ data: { diskId: disk.id, filename: "solo.mp4", extension: ".mp4", absolutePath: "H:\\Old\\solo.mp4", relativePath: "Old/solo.mp4", sizeBytes: 1000n, modifiedAt: new Date(modifiedAt) } });
    scanId = await start();
    await app.inject({ method: "POST", url: "/api/agent/files/batch", headers: agentHeaders, payload: { scanId, diskId: disk.id, files: [{ ...record("Renamed/solo.mp4"), filename: "solo.mp4" }] } });
    await finish(scanId);
    assert.equal((await prisma.videoFile.findUniqueOrThrow({ where: { id: solo.id } })).relativePath, "Renamed/solo.mp4");
  } finally {
    await prisma.disk.delete({ where: { id: disk.id } }).catch(() => undefined);
  }
});

// Against a real S3-compatible service (a throwaway MinIO, Garage, RustFS…): S3_TEST_ENDPOINT,
// S3_TEST_ACCESS_KEY, S3_TEST_SECRET_KEY and S3_TEST_REGION when it is not us-east-1 (Garage signs
// with "garage"). The test creates its own buckets and objects.
const s3TestSkip = process.env.RUN_DB_TESTS !== "true" || !process.env.S3_TEST_ENDPOINT;
const s3TestRegion = process.env.S3_TEST_REGION || "us-east-1";

test("S3 buckets are checked, saved with a sealed secret, edited and removed from Administración", { skip: s3TestSkip }, async () => {
  const { AwsClient } = await import("aws4fetch");
  const endpoint = process.env.S3_TEST_ENDPOINT!;
  const accessKeyId = process.env.S3_TEST_ACCESS_KEY!;
  const secretAccessKey = process.env.S3_TEST_SECRET_KEY!;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: s3TestRegion });
  const suffix = Math.random().toString(36).slice(2, 8);
  const bucket = `videocat-test-${suffix}`;
  const emptyBucket = `videocat-empty-${suffix}`;
  for (const name of [bucket, emptyBucket]) assert.equal((await client.fetch(`${endpoint}/${name}/`, { method: "PUT" })).status, 200);
  for (const key of ["Pel%C3%ADculas/Mi%20viaje%20%282024%29%20%2B%20extra%21.mp4", "Pel%C3%ADculas/otro%20%26%20m%C3%A1s.mkv", "Ra%C3%ADz.mp4"]) {
    assert.equal((await client.fetch(`${endpoint}/${bucket}/${key}`, { method: "PUT", body: "fake video" })).status, 200);
  }

  const cookie = await authenticatedCookie();
  const headers = webMutationHeaders(cookie);
  const form = { name: `MinIO ${suffix}`, endpoint, region: s3TestRegion, bucket, prefix: "", forcePathStyle: true, accessKeyId, secretAccessKey };
  const createdIds: string[] = [];
  try {
    const list = await app.inject({ method: "GET", url: "/api/storage/buckets", headers: { cookie } });
    assert.equal(list.json().encryptionKey, "ready");

    const check = (await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: form })).json().check;
    assert.equal(check.ok, true);
    assert.deepEqual(check.steps[0], { step: "list", ok: true, objects: 3, truncated: false });
    assert.equal(check.steps[1].ok, true, "reads an object whose key needs encoding");

    const wrong = (await app.inject({ method: "POST", url: "/api/storage/buckets", headers, payload: { ...form, secretAccessKey: "not-the-secret" } })).json();
    assert.equal(wrong.saved, false);
    assert.equal(wrong.check.steps[0].failure.code, "signature_mismatch");
    const unknownKey = (await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: { ...form, accessKeyId: "nobody" } })).json().check;
    assert.equal(unknownKey.steps[0].failure.code, "invalid_access_key");
    const missing = (await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: { ...form, bucket: `missing-${suffix}` } })).json().check;
    assert.deepEqual(missing.steps[0].failure, { code: "no_such_bucket", bucket: `missing-${suffix}` });
    // A port nobody listens on (fetch refuses low "bad ports" like 1 before connecting).
    const closedPort = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const refused = (await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: { ...form, endpoint: `http://127.0.0.1:${closedPort}` } })).json().check;
    assert.deepEqual(refused.steps[0].failure, { code: "endpoint_refused", host: `127.0.0.1:${closedPort}` });
    const unknownHost = (await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: { ...form, endpoint: "http://videocat-no-existe.invalid:9000" } })).json().check;
    assert.equal(unknownHost.steps[0].failure.code, "endpoint_not_found");
    const withPath = await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: { ...form, endpoint: `${endpoint}/videos` } });
    assert.equal(withPath.statusCode, 400);
    const empty = (await app.inject({ method: "POST", url: "/api/storage/buckets/check", headers, payload: { ...form, bucket: emptyBucket } })).json().check;
    assert.deepEqual(empty, { ok: true, steps: [{ step: "list", ok: true, objects: 0, truncated: false }, { step: "read", ok: null }] });

    const created = (await app.inject({ method: "POST", url: "/api/storage/buckets", headers, payload: form })).json();
    assert.equal(created.saved, true);
    createdIds.push(created.bucket.id);
    assert.equal(created.bucket.secretHint, secretAccessKey.slice(-4));
    const row = await prisma.storageBucket.findUniqueOrThrow({ where: { id: created.bucket.id } });
    assert.ok(!row.secretSealed.includes(secretAccessKey), "the secret is stored sealed");
    const listed = await app.inject({ method: "GET", url: "/api/storage/buckets", headers: { cookie } });
    assert.ok(!listed.body.includes(secretAccessKey) && !listed.body.includes(row.secretSealed), "the secret never goes back to the web");

    // An empty secret on edit keeps the saved one.
    const edited = (await app.inject({ method: "PATCH", url: `/api/storage/buckets/${created.bucket.id}`, headers, payload: { ...form, prefix: "/Películas", secretAccessKey: "" } })).json();
    assert.equal(edited.saved, true);
    assert.equal(edited.bucket.prefix, "Películas/");
    assert.equal(edited.check.steps[0].objects, 2);
    assert.equal((await prisma.storageBucket.findUniqueOrThrow({ where: { id: created.bucket.id } })).secretSealed, row.secretSealed);
    const savedCheck = (await app.inject({ method: "POST", url: `/api/storage/buckets/check`, headers, payload: { ...form, secretAccessKey: "", bucketId: created.bucket.id } })).json().check;
    assert.equal(savedCheck.ok, true);

    const recheck = (await app.inject({ method: "POST", url: `/api/storage/buckets/${created.bucket.id}/check`, headers })).json();
    assert.equal(recheck.check.ok, true);
    assert.equal(recheck.bucket.lastCheckOk, true);

    const removed = await app.inject({ method: "DELETE", url: `/api/storage/buckets/${created.bucket.id}`, headers });
    assert.equal(removed.statusCode, 200);
    assert.equal(await prisma.storageBucket.count({ where: { id: created.bucket.id } }), 0);
    const audit = await prisma.actionAudit.findMany({ where: { action: { startsWith: "storage.bucket." } } });
    assert.deepEqual([...new Set(audit.map((entry) => entry.action))].sort(), ["storage.bucket.create", "storage.bucket.delete", "storage.bucket.update"]);
    assert.ok(!JSON.stringify(audit).includes(secretAccessKey), "the audit log has no secrets");
  } finally {
    await prisma.storageBucket.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.actionAudit.deleteMany({ where: { action: { startsWith: "storage.bucket." } } });
  }
});

// Also needs ffmpeg/ffprobe on PATH and a writable THUMBNAILS_DIR.
test("the S3 scanner catalogs a bucket, plays and downloads it through the server, follows renamed objects and deletes marked ones", { skip: s3TestSkip }, async () => {
  const { AwsClient } = await import("aws4fetch");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { scanBucket } = await import("../apps/server/src/lib/bucket-scan.ts");
  const run = promisify(execFile);
  const endpoint = process.env.S3_TEST_ENDPOINT!;
  const accessKeyId = process.env.S3_TEST_ACCESS_KEY!;
  const secretAccessKey = process.env.S3_TEST_SECRET_KEY!;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: s3TestRegion });
  const suffix = Math.random().toString(36).slice(2, 8);
  const bucketName = `videocat-scan-${suffix}`;
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-scan-test-"));
  const quiet = { info: () => undefined, warn: () => undefined };
  const options = { tools: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }, workDir: path.join(work, "frames"), concurrency: 2, log: quiet };
  let bucketId: string | null = null;
  let diskId: string | null = null;
  try {
    assert.equal((await client.fetch(`${endpoint}/${bucketName}/`, { method: "PUT" })).status, 200);
    for (const [name, tone] of [["uno", 300], ["dos", 600]] as const) {
      const file = path.join(work, `${name}.mp4`);
      await run("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=4:size=320x180:rate=10", "-f", "lavfi", "-i", `sine=frequency=${tone}:duration=4`, "-shortest", "-c:v", "libx264", "-c:a", "aac", file]);
      assert.equal((await client.fetch(`${endpoint}/${bucketName}/Videos/${name}.mp4`, { method: "PUT", body: await fs.readFile(file) })).status, 200);
    }
    assert.equal((await client.fetch(`${endpoint}/${bucketName}/Videos/nota.txt`, { method: "PUT", body: "not a video" })).status, 200);

    const cookie = await authenticatedCookie();
    const created = (await app.inject({
      method: "POST",
      url: "/api/storage/buckets",
      headers: webMutationHeaders(cookie),
      payload: { name: `Scan ${suffix}`, endpoint, region: s3TestRegion, bucket: bucketName, prefix: "Videos", forcePathStyle: true, accessKeyId, secretAccessKey }
    })).json();
    assert.equal(created.saved, true);
    bucketId = created.bucket.id as string;

    const first = await scanBucket(bucketId, options);
    assert.deepEqual(first, { listed: 2, unchanged: 0, processed: 2, failed: 0, relocated: 0, markedAbsent: 0 });
    const bucket = await prisma.storageBucket.findUniqueOrThrow({ where: { id: bucketId } });
    diskId = bucket.diskId;
    assert.ok(diskId);
    const disk = await prisma.disk.findUniqueOrThrow({ where: { id: diskId } });
    assert.equal(disk.kind, "s3");
    const files = await prisma.videoFile.findMany({ where: { diskId }, include: { thumbnails: true }, orderBy: { relativePath: "asc" } });
    assert.deepEqual(files.map((file) => [file.relativePath, file.absolutePath, file.scanStatus, file.thumbnails.length, Boolean(file.visualFingerprint), Boolean(file.storageEtag)]), [
      ["dos.mp4", `s3://${bucketName}/Videos/dos.mp4`, "scanned", 15, true, true],
      ["uno.mp4", `s3://${bucketName}/Videos/uno.mp4`, "scanned", 15, true, true]
    ]);
    const uno = files.find((file) => file.relativePath === "uno.mp4")!;

    // Unchanged objects are not read again.
    assert.deepEqual(await scanBucket(bucketId, options), { listed: 2, unchanged: 2, processed: 0, failed: 0, relocated: 0, markedAbsent: 0 });

    // Remote playback: the server reads the bucket by ranges, no Companion involved.
    const original = await fs.readFile(path.join(work, "uno.mp4"));
    const opened = await app.inject({ method: "POST", url: "/api/stream-sessions", headers: webMutationHeaders(cookie), payload: { fileId: uno.id } });
    assert.equal(opened.statusCode, 200, opened.body);
    const session = opened.json().session;
    assert.deepEqual([session.status, session.mimeType, session.sizeBytes], ["ready", "video/mp4", original.length]);
    const head = await app.inject({ method: "GET", url: `/api/streams/${session.id}/content`, headers: { cookie, range: "bytes=0-99" } });
    assert.equal(head.statusCode, 206);
    assert.equal(head.headers["content-range"], `bytes 0-99/${original.length}`);
    assert.ok(head.rawPayload.equals(original.subarray(0, 100)));
    const rest = await app.inject({ method: "GET", url: `/api/streams/${session.id}/content`, headers: { cookie, range: "bytes=100-" } });
    assert.equal(rest.statusCode, 206);
    assert.ok(rest.rawPayload.equals(original.subarray(100)), "an open range streams the rest of the object");
    assert.equal((await app.inject({ method: "GET", url: `/api/streams/${session.id}/content`, headers: { cookie, range: `bytes=${original.length}-` } })).statusCode, 416);
    const remux = await app.inject({ method: "POST", url: "/api/stream-sessions", headers: webMutationHeaders(cookie), payload: { fileId: uno.id, mode: "remux" } });
    assert.equal(remux.statusCode, 400);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/stream-sessions/${session.id}`, headers: webMutationHeaders(cookie) })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: `/api/streams/${session.id}/content`, headers: { cookie, range: "bytes=0-9" } })).statusCode, 404, "a closed session serves nothing");
    // "Another video at random" also picks from buckets, with or without a Companion.
    const random = await app.inject({ method: "GET", url: `/api/playback/random?excludeId=${uno.id}`, headers: { cookie } });
    assert.equal(random.statusCode, 200, random.body);
    assert.equal(random.json().file.diskId, diskId);

    // "A descargar": a bucket video goes to the Companion's server queue only, and its bytes come
    // through the server.
    const dos = files.find((file) => file.relativePath === "dos.mp4")!;
    const queued = await app.inject({ method: "POST", url: "/api/downloads/queue", headers: webMutationHeaders(cookie), payload: { fileIds: [dos.id] } });
    assert.equal(queued.statusCode, 200, queued.body);
    const serverQueue = (await app.inject({ method: "GET", url: "/api/agent/downloads/queue?source=server", headers: agentHeaders })).json();
    assert.equal(serverQueue.source, "server");
    assert.deepEqual(serverQueue.files.map((item: { fileId: string }) => item.fileId), [dos.id]);
    const driveQueue = (await app.inject({ method: "GET", url: "/api/agent/downloads/queue", headers: agentHeaders })).json();
    assert.ok(!driveQueue.files.some((item: { fileId: string }) => item.fileId === dos.id), "drive queues never offer bucket videos");
    const content = await app.inject({ method: "GET", url: `/api/agent/downloads/${serverQueue.files[0].id}/content`, headers: agentHeaders });
    assert.equal(content.statusCode, 200);
    assert.ok(content.rawPayload.equals(await fs.readFile(path.join(work, "dos.mp4"))));
    assert.equal((await app.inject({ method: "GET", url: `/api/agent/downloads/${serverQueue.files[0].id}/content` })).statusCode, 401);
    await prisma.downloadQueue.deleteMany({ where: { videoFileId: dos.id } });

    // S3 renames are a copy and a delete; "dos" is deleted.
    const copy = await client.fetch(`${endpoint}/${bucketName}/Videos/Archivo/uno%20renombrado.mp4`, { method: "PUT", headers: { "x-amz-copy-source": `/${bucketName}/Videos/uno.mp4` } });
    assert.equal(copy.status, 200);
    for (const key of ["Videos/uno.mp4", "Videos/dos.mp4"]) assert.equal((await client.fetch(`${endpoint}/${bucketName}/${key}`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await scanBucket(bucketId, options), { listed: 1, unchanged: 0, processed: 0, failed: 0, relocated: 1, markedAbsent: 1 });
    const renamed = await prisma.videoFile.findUniqueOrThrow({ where: { id: uno.id }, include: { thumbnails: true } });
    assert.equal(renamed.relativePath, "Archivo/uno renombrado.mp4");
    assert.equal(renamed.thumbnails.length, 15);
    assert.equal((await prisma.videoFile.findFirstOrThrow({ where: { diskId, relativePath: "dos.mp4" } })).isPresent, false);

    // Transfers cannot involve a bucket yet.
    const star = await app.inject({ method: "POST", url: "/api/transfers/destinations", headers: webMutationHeaders(cookie), payload: { diskId, path: "Archivo" } });
    assert.equal(star.statusCode, 409);

    // Review › J and "Procesar borrados": the scanner deletes marked bucket videos, unless the
    // object changed since the last scan.
    const { processBucketDeletions } = await import("../apps/server/src/lib/bucket-deletions.ts");
    const changedFile = path.join(work, "cambia.mp4");
    await run("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=3:size=320x180:rate=10", "-c:v", "libx264", changedFile]);
    assert.equal((await client.fetch(`${endpoint}/${bucketName}/Videos/cambia.mp4`, { method: "PUT", body: await fs.readFile(changedFile) })).status, 200);
    await scanBucket(bucketId, options);
    const markForDeletion = async (relativePath: string) => {
      const file = await prisma.videoFile.findFirstOrThrow({ where: { diskId, relativePath } });
      const marked = await app.inject({ method: "PATCH", url: `/api/files/${file.id}/curation`, headers: webMutationHeaders(cookie), payload: { curationStatus: "delete" } });
      assert.equal(marked.statusCode, 200, marked.body);
      return file.id;
    };
    const renamedId = await markForDeletion("Archivo/uno renombrado.mp4");
    const changedId = await markForDeletion("cambia.mp4");
    assert.equal((await client.fetch(`${endpoint}/${bucketName}/Videos/cambia.mp4`, { method: "PUT", body: "replaced after the scan" })).status, 200);
    const asked = await app.inject({ method: "POST", url: "/api/review/deletions/process", headers: webMutationHeaders(cookie) });
    assert.equal(asked.statusCode, 200, asked.body);
    assert.equal(asked.json().bucketDeletions, 2);
    assert.deepEqual(await processBucketDeletions(quiet), { deleted: 1, missing: 0, changed: 1, failed: 0 });
    assert.equal((await client.fetch(`${endpoint}/${bucketName}/Videos/Archivo/uno%20renombrado.mp4`, { method: "HEAD" })).status, 404, "the object is gone from the bucket");
    assert.equal(await prisma.videoFile.count({ where: { id: renamedId } }), 0);
    assert.equal((await prisma.deletionRecord.findUniqueOrThrow({ where: { videoFileId: renamedId } })).status, "deleted");
    assert.equal((await client.fetch(`${endpoint}/${bucketName}/Videos/cambia.mp4`, { method: "HEAD" })).status, 200, "a changed object is kept");
    assert.equal((await prisma.videoFile.findUniqueOrThrow({ where: { id: changedId } })).curationStatus, "none");
    assert.equal((await prisma.deletionRecord.findUniqueOrThrow({ where: { videoFileId: changedId } })).status, "failed");
  } finally {
    if (diskId) await prisma.deletionRecord.deleteMany({ where: { diskId } });
    if (bucketId) await prisma.storageBucket.deleteMany({ where: { id: bucketId } });
    if (diskId) await prisma.disk.deleteMany({ where: { id: diskId } });
    await prisma.actionAudit.deleteMany({ where: { action: { startsWith: "storage.bucket." } } });
    await fs.rm(work, { recursive: true, force: true });
  }
});
