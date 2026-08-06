import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // Allow HTTPS dev tunnels (Meta's FB.login / Embedded Signup requires an
    // HTTPS origin, so localhost is served through a tunnel during testing).
    allowedHosts: ['localhost', 'x.zunopilot.com', '.zunopilot.com', '.ngrok-free.app'],
    // Proxy the API through the dev server so a single tunnel origin serves both
    // the app and /api (incl. /api/webhook for Meta). Avoids mixed content + CORS.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
