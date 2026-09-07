import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces so the dev server is reachable from the container and, more
    // importantly, from a phone on the same network during feat/participant-flow.
    host: true,
  },
});
