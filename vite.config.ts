import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the extension's HTML pages (side panel + settings). The service worker and
// content script are bundled separately by scripts/build-scripts.mjs because Chrome
// needs them as single self-contained files.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        settings: resolve(import.meta.dirname, "settings.html"),
      },
    },
  },
});
