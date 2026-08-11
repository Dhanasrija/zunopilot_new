import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/*
 * **This is the file Vite actually loads, and it should not exist.**
 *
 * Vite resolves its config in a fixed order — `vite.config.js` before
 * `vite.config.ts` — so this stale `tsc` output shadows the TypeScript config next to
 * it. That is a trap: an edit to `vite.config.ts` alone does nothing, silently.
 *
 * It is kept in step with `vite.config.ts` rather than left to rot. **Delete this file
 * and `vite.config.d.ts`** — `vite.config.ts` is the source of truth and needs no
 * compiled output.
 */

export default defineConfig(({ mode }) => {
  /*
   * `loadEnv`, not `process.env`.
   *
   * Inside the config file `process.env` has not read `.env` — Vite loads those for
   * the *client* bundle, later. `loadEnv` with an empty prefix reads the same files
   * the app does, which is what lets the proxy target below be set from `.env`
   * instead of hardcoded.
   */
  const env = loadEnv(mode, process.cwd(), '');

  /*
   * Where the dev server forwards `/api`.
   *
   * **The default is the deployed API, and that is a deliberate trade-off.**
   *
   * It used to be `http://localhost:4000`, which is the better default in principle —
   * but it requires a `.env` file to override, and `.env`/`.env.local` are the two
   * files a fresh checkout does not have. The failure was silent and misleading: with
   * no env file the dev server proxied to a backend nobody was running, every request
   * 500'd, and the marketing pages showed a spinner that never resolved. Putting the
   * working target in the config means a clone-and-run works with no setup.
   *
   * **What this costs you, and it is worth knowing.** In development, every `/api`
   * call now reaches the live API — including writes. Logging in, sending a message,
   * changing a template or creating an order from a dev session acts on production
   * data. If you are working on the backend, or on anything that writes, point this
   * back at your own instance first:
   *
   *     echo 'VITE_API_PROXY_TARGET=http://localhost:4000' > .env.local
   *
   * **Why the proxy rather than `VITE_API_BASE_URL`.** Setting an absolute API URL
   * makes the browser call another origin directly, and `backend/src/app.ts` restricts
   * CORS to `{ FRONTEND_URL, APP_URL, SUPERADMIN_ORIGIN }` — production origins, which
   * do not include `http://localhost:5173`. The deployed API would refuse the request.
   * Proxied, the browser only ever talks to its own origin and the cross-origin hop
   * happens server-side, where CORS does not apply. It also avoids mixed content when
   * the dev server is fronted by an HTTPS tunnel.
   */
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://api.zunopilot.com';

  return {
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
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // A remote target is HTTPS and served by name, so SNI has to match the
          // target host rather than `localhost`. `changeOrigin` handles the Host
          // header; `secure` stays true so a bad certificate still fails loudly.
          secure: true,
        },
      },
    },
  };
});
