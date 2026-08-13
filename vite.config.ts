import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_SERVER = process.env.UNIKOM_API ?? 'http://127.0.0.1:8383';

/**
 * The interface lives in `web/` and is built into `dist/web`, from where the
 * Node server delivers it. There is deliberately no second process in
 * operation: one installation, one port, one thing to start.
 *
 * During development Vite serves the pages and passes /api through to the
 * running server, so the browser sees a single origin and the session cookie
 * behaves exactly as it will later.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_SERVER,
        changeOrigin: false,
      },
    },
  },
});
