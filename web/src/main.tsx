import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const container = document.getElementById('app');

if (!container) {
  throw new Error('The page is missing its #app element');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
