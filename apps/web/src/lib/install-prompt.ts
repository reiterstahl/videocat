import { useSyncExternalStore } from "react";

// Chromium browsers fire beforeinstallprompt; everything else installs from the browser UI.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallPlatform =
  | "chromium"
  | "ios"
  | "safari-mac"
  | "firefox-windows"
  | "firefox-android"
  | "firefox-unsupported"
  | "other";

export type InstallState = {
  canPrompt: boolean;
  installed: boolean;
  secure: boolean;
  platform: InstallPlatform;
};

export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Firefox\//.test(userAgent)) {
    if (/Android/.test(userAgent)) return "firefox-android";
    if (/Windows/.test(userAgent)) return "firefox-windows";
    return "firefox-unsupported";
  }
  if (/Chrome\/|Chromium\/|Edg\/|OPR\/|SamsungBrowser\//.test(userAgent)) return "chromium";
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent)) return "safari-mac";
  return "other";
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let capturing = false;
const listeners = new Set<() => void>();
let snapshot: InstallState = computeState();

function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: minimal-ui)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function computeState(): InstallState {
  if (typeof window === "undefined") return { canPrompt: false, installed: false, secure: false, platform: "other" };
  return {
    canPrompt: deferredPrompt !== null,
    installed: installedNow || standalone(),
    secure: window.isSecureContext,
    platform: detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints)
  };
}

function emit() {
  snapshot = computeState();
  for (const listener of listeners) listener();
}

// Called before React renders so an early beforeinstallprompt is not lost.
export function startInstallPromptCapture(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedNow = true;
    emit();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", emit);
  emit();
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";
  // A deferred prompt can only be shown once.
  deferredPrompt = null;
  emit();
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === "accepted") installedNow = true;
  emit();
  return choice.outcome;
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}

export const installInstructions: Record<InstallPlatform, string> = {
  chromium: "Usa el ícono Instalar de la barra de direcciones o el menú del navegador › Instalar VideoCAT.",
  ios: "Toca Compartir y luego Agregar a pantalla de inicio.",
  "safari-mac": "En Safari, elige Archivo › Añadir al Dock.",
  "firefox-windows": "En Firefox 143 o posterior, usa el ícono Añadir a la barra de tareas, a la derecha de la barra de direcciones.",
  "firefox-android": "Abre el menú de Firefox y elige Instalar.",
  "firefox-unsupported": "Firefox solo instala apps en Windows y Android. En este equipo usa Chrome, Edge o Safari.",
  other: "Busca Instalar o Agregar a pantalla de inicio en el menú del navegador."
};
