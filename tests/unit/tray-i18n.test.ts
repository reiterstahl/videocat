import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { resolveTrayLanguage, translateTray } from "../../apps/agent-windows/src/tray-i18n.ts";
import { trayEnglish } from "../../apps/agent-windows/src/tray-i18n-en.ts";

const source = (file: string) => fs.readFileSync(new URL(file.startsWith("../") ? `../../packages/shared/src/${file.slice(3)}` : `../../apps/agent-windows/src/${file}`, import.meta.url), "utf8");
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const unescape = (text: string) => JSON.parse(`"${text}"`) as string;

test("the Companion follows Windows' language unless one is chosen", () => {
  assert.equal(resolveTrayLanguage("auto", ["es-CR", "en-US"]), "es");
  assert.equal(resolveTrayLanguage(undefined, ["en-US"]), "en");
  assert.equal(resolveTrayLanguage("", ["de-DE"]), "en");
  assert.equal(resolveTrayLanguage("es", ["en-US"]), "es");
  assert.equal(resolveTrayLanguage("en", ["es-ES"]), "en");
});

test("texts translate with their values, and Spanish stays as written", () => {
  assert.equal(translateTray("Escaneo de {name}", "en", { name: "WD 4TB" }), "Scan of WD 4TB");
  assert.equal(translateTray("Escaneo de {name}", "es", { name: "WD 4TB" }), "Escaneo de WD 4TB");
  assert.equal(translateTray("Texto sin traducción", "en"), "Texto sin traducción");
});

test("every text the Companion's code translates, log lines included, has its English, with the same values", () => {
  const used = new Set<string>();
  for (const [file, pattern] of [
    ["tray.ts", /\bt\("((?:[^"\\]|\\.)*)"/g],
    ["tray-animation.ts", /translateTray\("((?:[^"\\]|\\.)*)"/g],
    ["tray-pages.ts", /\btr\("((?:[^"\\]|\\.)*)"/g],
    // The agent's log lines and those of the transfers and the video pipeline.
    ["index.ts", /\btl\("((?:[^"\\]|\\.)*)"/g],
    ["transfer-engine.ts", /\btl\("((?:[^"\\]|\\.)*)"/g],
    ["../media.ts", /fill\(log, "((?:[^"\\]|\\.)*)"/g]
  ] as const) {
    for (const match of source(file).matchAll(pattern)) used.add(unescape(match[1]));
  }
  const missing = [...used].filter((text) => !(text in trayEnglish));
  assert.deepEqual(missing, [], "texts without English");
  for (const text of used) assert.deepEqual(placeholders(trayEnglish[text]), placeholders(text), `values of «${text}»`);
});
