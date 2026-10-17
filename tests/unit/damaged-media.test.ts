import assert from "node:assert/strict";
import test from "node:test";
import { damagedMediaMessage, damagedMediaReason, isDamagedMediaMessage } from "../../packages/shared/src/damaged-media.ts";

test("recognizes FFmpeg messages that mean the file itself is incomplete or damaged", () => {
  const moov = "Command failed: ffprobe ... [mov,mp4,m4a,3gp,3g2,mj2 @ 0000028106d736c0] moov atom not found J:\\Disk\\video.mp4: Invalid data found when processing input";
  assert.match(damagedMediaReason(moov) ?? "", /moov/);
  assert.match(damagedMediaReason("[matroska,webm @ 0x1] EBML header parsing failed") ?? "", /MKV/);
  assert.match(damagedMediaReason("clip.avi: Invalid data found when processing input") ?? "", /no se pueden leer/);
  assert.equal(damagedMediaReason("spawn ffprobe ENOENT"), null);
  assert.equal(damagedMediaReason(null), null);
});

test("the catalog message is recognizable afterwards", () => {
  const message = damagedMediaMessage("sus datos no se pueden leer como video.");
  assert.equal(isDamagedMediaMessage(message), true);
  assert.equal(isDamagedMediaMessage(`${message}\nDetalle: ...`), true);
  assert.equal(isDamagedMediaMessage("ffprobe timed out"), false);
  assert.equal(isDamagedMediaMessage(undefined), false);
});
