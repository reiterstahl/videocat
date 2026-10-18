import assert from "node:assert/strict";
import test from "node:test";
import { LineSplitter, parseAccent, parseTrayStatus, prepareTrayIcon, renderTrayFrame, trayFrames, trayStatusLine } from "../../apps/agent-windows/src/tray-animation.ts";

// A 9×9 icon: a black cat (center 3×3) inside a white outline ring, transparent around it.
function sampleIcon(order: "rgba" | "bgra"): Uint8Array {
  const size = 9;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const ring = Math.max(Math.abs(x - 4), Math.abs(y - 4));
      if (ring <= 1) data.set([0, 0, 0, 255], i);
      else if (ring === 2) data.set([255, 255, 255, 255], i);
    }
  }
  return order === "rgba" ? data : data;
}

test("only the white outline takes the accent; the cat and the transparent area stay as they are", () => {
  const icon = prepareTrayIcon(sampleIcon("rgba"), 9, 9, "rgba");
  assert.equal(icon.outline.length, 16, "the 5×5 ring minus the 3×3 cat");
  const frame = renderTrayFrame(icon, 0.25, [252, 97, 33]);
  const changed = icon.outline.filter((pixel) => frame[pixel.index] !== 255 || frame[pixel.index + 1] !== 255);
  assert.ok(changed.length > 0 && changed.length < icon.outline.length, "a comet, not the whole ring");
  const center = (4 * 9 + 4) * 4;
  assert.deepEqual([...frame.slice(center, center + 4)], [0, 0, 0, 255]);
  assert.deepEqual([...frame.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...icon.base.slice(center, center + 4)], [0, 0, 0, 255], "the base bitmap is never touched");
});

test("BGRA bitmaps (Electron on Windows) get the accent in the right channels", () => {
  const icon = prepareTrayIcon(sampleIcon("bgra"), 9, 9, "bgra");
  const frames = trayFrames(icon, [255, 0, 0], 8);
  assert.equal(frames.length, 8);
  // Pure red accent: the red channel (index 2 in BGRA) stays at 255 while blue and green drop.
  const strongest = icon.outline
    .map((pixel) => ({ pixel, value: frames[0][pixel.index] }))
    .sort((a, b) => a.value - b.value)[0];
  assert.equal(frames[0][strongest.pixel.index + 2], 255);
  assert.ok(strongest.value < 255);
  // The comet moves: two phases paint different pixels.
  assert.notDeepEqual(frames[0], frames[4]);
});

test("accent colors, status lines and stdout split across chunks", () => {
  assert.deepEqual(parseAccent("#fc6121"), [252, 97, 33]);
  assert.equal(parseAccent("orange"), null);
  assert.equal(parseAccent(undefined), null);
  const line = trayStatusLine({ busy: true, accent: "#3b6ff5" });
  assert.deepEqual(parseTrayStatus(line), { busy: true, accent: "#3b6ff5" });
  assert.equal(parseTrayStatus("Escaneando D:\\Videos"), null);
  assert.equal(parseTrayStatus("@@videocat-status {broken"), null);
  const splitter = new LineSplitter();
  assert.deepEqual(splitter.push("uno\r\ndo"), ["uno"]);
  assert.deepEqual(splitter.push(`s\n${line.slice(0, 10)}`), ["dos"]);
  assert.deepEqual(splitter.push(`${line.slice(10)}\n`), [line]);
  assert.deepEqual(splitter.flush(), []);
});
