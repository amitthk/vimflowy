VIMFLOWY - Mind Mapping Tool

REQUIREMENTS:
- Node.js 16+
- Directus instance with API access

SETUP (local Node server + static UI):
1. Install dependencies:
   npm install

2. Configure environment:
   cp .env.example .env
   (Optional Docker overrides: docker-compose.override.yml.example)
   Edit .env and set:
   - DIRECTUS_STATIC_URL
   - DIRECTUS_STATIC_TOKEN
   - DIRECTUS_ADMIN_TOKEN (for schema bootstrap only)
   - ADMIN_PASSWORD (choose a strong value; used only when seeding Directus)

3. Bootstrap Directus schema and admin user:
   npm run setup:directus

4. Build and start:
   npm run build
   ./start.sh

ADMIN_PASSWORD (important):
- Used only when you run `npm run setup:directus`. It hashes into Directus
  collection `vimflowy_users` for username `admin`.
- It is NOT read by the Cloudflare Worker at runtime. After seeding, you log
  in at /login.html with username `admin` and the password you chose in .env
  for that script run.
- Step-by-step production password rotation: docs/CLOUDFLARE.md
  (section "Checklist: change the admin password in production").

Data backends overview: docs/BACKENDS.md

CLOUDFLARE (full detail: docs/CLOUDFLARE.md):
1. Same .env as above: run `npm run setup:directus` once against your Directus.
2. Worker config is not committed: copy `wrangler.toml.example` to `wrangler.toml`
   and set name, DIRECTUS_STATIC_URL, KV id, R2 bucket, and optional custom domain.
3. Put DIRECTUS_STATIC_TOKEN in the Worker:
   npx wrangler secret put DIRECTUS_STATIC_TOKEN
4. Deploy (this uses build:cloudflare so the UI talks to wss://same-host/socket):
   npm run deploy:cloudflare

   Custom hostnames in wrangler.toml use Workers Custom Domains (Cloudflare
   provisions DNS + TLS). If DNS still fails, wait for propagation or use the
   workers.dev URL from the deploy output.

Vimflowy server / WebSocket:
- On HTTPS, the browser uses wss:// on the SAME host as the page (not
  ws://localhost). localhost only works for a server running on your machine.
- Docker builds set REACT_APP_SERVER_CONFIG={"socketserver":true}. Cloudflare
  deploy uses `npm run build:cloudflare`, which does the same. Then you do not
  configure a server URL in Settings; you sign in at /login.html first.
- Optional Firebase (Realtime Database) is documented in docs/FIREBASE.md.
  The Cloudflare path uses Directus (often backed by PostgreSQL) plus R2, not
  Firebase.

RUN:
Development frontend: npm start
Production server: npm run build && npm run startprod -- --host localhost --port 8300

ENVIRONMENT (.env):
- DIRECTUS_STATIC_URL: Directus URL
- DIRECTUS_STATIC_TOKEN: Runtime token used by the app / Worker
- DIRECTUS_ADMIN_TOKEN: Admin token used by setup script
- ADMIN_PASSWORD: Seeds or updates the `admin` user's password hash in Directus

TROUBLESHOOTING:
If login or syncing doesn't work:
1. Verify DIRECTUS_STATIC_URL and token values in .env and Worker secrets
2. Re-run `npm run setup:directus`
3. In the browser devtools Network tab, confirm WebSocket to `/socket` after login
4. Check server logs or Worker logs for Directus errors

NOTES:
- Runtime auth is token-based (/api/auth/login), then the socket sends that token on join
- Websocket writes are minibatched on a timer with dirty-bit tracking
- Node server: document data in Directus `vimflowy_data`; Cloudflare Worker: R2 under `vimflowy/...`
