// The VideoCAT Android app opens this same page, from the person's own server, in a WebView and
// does natively what a WebView cannot. It announces itself with a JavaScript bridge
// (ANDROID_APP_PLAN.es.md):
//   window.VideoCatAndroid.version(): number       the bridge's version
//   window.VideoCatAndroid.capabilities(): string  a JSON list of what the app does natively
//   window.VideoCatAndroid.play(json) / stop()     with "play": the native player (version 2)
// Without the bridge the page is in a browser and does everything itself.

type AndroidBridge = {
  version: () => number;
  capabilities: () => string;
  // Version 2, with "play": the native player.
  play?: (request: string) => void;
  stop?: () => void;
};

export type AndroidApp = {
  version: number;
  capabilities: ReadonlySet<string>;
};

export function readAndroidApp(scope: { VideoCatAndroid?: unknown } = window as never): AndroidApp | null {
  const bridge = scope.VideoCatAndroid as Partial<AndroidBridge> | undefined;
  if (!bridge || typeof bridge.version !== "function") return null;
  try {
    const version = Number(bridge.version());
    if (!Number.isInteger(version) || version < 1) return null;
    let capabilities: unknown = [];
    try {
      capabilities = typeof bridge.capabilities === "function" ? JSON.parse(bridge.capabilities()) : [];
    } catch {
      capabilities = [];
    }
    const list = Array.isArray(capabilities) ? capabilities.filter((item): item is string => typeof item === "string") : [];
    return { version, capabilities: new Set(list) };
  } catch {
    return null;
  }
}

let cached: AndroidApp | null | undefined;

// The bridge exists before the page's first script runs and does not change while it is open.
export function androidApp(): AndroidApp | null {
  if (cached === undefined) cached = typeof window === "undefined" ? null : readAndroidApp();
  return cached;
}

// Chromecast from the page needs Chrome's Cast SDK, which a WebView lacks: inside the app it is
// offered only once the app casts natively.
export function canCastHere(): boolean {
  const app = androidApp();
  return !app || app.capabilities.has("cast");
}

// What closes with Escape: dialogs, sheets and menus (role="dialog") and the detail panel.
const topLayerSelector = '[role="dialog"], aside.vc-detail';

// Android's Back button. The app calls window.videocatAndroidBack() first: true means the page
// closed what was open on top, so Back stays on this section; false, and the app goes back a
// section (history) or leaves. Everything on top already closes with Escape, so Back presses it.
export function closeTopLayer(doc: Pick<Document, "querySelector"> = document, target: Pick<Window, "dispatchEvent"> = window): boolean {
  if (!doc.querySelector(topLayerSelector)) return false;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return true;
}

export function startAndroidBackHandling(scope: { videocatAndroidBack?: () => boolean } = window as never): void {
  if (!androidApp()) return;
  scope.videocatAndroidBack = () => closeTopLayer();
}

// What the page hands the native player: a stream session it opened, and what the controls need.
export type NativePlaybackRequest = {
  url: string;
  title: string;
  subtitle: string;
  // Seconds from the start.
  position: number;
  shuffle: boolean;
  canNext: boolean;
  canRandom: boolean;
};

// What the native player reports back through window.videocatAndroidPlayer(event).
export type NativePlayerEvent =
  | { type: "next" }
  | { type: "ended" }
  | { type: "shuffle"; enabled: boolean }
  | { type: "closed"; position: number }
  // format: the phone could not read or decode the file (the temporary MP4 may help).
  | { type: "error"; position: number; format: boolean };

export type NativePlayer = {
  play: (request: NativePlaybackRequest) => void;
  stop: () => void;
};

let cachedPlayer: NativePlayer | null | undefined;

// The app's native player, when the app announces "play"; null in a browser or an older app.
export function nativePlayer(scope?: { VideoCatAndroid?: unknown }): NativePlayer | null {
  const page = scope === undefined;
  if (page && cachedPlayer !== undefined) return cachedPlayer;
  if (page && typeof window === "undefined") return null;
  scope ??= window as never;
  const app = page ? androidApp() : readAndroidApp(scope);
  const bridge = scope.VideoCatAndroid as Partial<AndroidBridge> | undefined;
  const player = app?.capabilities.has("play") && typeof bridge?.play === "function"
    ? {
        play: (request: NativePlaybackRequest) => bridge.play!(JSON.stringify(request)),
        stop: () => {
          try {
            bridge.stop?.();
          } catch {
            // The app went away; nothing left to stop.
          }
        }
      }
    : null;
  if (page) cachedPlayer = player;
  return player;
}

function seconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function readNativePlayerEvent(raw: unknown): NativePlayerEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  switch (event.type) {
    case "next":
    case "ended":
      return { type: event.type };
    case "shuffle":
      return typeof event.enabled === "boolean" ? { type: "shuffle", enabled: event.enabled } : null;
    case "closed":
      return { type: "closed", position: seconds(event.position) };
    case "error":
      return { type: "error", position: seconds(event.position), format: event.format === true };
    default:
      return null;
  }
}

// Receives the native player's events while the returned function has not been called.
export function listenToNativePlayer(
  handler: (event: NativePlayerEvent) => void,
  scope: { videocatAndroidPlayer?: (event: unknown) => void } = window as never
): () => void {
  const listener = (raw: unknown) => {
    const event = readNativePlayerEvent(raw);
    if (event) handler(event);
  };
  scope.videocatAndroidPlayer = listener;
  return () => {
    if (scope.videocatAndroidPlayer === listener) delete scope.videocatAndroidPlayer;
  };
}
