import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Moon, Palette, Search, SlidersHorizontal, Sun } from "lucide-react";
import { ThemePanel } from "./ThemePanel";
import type { Language } from "../i18n";
import type { NavigationItem, ViewMode } from "../lib/app-types";
import type { ResolvedAppearance, ThemePreferences } from "../lib/theme";
import type { VideoFile } from "../types";

export type AppHeaderProps = {
  activeCatalogFilters: Array<{ key: string; label: string; onRemove: () => void }>;
  activeNavigationItem: NavigationItem;
  closeThemePanel: () => void;
  companionIndicatorLabel: string;
  companionIndicatorState: string;
  filtersOpen: boolean;
  language: Language;
  q: string;
  resolvedAppearance: ResolvedAppearance;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  setLanguage: Dispatch<SetStateAction<Language>>;
  setPage: Dispatch<SetStateAction<number>>;
  setQ: Dispatch<SetStateAction<string>>;
  setSelected: Dispatch<SetStateAction<VideoFile | null>>;
  setThemePanelOpen: Dispatch<SetStateAction<boolean>>;
  shortcutLabel: string;
  showCatalogFilters: boolean;
  showFullCatalog: () => void;
  theme: "light" | "dark";
  themePanelOpen: boolean;
  themePreferences: ThemePreferences;
  toggleTheme: () => void;
  updateThemePreferences: (changes: Partial<ThemePreferences>) => void;
  viewMode: ViewMode;
};

export function AppHeader({ activeCatalogFilters, activeNavigationItem, closeThemePanel, companionIndicatorLabel, companionIndicatorState, filtersOpen, language, q, resolvedAppearance, searchInputRef, setFiltersOpen, setLanguage, setPage, setQ, setSelected, setThemePanelOpen, shortcutLabel, showCatalogFilters, showFullCatalog, theme, themePanelOpen, themePreferences, toggleTheme, updateThemePreferences, viewMode }: AppHeaderProps) {
  return (
    <header className="vc-header">
      <button className="vc-brand is-compact" onClick={showFullCatalog} type="button" title="Mostrar catalogo completo">
        <span className="vc-catmark" aria-hidden="true" />
        <em className={`agent-status-dot ${companionIndicatorState}`} title={companionIndicatorLabel} aria-label={companionIndicatorLabel} />
      </button>
      <h1 className="vc-page-title">{activeNavigationItem.label}</h1>
      {viewMode === "catalog" ? (
        <>
          <label className="vc-search">
            <Search size={17} aria-hidden="true" />
            <span className="vc-visually-hidden">Buscar en el catálogo</span>
            <input
              ref={searchInputRef}
              type="search"
              value={q}
              onChange={(event) => { setQ(event.target.value); setPage(1); }}
              placeholder="Buscar por nombre o ruta"
            />
            <kbd>{shortcutLabel}</kbd>
          </label>
          <button
            className="vc-button"
            type="button"
            aria-pressed={showCatalogFilters}
            onClick={() => {
              // With a narrow layout the detail panel hides the filters; showing them closes the detail.
              if (filtersOpen && !showCatalogFilters) setSelected(null);
              else setFiltersOpen((open) => !open);
            }}
            title="Mostrar u ocultar filtros"
          >
            <SlidersHorizontal size={17} />
            <span className="vc-button-label">Filtros</span>
            {activeCatalogFilters.length > 0 ? <span className="vc-count-badge">{activeCatalogFilters.length}</span> : null}
          </button>
        </>
      ) : null}
      <div className="vc-header-spacer" />
      <button
        className="vc-icon-button vc-mode-toggle"
        onClick={toggleTheme}
        type="button"
        title="Cambiar tema"
        aria-label="Cambiar tema"
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div className="vc-theme-anchor">
        <button
          className="vc-button"
          type="button"
          data-theme-trigger
          aria-expanded={themePanelOpen}
          aria-haspopup="dialog"
          onClick={() => setThemePanelOpen((open) => !open)}
        >
          <Palette size={18} />
          <span className="vc-button-label">Tema</span>
          <span className="vc-accent-dot" aria-hidden="true" />
        </button>
        {themePanelOpen ? (
          <ThemePanel
            preferences={themePreferences}
            resolvedAppearance={resolvedAppearance}
            onChange={updateThemePreferences}
            onClose={closeThemePanel}
            language={language}
            onLanguageChange={setLanguage}
          />
        ) : null}
      </div>
    </header>
  );
}
