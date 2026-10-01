import { Check } from "lucide-react";
import { languageLabel, type Language } from "../i18n";
import {
  accentOptions,
  appearanceOptions,
  densityOptions,
  type ResolvedAppearance,
  type ThemePreferences
} from "../lib/theme";

type ThemeControlsProps = {
  preferences: ThemePreferences;
  resolvedAppearance: ResolvedAppearance;
  onChange: (changes: Partial<ThemePreferences>) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

export function ThemeControls({ preferences, resolvedAppearance, onChange, language, onLanguageChange }: ThemeControlsProps) {
  const isLight = resolvedAppearance === "light";

  return (
    <>
      <div className="vc-theme-section">
        <span className="vc-overline">Apariencia</span>
        <div className="vc-segmented is-four" role="group" aria-label="Apariencia">
          {appearanceOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={preferences.appearance === option.key}
              onClick={() => onChange({ appearance: option.key })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="vc-theme-section">
        <span className="vc-overline">Esquema de color</span>
        <div className="vc-swatch-grid" role="group" aria-label="Esquema de color">
          {accentOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className="vc-swatch"
              aria-pressed={preferences.accent === option.key}
              onClick={() => onChange({ accent: option.key })}
            >
              <span className="vc-swatch-dots" aria-hidden="true">
                <span style={{ background: option.swatch }} />
                <span style={{ background: isLight ? option.softLight : option.softDark }} />
              </span>
              <span className="vc-swatch-label">{option.label}</span>
              {preferences.accent === option.key ? <Check className="vc-swatch-check" size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="vc-theme-section">
        <span className="vc-overline">Densidad</span>
        <div className="vc-segmented" role="group" aria-label="Densidad">
          {densityOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={preferences.density === option.key}
              onClick={() => onChange({ density: option.key })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="vc-theme-section">
        <span className="vc-overline">Idioma</span>
        <div className="vc-segmented" role="group" aria-label="Idioma">
          {(["es", "en"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={language === option} onClick={() => onLanguageChange(option)}>
              {languageLabel(option)}
            </button>
          ))}
        </div>
      </div>

    </>
  );
}
