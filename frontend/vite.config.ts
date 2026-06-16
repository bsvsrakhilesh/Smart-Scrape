// frontend/vite.config.ts
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const devPort = Number(process.env.VITE_PORT || 3000);

  const apiTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:4000";
  const srcDir = fileURLToPath(new URL("./src", import.meta.url));


  return {
    appType: "spa",
    base: process.env.VITE_BASE || "/",
    plugins: [react()],
    resolve: { alias: { "@": srcDir } },
    optimizeDeps: {
      noDiscovery: true,
    },

    server: {
      host: true,          // LAN access
      port: devPort,
      strictPort: true,
      fs: {
        allow: ["."],
      },
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
