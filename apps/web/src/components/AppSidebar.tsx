import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, Download, Github, Heart, LogOut } from "lucide-react";
import { type Language, translateText } from "../i18n";
import { githubProfileUrl, githubSponsorsUrl, paypalDonateUrl, webVersion } from "../lib/app-config";
import type { NavigationItem, ViewMode } from "../lib/app-types";
import type { Disk } from "../types";
import { InstallAppButton } from "./InstallApp";

export type AppSidebarProps = {
  availableUpdate: string | null;
  companionIndicatorLabel: string;
  companionIndicatorState: string;
  connectedDiskIds: string[];
  disks: Disk[];
  language: Language;
  logout: () => Promise<void>;
  primaryNavigationItems: NavigationItem[];
  secondaryNavigationItems: NavigationItem[];
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  showFullCatalog: () => void;
  sidebarCollapsed: boolean;
  switchView: (mode: ViewMode) => void;
  viewMode: ViewMode;
};

export function AppSidebar({ availableUpdate, companionIndicatorLabel, companionIndicatorState, connectedDiskIds, disks, language, logout, primaryNavigationItems, secondaryNavigationItems, setSidebarCollapsed, showFullCatalog, sidebarCollapsed, switchView, viewMode }: AppSidebarProps) {
  return (
    <aside className="vc-sidebar" aria-label="Navegación">
      <button className="vc-brand" onClick={showFullCatalog} type="button" title="Mostrar catalogo completo">
        <span className="vc-catmark" aria-hidden="true" />
        <span className="vc-brand-word">Video<span>CAT</span></span>
        <small className="vc-brand-version">v{webVersion}</small>
      </button>
      {availableUpdate ? (
        <span
          className="vc-update-badge"
          title={language === "en"
            ? `VideoCAT ${availableUpdate} is available on Docker Hub`
            : `VideoCAT ${availableUpdate} está disponible en Docker Hub`}
        >
          <Download size={13} />
          <span className="vc-nav-label">{`v${availableUpdate} disponible`}</span>
        </span>
      ) : null}
      <nav className="vc-nav" aria-label="Secciones principales">
        {primaryNavigationItems.map((item) => (
          <button
            key={item.mode}
            className={`vc-nav-item ${viewMode === item.mode ? "is-active" : ""}`}
            aria-current={viewMode === item.mode ? "page" : undefined}
            onClick={() => switchView(item.mode)}
            type="button"
            title={sidebarCollapsed ? translateText(item.label, language) : undefined}
          >
            {item.icon}
            <span className="vc-nav-label">{item.label}</span>
            {item.badge ? <span className="vc-nav-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      <div className="vc-sidebar-spacer" />
      <InstallAppButton collapsed={sidebarCollapsed} />
      <div className="vc-support">
        <div className="support-links" aria-label="Apoyar VideoCAT">
          <span>
            <Heart size={14} />
            Apoyar VideoCAT
          </span>
          <a href={githubProfileUrl} target="_blank" rel="noreferrer" title="Perfil de GitHub">
            <Github size={14} />
            GitHub
          </a>
          {githubSponsorsUrl ? (
            <a href={githubSponsorsUrl} target="_blank" rel="noreferrer">
              GitHub Sponsors
            </a>
          ) : (
            <span className="support-link-disabled" title="Configura VITE_GITHUB_SPONSORS_URL">
              GitHub Sponsors
            </span>
          )}
          {paypalDonateUrl ? (
            <a href={paypalDonateUrl} target="_blank" rel="noreferrer">
              PayPal
            </a>
          ) : (
            <span className="support-link-disabled" title="Configura VITE_PAYPAL_DONATE_URL">
              PayPal
            </span>
          )}
        </div>
      </div>
      <div className={`vc-companion-card ${companionIndicatorState}`} title={companionIndicatorLabel}>
        <span className="vc-companion-title">
          <em className={`agent-status-dot ${companionIndicatorState}`} aria-hidden="true" />
          <span className="vc-nav-label">{companionIndicatorLabel}</span>
        </span>
        <span className="vc-companion-meta vc-nav-label">
          {`${connectedDiskIds.length} de ${disks.length} discos seleccionados`}
        </span>
      </div>
      <nav className="vc-nav" aria-label="Cuenta">
        {secondaryNavigationItems.map((item) => (
          <button
            key={item.mode}
            className={`vc-nav-item ${viewMode === item.mode ? "is-active" : ""}`}
            aria-current={viewMode === item.mode ? "page" : undefined}
            onClick={() => switchView(item.mode)}
            type="button"
            title={sidebarCollapsed ? translateText(item.label, language) : undefined}
          >
            {item.icon}
            <span className="vc-nav-label">{item.label}</span>
          </button>
        ))}
        <button className="vc-nav-item" onClick={logout} type="button" title={sidebarCollapsed ? translateText("Salir", language) : undefined}>
          <LogOut size={18} />
          <span className="vc-nav-label">Salir</span>
        </button>
        <button
          className="vc-nav-item vc-collapse-button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          type="button"
          aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          aria-expanded={!sidebarCollapsed}
        >
          <ChevronLeft size={18} />
          <span className="vc-nav-label">Contraer</span>
        </button>
      </nav>
    </aside>
  );
}
