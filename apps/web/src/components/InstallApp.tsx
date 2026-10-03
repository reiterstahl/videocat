import { useState } from "react";
import { CheckCircle2, MonitorDown, ShieldAlert } from "lucide-react";
import { installInstructions, promptInstall, useInstallState } from "../lib/install-prompt";

// Compact entry point for the sidebar and the mobile "More" sheet; hidden unless the browser can prompt.
export function InstallAppButton({ collapsed = false, onInstalled }: { collapsed?: boolean; onInstalled?: () => void }) {
  const install = useInstallState();
  if (install.installed || !install.canPrompt) return null;
  return (
    <button
      className="vc-nav-item vc-install-button"
      onClick={() => void promptInstall().then((outcome) => { if (outcome === "accepted") onInstalled?.(); })}
      type="button"
      title={collapsed ? "Instalar app" : undefined}
    >
      <MonitorDown size={18} />
      <span className="vc-nav-label">Instalar app</span>
    </button>
  );
}

export function InstallAppPanel() {
  const install = useInstallState();
  const [message, setMessage] = useState("");

  async function installNow() {
    const outcome = await promptInstall();
    setMessage(outcome === "accepted" ? "Instalando VideoCAT…" : outcome === "dismissed" ? "Instalación cancelada. Puedes instalarla cuando quieras." : "");
  }

  return (
    <section className="vc-panel" aria-labelledby="profile-install-title">
      <div className="vc-panel-head">
        <div>
          <h2 id="profile-install-title"><MonitorDown size={16} aria-hidden="true" /> App de VideoCAT</h2>
          <p>Instálala en el móvil o la PC para abrirla desde su propio ícono, en una ventana sin pestañas.</p>
        </div>
      </div>
      <div className="vc-panel-body vc-install-panel">
        {install.installed ? (
          <p className="vc-install-status is-ok"><CheckCircle2 size={16} aria-hidden="true" /> Estás usando VideoCAT como app instalada.</p>
        ) : !install.secure ? (
          <p className="vc-install-status is-warning">
            <ShieldAlert size={16} aria-hidden="true" />
            Para instalarla, abre VideoCAT con HTTPS. Los navegadores solo permiten instalar apps desde sitios seguros o desde localhost.
          </p>
        ) : install.canPrompt ? (
          <div className="vc-install-actions">
            <button className="vc-button is-primary" onClick={() => void installNow()} type="button">
              <MonitorDown size={16} /> Instalar VideoCAT
            </button>
            <span>Se abre en su propia ventana y se actualiza sola con cada versión del servidor.</span>
          </div>
        ) : (
          <p className="vc-install-status">{installInstructions[install.platform]}</p>
        )}
        {message ? <p className="vc-install-message" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
