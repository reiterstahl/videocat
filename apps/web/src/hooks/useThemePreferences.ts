import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";
import { logoUrl, logoWhiteUrl } from "../lib/app-config";
import {
  applyTheme,
  readThemePreferences,
  resolveAppearance,
  saveThemePreferences,
  type ThemePreferences
} from "../lib/theme";

// Theme preferences per browser: appearance (with system dark mode), accent and density.
export function useThemePreferences() {
  const [themePreferences, setThemePreferences] = useState<ThemePreferences>(readThemePreferences);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolvedAppearance = resolveAppearance(themePreferences.appearance, prefersDark);
  const theme = resolvedAppearance === "light" ? "light" : "dark";

  useEffect(() => {
    applyTheme(resolvedAppearance, themePreferences);
    saveThemePreferences(themePreferences);
    document.querySelector<HTMLLinkElement>("link[rel='icon']")?.setAttribute("href", theme === "dark" ? logoWhiteUrl : logoUrl);
  }, [resolvedAppearance, theme, themePreferences]);

  function toggleTheme() {
    setThemePreferences((current) => ({ ...current, appearance: theme === "dark" ? "light" : "dark" }));
  }

  function updateThemePreferences(changes: Partial<ThemePreferences>) {
    setThemePreferences((current) => ({ ...current, ...changes }));
  }

  return { themePreferences, resolvedAppearance, theme, toggleTheme, updateThemePreferences } as const;
}
