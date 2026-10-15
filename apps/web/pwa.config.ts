import type { VitePWAOptions } from "vite-plugin-pwa";

// The service worker only precaches the app shell. API responses, thumbnails and streams are
// never cached, so no catalog data stays on the device after signing out.
export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "prompt",
  injectRegister: false,
  manifest: {
    id: "/",
    name: "VideoCAT",
    short_name: "VideoCAT",
    description: "Catálogo privado para videos repartidos en discos externos: busca, revisa, encuentra duplicados y libera espacio.",
    lang: "es",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0d0f12",
    theme_color: "#15181c",
    categories: ["productivity", "utilities", "photo"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    screenshots: [
      { src: "/pwa/screenshot-wide.webp", sizes: "1600x1000", type: "image/webp", form_factor: "wide", label: "Catálogo de VideoCAT" },
      { src: "/pwa/screenshot-narrow.webp", sizes: "600x1298", type: "image/webp", form_factor: "narrow", label: "VideoCAT en el móvil" }
    ],
    shortcuts: [
      { name: "Review", short_name: "Review", url: "/review", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Duplicados", short_name: "Duplicados", url: "/duplicados", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "A descargar", short_name: "Descargas", url: "/a-descargar", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }] }
    ]
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico,webp}"],
    globIgnores: ["pwa/screenshot-*"],
    // Opening or reloading the app always asks the network first, so an access proxy in front of
    // VideoCAT (Cloudflare Access, for example) can show its sign-in when its session expires. The
    // precached shell is only the offline fallback. Server routes are never handled here.
    navigateFallback: null,
    runtimeCaching: [
      {
        urlPattern: ({ request, url }) => request.mode === "navigate" && !/^\/(api|thumbnails)\//.test(url.pathname),
        handler: "NetworkFirst",
        options: {
          cacheName: "videocat-pages",
          networkTimeoutSeconds: 5,
          // Only real pages: a proxy redirect (status 0) or an error page is never kept.
          cacheableResponse: { statuses: [200] },
          expiration: { maxEntries: 20 },
          plugins: [
            {
              handlerDidError: async () => (await caches.match("/index.html", { ignoreSearch: true })) ?? Response.error()
            }
          ]
        }
      }
    ],
    cleanupOutdatedCaches: true,
    clientsClaim: false,
    skipWaiting: false,
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
  },
  devOptions: {
    enabled: false
  }
};
