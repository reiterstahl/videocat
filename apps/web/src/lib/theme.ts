export type Appearance = "system" | "light" | "dark" | "oled";
export type ResolvedAppearance = "light" | "dark" | "oled";
export type Accent = "naranja" | "cobalto" | "esmeralda" | "uva" | "rosa" | "grafito";
export type Density = "comfortable" | "compact";

export type ThemePreferences = {
  appearance: Appearance;
  accent: Accent;
  density: Density;
};

export const appearanceOptions: Array<{ key: Appearance; label: string }> = [
  { key: "system", label: "Sistema" },
  { key: "light", label: "Claro" },
  { key: "dark", label: "Oscuro" },
  { key: "oled", label: "OLED" }
];

// Swatches mirror the --vc-accent / --vc-accent-soft tokens in theme.css.
export const accentOptions: Array<{ key: Accent; label: string; swatch: string; softLight: string; softDark: string }> = [
  { key: "naranja", label: "Naranja CAT", swatch: "#fc6121", softLight: "#fff0e8", softDark: "#3a1d10" },
  { key: "cobalto", label: "Cobalto", swatch: "#3b6ff5", softLight: "#eaf0ff", softDark: "#16213f" },
  { key: "esmeralda", label: "Esmeralda", swatch: "#12a37a", softLight: "#e4f6ef", softDark: "#0f2e25" },
  { key: "uva", label: "Uva", swatch: "#8b5cf6", softLight: "#f1ebff", softDark: "#251a40" },
  { key: "rosa", label: "Rosa", swatch: "#e5487a", softLight: "#fdeaf0", softDark: "#3a1624" },
  { key: "grafito", label: "Grafito", swatch: "#64748b", softLight: "#eef1f4", softDark: "#232a33" }
];

export const densityOptions: Array<{ key: Density; label: string }> = [
  { key: "comfortable", label: "Cómoda" },
  { key: "compact", label: "Compacta" }
];

const appearanceKey = "videocat-appearance";
const legacyThemeKey = "videocat-theme";
const accentKey = "videocat-accent";
const densityKey = "videocat-density";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the theme still applies for this session.
  }
}

function isAppearance(value: string | null): value is Appearance {
  return appearanceOptions.some((option) => option.key === value);
}

function isAccent(value: string | null): value is Accent {
  return accentOptions.some((option) => option.key === value);
}

function isDensity(value: string | null): value is Density {
  return densityOptions.some((option) => option.key === value);
}

export function readThemePreferences(): ThemePreferences {
  const storedAppearance = readStorage(appearanceKey);
  const legacyTheme = readStorage(legacyThemeKey);
  const appearance = isAppearance(storedAppearance)
    ? storedAppearance
    : legacyTheme === "light" || legacyTheme === "dark"
      ? legacyTheme
      : "system";
  const storedAccent = readStorage(accentKey);
  const storedDensity = readStorage(densityKey);
  return {
    appearance,
    accent: isAccent(storedAccent) ? storedAccent : "naranja",
    density: isDensity(storedDensity) ? storedDensity : "comfortable"
  };
}

export function saveThemePreferences(preferences: ThemePreferences): void {
  writeStorage(appearanceKey, preferences.appearance);
  writeStorage(accentKey, preferences.accent);
  writeStorage(densityKey, preferences.density);
}

export function resolveAppearance(appearance: Appearance, prefersDark: boolean): ResolvedAppearance {
  if (appearance === "system") return prefersDark ? "dark" : "light";
  return appearance;
}

export function applyTheme(resolved: ResolvedAppearance, preferences: ThemePreferences): void {
  const root = document.documentElement;
  // data-theme stays light/dark so the existing dark overrides keep working; OLED only swaps surface tokens.
  root.dataset.theme = resolved === "light" ? "light" : "dark";
  root.dataset.surface = resolved === "oled" ? "oled" : "default";
  root.dataset.accent = preferences.accent;
  root.dataset.density = preferences.density;
}
