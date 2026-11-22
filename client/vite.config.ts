import { defineConfig } from "vite";

// El servidor de juego (Colyseus, puerto 2567) se sirve también desde la misma dirección que la
// página, bajo /colyseus. Así basta con compartir un solo puerto (5173) en la red local o con un
// túnel a internet, y el navegador no necesita conectarse aparte al 2567.
const gameServer = {
  "/colyseus": {
    target: "http://localhost:2567",
    ws: true,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/colyseus/, ""),
  },
};

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [".."] }, // permite importar ../shared
    proxy: gameServer,
    // permite abrir el juego desde un túnel (p. ej. https://algo.trycloudflare.com)
    allowedHosts: true,
  },
  preview: {
    port: 5173,
    proxy: gameServer,
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1000,
  },
});
