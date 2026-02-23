// frontend/vite.config.ts
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const devPort = Number(process.env.VITE_PORT || 3000);

  const apiTarget = process.env.API_PROXY_TARGET || "http://backend:4000";

  return {
    appType: "spa",
    base: process.env.VITE_BASE || "/",
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },

    server: {
      host: true,          // LAN access
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
      watch: process.env.CHOKIDAR_USEPOLLING
        ? { usePolling: true, interval: Number(process.env.VITE_WATCH_INTERVAL || 250) }
        : undefined,
    },

    preview: { port: Number(process.env.VITE_PREVIEW_PORT || 8080) },

    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 1000,
    },
  };
});