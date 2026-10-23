import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { api } from "../lib/api";
import type { DiskHealthAlert } from "../lib/app-types";

const refreshMs = 10 * 60_000;

// Drives whose SMART check says they are probably failing, on every section until dismissed.
// A dismissed alert comes back when the drive gets worse (the server keeps the dismissed state).
export function DiskHealthAlerts({ refreshKey, onOpenDisk }: { refreshKey: number; onOpenDisk: () => void }) {
  const [alerts, setAlerts] = useState<DiskHealthAlert[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ alerts: DiskHealthAlert[] }>("/api/disk-health/alerts")
      .then((response) => setAlerts(response.alerts))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, refreshMs);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  async function dismiss(alert: DiskHealthAlert) {
    setDismissing(alert.diskId);
    try {
      await api(`/api/disk-health/${alert.diskId}/dismiss`, { method: "POST" });
      setAlerts((current) => current.filter((item) => item.diskId !== alert.diskId));
    } catch {
      // It stays visible; the next refresh tries again.
    } finally {
      setDismissing(null);
    }
  }

  if (alerts.length === 0) return null;
  return (
    <div className="vc-health-alerts">
      {alerts.map((alert) => (
        <div className="vc-status-banner is-danger vc-health-alert" key={alert.diskId} role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>{`Falla probable: ${alert.diskName}`}</strong>
            <span>{`${alert.items.filter((item) => item.severity === "failing").map((item) => `${item.label}: ${item.value}`).join(" · ") || "SMART indica que el disco puede fallar"}. Copia cuanto antes lo que no tengas en otro lado.`}</span>
            <button className="vc-button is-small" onClick={onOpenDisk} type="button">Ver el disco</button>
          </div>
          <button
            className="icon-button vc-health-alert-dismiss"
            disabled={dismissing === alert.diskId}
            onClick={() => void dismiss(alert)}
            type="button"
            aria-label={`Descartar el aviso de ${alert.diskName}`}
            title="Descartar: vuelve a aparecer si el disco empeora"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
