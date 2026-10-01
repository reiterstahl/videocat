import type { Dispatch, SetStateAction } from "react";
import { LogOut, MoreHorizontal, Palette } from "lucide-react";
import type { NavigationItem, ViewMode } from "../lib/app-types";
import type { Disk } from "../types";

export type MobileNavProps = {
  companionIndicatorLabel: string;
  companionIndicatorState: string;
  connectedDiskIds: string[];
  disks: Disk[];
  logout: () => Promise<void>;
  mobileMenuOpen: boolean;
  mobileMoreItems: NavigationItem[];
  mobileTabItems: NavigationItem[];
  setMobileMenuOpen: Dispatch<SetStateAction<boolean>>;
  setThemePanelOpen: Dispatch<SetStateAction<boolean>>;
  switchView: (mode: ViewMode) => void;
  viewMode: ViewMode;
};

export function MobileNav({ companionIndicatorLabel, companionIndicatorState, connectedDiskIds, disks, logout, mobileMenuOpen, mobileMoreItems, mobileTabItems, setMobileMenuOpen, setThemePanelOpen, switchView, viewMode }: MobileNavProps) {
  return (
    <>
    <nav className="vc-tabbar" aria-label="Secciones">
      {mobileTabItems.map((item) => (
        <button
          key={item.mode}
          className={`vc-tab ${viewMode === item.mode ? "is-active" : ""}`}
          aria-current={viewMode === item.mode ? "page" : undefined}
          onClick={() => switchView(item.mode)}
          type="button"
        >
          {item.icon}
          <span>{item.mode === "downloads" ? "Descargas" : item.label}</span>
          {item.badge ? <span className="vc-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
      <button
        className={`vc-tab ${mobileMenuOpen || mobileMoreItems.some((item) => item.mode === viewMode) ? "is-active" : ""}`}
        onClick={() => setMobileMenuOpen((open) => !open)}
        aria-expanded={mobileMenuOpen}
        aria-haspopup="dialog"
        type="button"
      >
        <MoreHorizontal size={20} />
        <span>Más</span>
      </button>
    </nav>

    {mobileMenuOpen ? (
      <>
        <button className="vc-sheet-scrim" type="button" aria-label="Cerrar menú" onClick={() => setMobileMenuOpen(false)} />
        <div className="vc-sheet vc-more-sheet" role="dialog" aria-modal="true" aria-label="Más secciones">
          <span className="vc-sheet-handle" aria-hidden="true" />
          <div className={`vc-companion-card ${companionIndicatorState}`}>
            <span className="vc-companion-title">
              <em className={`agent-status-dot ${companionIndicatorState}`} aria-hidden="true" />
              <span>{companionIndicatorLabel}</span>
            </span>
            <span className="vc-companion-meta">{`${connectedDiskIds.length} de ${disks.length} discos seleccionados`}</span>
          </div>
          <nav className="vc-nav" aria-label="Más secciones">
            {mobileMoreItems.map((item) => (
              <button
                key={item.mode}
                className={`vc-nav-item ${viewMode === item.mode ? "is-active" : ""}`}
                aria-current={viewMode === item.mode ? "page" : undefined}
                onClick={() => switchView(item.mode)}
                type="button"
              >
                {item.icon}
                <span className="vc-nav-label">{item.label}</span>
              </button>
            ))}
            <button
              className="vc-nav-item"
              onClick={() => {
                setMobileMenuOpen(false);
                setThemePanelOpen(true);
              }}
              type="button"
            >
              <Palette size={18} />
              <span className="vc-nav-label">Tema e idioma</span>
            </button>
            <button className="vc-nav-item" onClick={logout} type="button">
              <LogOut size={18} />
              <span className="vc-nav-label">Salir</span>
            </button>
          </nav>
        </div>
      </>
    ) : null}
    </>
  );
}
