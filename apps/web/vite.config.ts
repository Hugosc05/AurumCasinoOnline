import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.AURUM_API ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Librerías en trozos propios: cambian poco, así el navegador las reutiliza entre versiones.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/](react-router|react-router-dom)[\\/]/.test(id)) return 'router';
          if (/[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/.test(id)) return 'motion';
          if (/[\\/]three[\\/]/.test(id)) return 'three';
          return undefined;
        },
      },
    },
  },
});
