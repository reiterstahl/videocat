import { trayEnglish } from "./tray-i18n-en.js";

// The Companion's interface in Spanish or English. Texts are written in Spanish; English comes
// from trayEnglish, keyed by the Spanish text. A text with values uses {name} placeholders:
// t("No hay ninguna unidad conectada en {root}.", { root }). Like the web, the windows translate
// what they show (trayLocalizerScript), so a Spanish text set by their script is covered too.
// The activity log keeps the agent's own lines as they are.

export type TrayLanguage = "es" | "en";
export type TrayLanguageSetting = "auto" | TrayLanguage;

// COMPANION_LANGUAGE: "es", "en", or anything else for Windows' display language.
export function resolveTrayLanguage(setting: string | undefined, preferred: readonly string[]): TrayLanguage {
  if (setting === "es" || setting === "en") return setting;
  return preferred.some((language) => language.toLowerCase().startsWith("es")) ? "es" : "en";
}

export function translateTray(text: string, language: TrayLanguage, values?: Record<string, string | number>): string {
  const template = language === "en" ? trayEnglish[text] ?? text : text;
  return values ? template.replace(/\{(\w+)\}/g, (match: string, key: string) => (key in values ? String(values[key]) : match)) : template;
}

// For the pages: defines window.vcTr (the same translation) and translates every text and
// title, placeholder or aria-label that matches a Spanish text exactly, now and as it changes.
export function trayLocalizerScript(language: TrayLanguage): string {
  const dictionary = language === "en" ? trayEnglish : {};
  return `<script>
(() => {
  const language = ${JSON.stringify(language)};
  const dictionary = ${JSON.stringify(dictionary).replace(/</g, "\\u003c")};
  document.documentElement.lang = language;
  window.vcLanguage = language;
  window.vcTr = (text, values) => {
    const template = dictionary[text] ?? text;
    return values ? template.replace(/\\{(\\w+)\\}/g, (match, key) => (key in values ? String(values[key]) : match)) : template;
  };
  if (language === "es") return;
  const attributes = ["title", "placeholder", "aria-label"];
  const translateText = (node) => {
    const value = node.nodeValue;
    const trimmed = value ? value.trim() : "";
    const english = trimmed && dictionary[trimmed];
    if (english) node.nodeValue = value.replace(trimmed, english);
  };
  const translateElement = (element) => {
    if (element.closest && element.closest("[data-no-i18n]")) return;
    for (const name of attributes) {
      const value = element.getAttribute && element.getAttribute(name);
      if (value && dictionary[value]) element.setAttribute(name, dictionary[value]);
    }
  };
  const translateTree = (root) => {
    if (root.nodeType === Node.TEXT_NODE) {
      if (!root.parentElement || !root.parentElement.closest("[data-no-i18n], script, style")) translateText(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.closest("[data-no-i18n], script, style")) return;
    translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches("[data-no-i18n], script, style")) continue;
        translateElement(node);
      } else if (!node.parentElement.closest("[data-no-i18n], script, style")) {
        translateText(node);
      }
    }
  };
  const start = () => {
    translateTree(document.body);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateTree(mutation.target);
        else if (mutation.type === "attributes") translateElement(mutation.target);
        else mutation.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
</script>`;
}
