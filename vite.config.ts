import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/lib/btwEngine': fileURLToPath(new URL('./src/lib/btwEngineSafe.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { host: '0.0.0.0', port: 3000, allowedHosts: 'all' },
  optimizeDeps: {
    exclude: ['lucide-react', 'pdfjs-dist'],
  },
});