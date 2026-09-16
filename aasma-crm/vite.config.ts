import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The renderer is loaded from disk by Electron in production (file://), so all
// asset URLs have to be relative. In development it is served by Vite on 5273
// and every /api call is proxied to the Express server inside Electron's main
// process.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4317}`,
        changeOrigin: true,
      },
      '/files': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4317}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          table: ['@tanstack/react-table'],
        },
      },
    },
  },
});
