import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_SERVER = process.env.UNIKOM_API ?? 'http://127.0.0.1:8383';

/**
 * Every build carries the moment it was made, and the interface shows it.
 *
 * An installation that runs on the customer's own machine has no app store and
 * no update banner: when someone reports that something looks or behaves
 * wrong, the first question is always which build they are actually looking
 * at. Guessing that from the outside is impossible, so the answer is written
 * on the screen.
 */
const BUILD_STAMP = new Date().toLocaleString('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

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
  /*
   * Tailwind läuft als Vite-Plugin und nicht über PostCSS.
   *
   * Es gibt keine `tailwind.config.*`: Fassung 4 ist CSS-first, und alle Marken
   * stehen in `styles.css` im `@theme`-Block. Eine zweite Datei, in der Farben
   * stehen könnten, wäre genau die zweite Fundstelle, die wir nicht wollen.
   */
  plugins: [tailwindcss(), react()],
  define: {
    __UNIKOM_BUILD__: JSON.stringify(BUILD_STAMP),
  },
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
