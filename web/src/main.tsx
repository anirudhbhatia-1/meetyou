import '@meetyou/design-tokens/fonts.css';
import '@meetyou/design-tokens/tokens.css';
import '@meetyou/ui/styles.css';
import './app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { initTheme } from '@meetyou/ui';

import { App } from './App.tsx';

initTheme();

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
