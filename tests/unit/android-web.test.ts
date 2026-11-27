import assert from "node:assert/strict";
import test from "node:test";
import { androidAppSettings, closeTopLayer, listenToNativePlayer, nativePlayer, readAndroidApp, readNativePlayerEvent } from "../../apps/web/src/lib/android-app.ts";
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

test("the native player is used only when the app announces it and has play()", () => {
  const plays: string[] = [];
  const bridge = (capabilities: string[], extra: object = {}) => ({
    VideoCatAndroid: { version: () => 2, capabilities: () => JSON.stringify(capabilities), ...extra }
  });
  assert.equal(nativePlayer({}), null);
  assert.equal(nativePlayer(bridge([])), null);
  assert.equal(nativePlayer(bridge(["play"])), null, "announced but without play()");
  const player = nativePlayer(bridge(["play"], { play: (json: string) => plays.push(json), stop: () => { throw new Error("gone"); } }));
  assert.ok(player);
  player.play({ url: "https://cat.example/api/streams/a/content", title: "x.mkv", subtitle: "", position: 3, shuffle: true, canNext: false, canRandom: true });
  assert.deepEqual(JSON.parse(plays[0]), { url: "https://cat.example/api/streams/a/content", title: "x.mkv", subtitle: "", position: 3, shuffle: true, canNext: false, canRandom: true });
  // A bridge that throws on stop() does not break the page.
  player.stop();
});

test("native player events are read strictly", () => {
  assert.deepEqual(readNativePlayerEvent({ type: "next" }), { type: "next" });
  assert.deepEqual(readNativePlayerEvent({ type: "closed", position: 12.5 }), { type: "closed", position: 12.5 });
  assert.deepEqual(readNativePlayerEvent({ type: "closed", position: -3 }), { type: "closed", position: 0 });
  assert.deepEqual(readNativePlayerEvent({ type: "error", position: "x", format: "yes" }), { type: "error", position: 0, format: false });
  assert.deepEqual(readNativePlayerEvent({ type: "shuffle", enabled: false }), { type: "shuffle", enabled: false });
  assert.equal(readNativePlayerEvent({ type: "shuffle" }), null);
  assert.equal(readNativePlayerEvent({ type: "delete-everything" }), null);
  assert.equal(readNativePlayerEvent("next"), null);

  const scope: { videocatAndroidPlayer?: (event: unknown) => void } = {};
  const seen: string[] = [];
  const stop = listenToNativePlayer((event) => seen.push(event.type), scope);
  scope.videocatAndroidPlayer?.({ type: "ended" });
  scope.videocatAndroidPlayer?.({ type: "bogus" });
  stop();
  assert.equal(scope.videocatAndroidPlayer, undefined);
  assert.deepEqual(seen, ["ended"]);
});

test("the app's settings are offered only when the app announces them", () => {
  let opened = 0;
  const bridge = (capabilities: string[], extra: object = {}) => ({
    VideoCatAndroid: { version: () => 3, capabilities: () => JSON.stringify(capabilities), ...extra }
  });
  assert.equal(androidAppSettings({}), null);
  assert.equal(androidAppSettings(bridge(["play"], { openSettings: () => { opened += 1; } })), null);
  assert.equal(androidAppSettings(bridge(["settings"])), null);
  const open = androidAppSettings(bridge(["play", "settings"], { openSettings: () => { opened += 1; } }));
  assert.ok(open);
  open();
  assert.equal(opened, 1);
});
