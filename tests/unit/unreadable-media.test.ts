import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeMedia, isUnreadableMediaError } from "../../packages/shared/src/media.ts";
import { failOnStall, hashFile } from "../../apps/agent-windows/src/transfer-engine.ts";

const posix = process.platform !== "win32";
const quiet = { info: () => undefined, warn: () => undefined };

test("a read that timed out or hit an I/O error is unreadable; a damaged file or a stop is not", () => {
  assert.equal(isUnreadableMediaError(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" })), true);
  assert.equal(isUnreadableMediaError(new Error("E:\\video.mp4: Input/output error")), true);
  assert.equal(isUnreadableMediaError(new Error("Error number -5 occurred")), true);
  assert.equal(isUnreadableMediaError(Object.assign(new Error("The operation was aborted"), { name: "AbortError", killed: true })), false);
  assert.equal(isUnreadableMediaError(new Error("moov atom not found")), false);
});

// Fake ffprobe/ffmpeg that log each call and answer like a drive with a bad sector.
async function fakeTools(probe: "ok" | "io_error") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-unreadable-"));
  const calls = path.join(dir, "calls");
  const json = JSON.stringify({ format: { duration: "60", format_name: "mp4" }, streams: [{ codec_type: "video", width: 640, height: 360 }] });
  const ffprobe = path.join(dir, "ffprobe");
  const ffmpeg = path.join(dir, "ffmpeg");
  await fs.writeFile(ffprobe, probe === "ok"
    ? `#!/bin/sh\necho ffprobe >> "${calls}"\necho '${json}'\n`
    : `#!/bin/sh\necho ffprobe >> "${calls}"\necho "video.mp4: Input/output error" >&2\nexit 1\n`);
  await fs.writeFile(ffmpeg, `#!/bin/sh\necho ffmpeg >> "${calls}"\necho "video.mp4: Input/output error" >&2\nexit 1\n`);
  await fs.chmod(ffprobe, 0o755);
  await fs.chmod(ffmpeg, 0o755);
  const count = async (tool: string) => (await fs.readFile(calls, "utf8").catch(() => "")).split("\n").filter((line) => line === tool).length;
  return { dir, tools: { ffprobe, ffmpeg }, count };
}

function analyze(dir: string, tools: { ffprobe: string; ffmpeg: string }) {
  return analyzeMedia(path.join(dir, "video.mp4"), {
    tools,
    label: "video.mp4",
    createThumbnails: true,
    createFingerprint: true,
    thumbnailPath: (kind) => path.join(dir, "thumbs", `${kind}.jpg`),
    rawPath: (kind) => path.join(dir, "raw", `${kind}.raw`),
    log: quiet
  });
}

test("metadata that fails with an I/O error is not retried", { skip: !posix }, async () => {
  const { dir, tools, count } = await fakeTools("io_error");
  try {
    const analyzed = await analyze(dir, tools);
    assert.equal(analyzed.unreadable, true);
    assert.equal(analyzed.status, "metadata_failed");
    assert.equal(await count("ffprobe"), 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a frame that fails with an I/O error leaves the rest of the file untried", { skip: !posix }, async () => {
  const { dir, tools, count } = await fakeTools("ok");
  try {
    const analyzed = await analyze(dir, tools);
    assert.equal(analyzed.unreadable, true);
    assert.equal(await count("ffmpeg"), 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("hashing a file whose reads never answer fails instead of waiting forever", { skip: !posix }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "videocat-stall-"));
  const fifo = path.join(dir, "stuck.mp4");
  execFileSync("mkfifo", [fifo]);
  const started = Date.now();
  try {
    // Opening a FIFO nobody writes to blocks like a read on a bad sector.
    await assert.rejects(hashFile(fifo, undefined, 1_500), /no respondió en 2 s/);
    assert.ok(Date.now() - started < 6_000);
  } finally {
    // Unblocks the abandoned open so the test process can exit.
    await fs.writeFile(fifo, "").catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a copy that keeps receiving bytes is not cut by the stall guard", async () => {
  let lastByteAt = Date.now();
  const ticking = setInterval(() => { lastByteAt = Date.now(); }, 200);
  const destroyed: Error[] = [];
  try {
    const value = await failOnStall(new Promise((resolve) => setTimeout(() => resolve("done"), 2_500)), () => lastByteAt, [{ destroy: (error?: Error) => error && destroyed.push(error) }], 1_000);
    assert.equal(value, "done");
    assert.equal(destroyed.length, 0);
  } finally {
    clearInterval(ticking);
  }
});
