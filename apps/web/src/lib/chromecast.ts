const castSenderScriptId = "videocat-google-cast-sdk";
const castSenderScriptUrl = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

type CastWindow = Window & {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: {
    framework: {
      CastContext: { getInstance(): CastContext };
    };
  };
  chrome?: {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: unknown };
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (url: string, contentType: string) => CastMediaInfo;
        GenericMediaMetadata: new () => CastMediaMetadata;
        LoadRequest: new (mediaInfo: CastMediaInfo) => unknown;
      };
    };
  };
};

type CastMediaMetadata = { title?: string; subtitle?: string };
type CastMediaInfo = { metadata?: CastMediaMetadata };
type CastSession = {
  getCastDevice(): { friendlyName?: string };
  loadMedia(request: unknown): Promise<unknown>;
};
type CastContext = {
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: unknown }): void;
  getCurrentSession(): CastSession | null;
  requestSession(): Promise<unknown>;
};

let frameworkPromise: Promise<CastContext> | null = null;

function initializeCastFramework(): CastContext {
  const castWindow = window as CastWindow;
  if (!castWindow.cast?.framework || !castWindow.chrome?.cast) {
    throw new Error("Google Cast no esta disponible en este navegador.");
  }
  const context = castWindow.cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: castWindow.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: castWindow.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  return context;
}

export function loadChromecastFramework(): Promise<CastContext> {
  if (frameworkPromise) return frameworkPromise;
  frameworkPromise = new Promise<CastContext>((resolve, reject) => {
    const castWindow = window as CastWindow;
    if (castWindow.cast?.framework && castWindow.chrome?.cast) {
      resolve(initializeCastFramework());
      return;
    }

    const timeout = window.setTimeout(() => reject(new Error("Google Cast no respondio a tiempo.")), 15_000);
    castWindow.__onGCastApiAvailable = (available) => {
      window.clearTimeout(timeout);
      if (!available) {
        reject(new Error("Google Cast no esta disponible en este dispositivo."));
        return;
      }
      try {
        resolve(initializeCastFramework());
      } catch (error) {
        reject(error);
      }
    };

    if (!document.getElementById(castSenderScriptId)) {
      const script = document.createElement("script");
      script.id = castSenderScriptId;
      script.src = castSenderScriptUrl;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("No se pudo cargar Google Cast."));
      };
      document.head.appendChild(script);
    }
  }).catch((error) => {
    frameworkPromise = null;
    throw error;
  });
  return frameworkPromise;
}

export async function castVideo(input: {
  url: string;
  contentType: string;
  title: string;
  subtitle?: string;
}): Promise<{ deviceName: string }> {
  const context = await loadChromecastFramework();
  let session = context.getCurrentSession();
  if (!session) {
    await context.requestSession();
    session = context.getCurrentSession();
  }
  if (!session) throw new Error("No se selecciono un Chromecast.");

  const castWindow = window as CastWindow;
  if (!castWindow.chrome?.cast) throw new Error("Google Cast no esta disponible.");
  const mediaInfo = new castWindow.chrome.cast.media.MediaInfo(input.url, input.contentType);
  const metadata = new castWindow.chrome.cast.media.GenericMediaMetadata();
  metadata.title = input.title;
  metadata.subtitle = input.subtitle;
  mediaInfo.metadata = metadata;
  await session.loadMedia(new castWindow.chrome.cast.media.LoadRequest(mediaInfo));
  return { deviceName: session.getCastDevice().friendlyName ?? "Chromecast" };
}
