import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [".."] }, // permite importar ../shared
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1000,
  },
});
