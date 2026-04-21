# Data backends in Vimflowy

Vimflowy stores outlines as key/value pairs. The **client** picks where those pairs live; the table below is the practical map for this fork.

| Backend | Where data lives | Typical use |
|--------|-------------------|-------------|
| **HTML5 local storage** | Browser `localStorage` (per origin) | Default offline-first; no account. |
| **IndexedDB** | Browser IndexedDB (per document name) | Heavier local documents. |
| **In-memory** | RAM only | Throwaway testing. |
| **Vimflowy server (socket)** | **Directus** `vimflowy_data` (Node `server/`) **or** **Cloudflare R2** (Worker) | Multi-device sync; requires HTTP login then `wss://…/socket`. |
| **Firebase** | Firebase **Realtime Database** | Optional remote; see `docs/FIREBASE.md`. |

## “Socket” / server mode (recommended for team or multi-device)

Two deployments share the same **client** behavior when `REACT_APP_SERVER_CONFIG` includes `"socketserver": true`:

1. **Node (`server/prod.ts` + `socket_server.ts`)**  
   - TLS/WebSocket server you host.  
   - Persistence: **Directus** collection `vimflowy_data` (and users in `vimflowy_users`) when `DIRECTUS_*` env vars are set.

2. **Cloudflare Worker (`cloudflare/worker.js`)**  
   - Static UI + `/api/auth/login` + `/socket` on one hostname.  
   - Persistence: **R2** objects under `vimflowy/<userId>/…`.  
   - Users still come from **Directus** `vimflowy_users` (login checks password hash there).

Both flows: browser obtains a **session token** from `/api/auth/login`, then the WebSocket `join` message carries that token. The Settings “socket password” field is unused for this path.

## Directus and PostgreSQL

Directus is the **headless CMS / API** layer. It is usually backed by **PostgreSQL** (or MySQL, SQLite, etc.) in your infrastructure. Vimflowy does **not** talk to Postgres directly; it talks to **Directus REST** (Node) or only to Directus for **auth** (Worker). So the “modern SQL” story here is: **PostgreSQL → Directus → Vimflowy**, not raw SQL from the browser.

## Choosing a backend

- **Solo, offline, no server**: local / IndexedDB.  
- **Self-hosted team, you run Node + Directus**: Docker or `startprod` with Directus env.  
- **You want Cloudflare edge + R2**: follow `docs/CLOUDFLARE.md`.  
- **You already standardized on Firebase**: follow `docs/FIREBASE.md` and accept Realtime DB + v8 SDK constraints.
