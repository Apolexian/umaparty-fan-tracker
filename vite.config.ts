import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: {
    // Matches the `assets.directory` in wrangler.jsonc.
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:web` talks to a locally running Worker for data.
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
