import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Library web app (D-07). Static build; hosting is decided in ADR-0006. */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
});
