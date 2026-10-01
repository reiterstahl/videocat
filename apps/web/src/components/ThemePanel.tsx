import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Language } from "../i18n";
import type { ResolvedAppearance, ThemePreferences } from "../lib/theme";
import { ThemeControls } from "./ThemeControls";

type ThemePanelProps = {
  preferences: ThemePreferences;
  resolvedAppearance: ResolvedAppearance;
  onChange: (changes: Partial<ThemePreferences>) => void;
  onClose: () => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

export function ThemePanel({ preferences, resolvedAppearance, onChange, onClose, language, onLanguageChange }: ThemePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!panelRef.current || !target) return;
      if (panelRef.current.contains(target) || target.closest("[data-theme-trigger]")) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="vc-theme-panel" role="dialog" aria-label="Tema e idioma" ref={panelRef}>
      <div className="vc-theme-panel-header">
        <strong>Tema e idioma</strong>
        <button type="button" className="vc-icon-button is-ghost" onClick={onClose} aria-label="Cerrar">
          <X size={16} />
        </button>
      </div>

      <ThemeControls
        preferences={preferences}
        resolvedAppearance={resolvedAppearance}
        onChange={onChange}
        language={language}
        onLanguageChange={onLanguageChange}
      />

      <p className="vc-theme-note">Se guarda en este navegador. «Sistema» sigue la preferencia del dispositivo.</p>
    </div>
  );
}
