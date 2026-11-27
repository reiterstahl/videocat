import assert from "node:assert/strict";
import test from "node:test";
import { closeTopLayer, readAndroidApp } from "../../apps/web/src/lib/android-app.ts";
import { randomId } from "../../apps/web/src/lib/random-id.ts";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("request ids are UUIDs also where crypto.randomUUID does not exist (http at a LAN address)", () => {
  const insecure = { getRandomValues: <T extends ArrayBufferView | null>(array: T) => globalThis.crypto.getRandomValues(array as never) as T };
  const ids = new Set(Array.from({ length: 200 }, () => randomId(insecure)));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, uuidV4);
  // Where it exists, it is used.
  assert.equal(randomId({ getRandomValues: insecure.getRandomValues, randomUUID: () => "from-randomUUID" }), "from-randomUUID");
});

test("the Android app is recognized by its bridge, and a broken bridge counts as a browser", () => {
  assert.equal(readAndroidApp({}), null);
  const app = readAndroidApp({ VideoCatAndroid: { version: () => 1, capabilities: () => '["play","cast",3]' } });
  assert.deepEqual(app && { version: app.version, capabilities: [...app.capabilities] }, { version: 1, capabilities: ["play", "cast"] });
  assert.deepEqual([...(readAndroidApp({ VideoCatAndroid: { version: () => 2, capabilities: () => "not json" } })?.capabilities ?? ["x"])], []);
  assert.equal(readAndroidApp({ VideoCatAndroid: { version: () => 0, capabilities: () => "[]" } }), null);
  assert.equal(readAndroidApp({ VideoCatAndroid: { version: () => { throw new Error("gone"); }, capabilities: () => "[]" } }), null);
  assert.equal(readAndroidApp({ VideoCatAndroid: { capabilities: () => "[]" } }), null);
});

test("Back closes what is open on top with Escape, and says when nothing was open", () => {
  const pressed: string[] = [];
  const target = { dispatchEvent: (event: Event) => { pressed.push((event as KeyboardEvent).key); return true; } };
  const globals = globalThis as { KeyboardEvent?: unknown };
  const original = globals.KeyboardEvent;
  // Node has no KeyboardEvent; the browser's carries the key the same way.
  globals.KeyboardEvent ??= class extends Event { key: string; constructor(type: string, init: { key: string }) { super(type); this.key = init.key; } };
  try {
    assert.equal(closeTopLayer({ querySelector: () => null }, target), false);
    assert.deepEqual(pressed, []);
    let asked = "";
    assert.equal(closeTopLayer({ querySelector: (selector: string) => { asked = selector; return {} as Element; } }, target), true);
    assert.deepEqual(pressed, ["Escape"]);
    assert.match(asked, /role="dialog"/);
    assert.match(asked, /aside\.vc-detail/);
  } finally {
    globals.KeyboardEvent = original;
  }
});
