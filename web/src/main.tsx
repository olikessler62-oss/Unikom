import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { LanguageProvider } from './i18n/useText.js';
import { applyTheme, storedTheme } from './settings/preferences.js';
import './styles.css';

// Das Erscheinungsbild hat die Seite schon vor dem ersten Bild gesetzt; dies
// holt den Fall nach, in dem der Speicher etwas anderes sagt als das Markup.
applyTheme(storedTheme());

const container = document.getElementById('app');

if (!container) {
  throw new Error('The page is missing its #app element');
}

createRoot(container).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>
);
