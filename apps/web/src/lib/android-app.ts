// The VideoCAT Android app opens this same page, from the person's own server, in a WebView and
// does natively what a WebView cannot. It announces itself with a JavaScript bridge
// (ANDROID_APP_PLAN.es.md):
//   window.VideoCatAndroid.version(): number       the bridge's version
//   window.VideoCatAndroid.capabilities(): string  a JSON list of what the app does natively
// Without the bridge the page is in a browser and does everything itself.

type AndroidBridge = {
  version: () => number;
  capabilities: () => string;
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
