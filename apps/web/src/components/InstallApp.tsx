import { useState } from "react";
import { CheckCircle2, MonitorDown, Settings, ShieldAlert } from "lucide-react";
import { installInstructions, promptInstall, useInstallState } from "../lib/install-prompt";
import { androidAppSettings } from "../lib/android-app";

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

// Inside the Android app: its own settings (the fingerprint lock, the server), from the sidebar
// and the mobile "More" sheet.
export function AppSettingsButton({ collapsed = false, onOpened }: { collapsed?: boolean; onOpened?: () => void }) {
  const openAppSettings = androidAppSettings();
  if (!openAppSettings) return null;
  return (
    <button
      className="vc-nav-item"
      onClick={() => { openAppSettings(); onOpened?.(); }}
      type="button"
      title={collapsed ? "Ajustes de la app" : undefined}
    >
      <Settings size={18} />
      <span className="vc-nav-label">Ajustes de la app</span>
    </button>
  );
}

export function InstallAppPanel() {
  const install = useInstallState();
  // Inside the Android app: its own settings (the fingerprint lock, the server).
  const openAppSettings = androidAppSettings();
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
          <>
            <p className="vc-install-status is-ok"><CheckCircle2 size={16} aria-hidden="true" /> Estás usando VideoCAT como app instalada.</p>
            {openAppSettings ? (
              <div className="vc-install-actions">
                <button className="vc-button" onClick={openAppSettings} type="button">
                  <Settings size={16} /> Ajustes de la app
                </button>
                <span>Pedir la huella al abrir y cambiar de servidor.</span>
              </div>
            ) : null}
          </>
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
