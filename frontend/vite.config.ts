// frontend/vite.config.ts
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Removed unnecessary module declaration

export default defineConfig(({ mode }) => {
  // Local-first defaults
  const devPort = Number(process.env.VITE_PORT || 3000);
  const apiTarget =
    process.env.VITE_API_URL || 'http://backend:4000'; // works locally w/o env

  return {
    appType: 'spa',
    base: process.env.VITE_BASE || '/',

    plugins: [react(), tailwindcss()],

    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },

    server: {
      // For localhost this is fine; in Docker you’ll pass --host or use env (below)
      port: devPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
      // Polling only if you explicitly opt-in (useful on Docker for Mac/Win)
      watch: process.env.CHOKIDAR_USEPOLLING
        ? { usePolling: true, interval: Number(process.env.VITE_WATCH_INTERVAL || 250) }
        : undefined,
    },

    preview: {
      port: Number(process.env.VITE_PREVIEW_PORT || 8080),
    },

    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 1000,
    },
  };
});
