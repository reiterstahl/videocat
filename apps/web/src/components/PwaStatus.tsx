import { useEffect, useState } from "react";
import { RefreshCw, WifiOff, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

const updateCheckIntervalMs = 60 * 60 * 1000;

// Offers new versions of the web app instead of swapping the code under an open session.
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      const check = async () => {
        if (registration.installing || !navigator.onLine) return;
        try {
          const response = await fetch(swUrl, { cache: "no-store", headers: { "cache-control": "no-cache" } });
          if (response.status === 200) await registration.update();
        } catch {
          // Offline or the server is restarting: the next check retries.
        }
      };
      window.setInterval(() => void check(), updateCheckIntervalMs);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void check();
      });
    },
    onOfflineReady() {
      setOfflineReady(false);
    }
  });

  if (!needRefresh) return null;
  return (
    <div className="vc-pwa-toast" role="status">
      <RefreshCw size={16} aria-hidden="true" />
      <span>Hay una nueva versión de VideoCAT.</span>
      <button className="vc-button is-primary is-small" onClick={() => void updateServiceWorker(true)} type="button">Actualizar</button>
      <button className="vc-icon-button is-ghost is-small" onClick={() => setNeedRefresh(false)} type="button" aria-label="Más tarde" title="Más tarde">
        <X size={15} />
      </button>
    </div>
  );
}

export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;
  return (
    <div className="vc-offline-banner" role="status">
      <WifiOff size={15} aria-hidden="true" />
      <span>Sin conexión. VideoCAT necesita llegar a tu servidor para mostrar el catálogo y guardar cambios.</span>
    </div>
  );
}
