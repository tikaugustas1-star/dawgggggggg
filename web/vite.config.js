import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } },
  worker: { format: 'es' }, // MapLibre creates its worker as an ES module
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 }, // map chunk is lazy-loaded
});
