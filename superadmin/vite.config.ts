import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The operator console, served separately from the customer app.
//
// A different Vite project rather than a route inside `frontend/`, for one reason
// that matters more than the duplication it costs: **this bundle must never be
// served to a customer.** A route tree inside the customer app ships every admin
// screen, label and endpoint path to every browser that loads the dashboard, and
// "the router won't render it" is not a boundary.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5174,
    strictPort: true,
    // Proxied so the browser talks to one origin in development and the token
    // never rides on a cross-site request.
    proxy: {
      '/sa': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
});
