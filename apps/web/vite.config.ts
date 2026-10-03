import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { pwaOptions } from "./pwa.config.ts";

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  resolve: {
    alias: {
      "@videocat/shared": path.resolve(import.meta.dirname, "../../packages/shared/src/index.ts")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      },
      "/thumbnails": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
