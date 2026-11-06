import '@meetyou/design-tokens/fonts.css';
import '@meetyou/design-tokens/tokens.css';
import '@meetyou/ui/styles.css';
import './sidepanel.css';

import { initTheme, ToastProvider } from '@meetyou/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';

initTheme();

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
