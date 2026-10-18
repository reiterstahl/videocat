// The six accent schemes of the web's Tema panel and their mark color. The Companion uses the one
// chosen in the web for its tray icon while it works.
export const accentColors = {
  naranja: "#fc6121",
  cobalto: "#3b6ff5",
  esmeralda: "#12a37a",
  uva: "#8b5cf6",
  rosa: "#e5487a",
  grafito: "#64748b"
} as const;

export type AccentKey = keyof typeof accentColors;

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(accentColors, value);
}
