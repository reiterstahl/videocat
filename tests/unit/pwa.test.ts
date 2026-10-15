import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { pwaOptions } from "../../apps/web/pwa.config.ts";
import { detectInstallPlatform } from "../../apps/web/src/lib/install-prompt.ts";

const publicDir = path.resolve(import.meta.dirname, "../../apps/web/public");

test("install instructions match each browser family", () => {
  const cases: Array<[string, number, string]> = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", 0, "chromium"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0", 0, "chromium"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36", 5, "chromium"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0", 0, "firefox-windows"],
    ["Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0", 5, "firefox-android"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0", 0, "firefox-unsupported"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", 5, "ios"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1", 5, "ios"],
    // iPadOS reports a desktop Mac user agent; touch points give it away.
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", 0, "safari-mac"],
    ["Mozilla/5.0 (compatible; SomeBot/1.0)", 0, "other"]
  ];
  for (const [userAgent, touchPoints, expected] of cases) {
    assert.equal(detectInstallPlatform(userAgent, touchPoints), expected, userAgent);
  }
});

test("the web manifest is installable and its icons exist", () => {
  const manifest = pwaOptions.manifest;
  assert.ok(manifest && typeof manifest === "object");
  assert.equal(manifest.name, "VideoCAT");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  const icons = manifest.icons ?? [];
  assert.ok(icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.purpose === "maskable"));
  const files = [...icons, ...(manifest.screenshots ?? []), ...(manifest.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? [])].map((asset) => asset.src);
  for (const file of new Set(files)) assert.ok(fs.existsSync(path.join(publicDir, file)), `${file} is missing`);
});

test("the service worker never answers for server routes or caches catalog data", () => {
  const workbox = pwaOptions.workbox!;
  assert.equal(workbox.navigateFallback, null, "pages are not served from the precache first");
  const rules = workbox.runtimeCaching ?? [];
  assert.equal(rules.length, 1, "only page navigations are handled at runtime");
  const [pages] = rules;
  assert.equal(pages.handler, "NetworkFirst");
  const matches = pages.urlPattern as (options: { request: { mode: string }; url: URL }) => boolean;
  const navigate = (path: string) => matches({ request: { mode: "navigate" }, url: new URL(path, "https://cat.example") });
  assert.equal(navigate("/catalogo"), true);
  assert.equal(navigate("/"), true);
  for (const route of ["/api/files", "/api/session/return?to=/", "/thumbnails/disk/file/frame_01.jpg"]) {
    assert.equal(navigate(route), false, `${route} must always reach the network`);
  }
  assert.equal(matches({ request: { mode: "cors" }, url: new URL("/api/files", "https://cat.example") }), false, "API calls are never cached");
  assert.deepEqual(pages.options?.cacheableResponse?.statuses, [200], "proxy redirects are never cached");
  assert.equal(pwaOptions.registerType, "prompt");
});
