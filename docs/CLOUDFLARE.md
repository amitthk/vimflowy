# Deploying Vimflowy to Cloudflare Workers

This deployment serves the static UI from **Worker assets**, handles **login** and **WebSockets** on the same hostname, and stores document key/value data in **R2**. User accounts and password hashes live in **Directus** (`vimflowy_users` collection).

## What you are asked for in the browser

### 1. Login page (`/login.html`) — Username and Password

This is **not** “WebSocket server + password”. It is the **Vimflowy account** stored in Directus.

- Default seeded user: **`admin`**
- Password: whatever you set as **`ADMIN_PASSWORD`** when you ran the Directus setup script (see below).  
  If you never changed it, the script defaults to `admin123`.

The Worker does **not** read `ADMIN_PASSWORD` from an `.env` file. That variable is only used **on the machine that runs** `npm run setup:directus` (or `node scripts/setup-directus.mjs`) to **write the password hash into Directus**. After that, only Directus stores the hash.

### 2. Settings → “Vimflowy server” → Server / Password

You should **not** need this screen for the official Cloudflare build.

- If the static bundle was built **with** `REACT_APP_SERVER_CONFIG={"socketserver":true}` (see `npm run build:cloudflare`), the app **forces** the socket backend and **derives** the WebSocket URL from the page (`https://` → `wss://` on the same host). The Data settings panel then explains that backups are server-side.
- If you still see manual “Server / Password” fields, the UI was built **without** that flag (old `npm run build` only). Use `npm run deploy:cloudflare`, which runs `build:cloudflare` first.

The **Password** field under “Vimflowy server” is **legacy**; the socket joins with the **HTTP login token**, not that field. You can leave it blank.

## WebSockets on the public internet

- **`ws://localhost`** only works from your own machine to a local server. Visitors to your public `https://vimflowy.example.com` site cannot reach your laptop’s localhost.
- For HTTPS sites, the browser uses **`wss://`** to the **same host** (e.g. `wss://vimflowy.example.com/socket`). The Worker implements `/socket`; that is the supported production setup.

## One-time: Directus schema and admin password

On any host with Node and network access to Directus:

1. Copy `.env.example` → `.env` and set at least:
   - `DIRECTUS_STATIC_URL` — your Directus base URL  
   - `DIRECTUS_ADMIN_TOKEN` — admin/static token for schema API  
   - `DIRECTUS_STATIC_TOKEN` — runtime token the Worker uses (same value must be configured as a Worker secret)  
   - `ADMIN_PASSWORD` — **choose a strong password** for the seeded `admin` user  
2. Run:

```bash
npm run setup:directus
```

The script loads **`.env` from the repo root** (via `dotenv/config`). This creates collections (including `vimflowy_users`) and upserts the `admin` user with a SHA-256 hash of `ADMIN_PASSWORD`. The script does **not** print your password.

## Checklist: change the `admin` password in production

Use this when the `admin` account already exists and you want a **new** password (same procedure as a “rerun setup” for auth).

1. **Pick a new password** (password manager, long random string).
2. On a machine that can reach **Directus** with your admin token, set in `.env`:
   - `DIRECTUS_STATIC_URL`, `DIRECTUS_ADMIN_TOKEN`, `DIRECTUS_STATIC_TOKEN` (unchanged unless you rotate tokens too)
   - `ADMIN_PASSWORD` = the **new** plaintext password (only used by the script to compute the hash)
3. Run:

   ```bash
   npm run setup:directus
   ```

   The script **PATCHes** the existing `admin` row and updates `password_hash` (SHA-256 hex, same algorithm as `server/auth.ts` and `cloudflare/worker.js`).
4. **Verify login**: open `/login.html`, sign in as `admin` with the new password.
5. **Other browsers / users**: anyone with an old password must use the new one. **Existing Worker sessions** (tokens in KV) stay valid until they expire (`SESSION_TTL_SECONDS`, default 86400 in `cloudflare/worker.js`). Users do not need to re-login immediately for that reason alone, but new logins use the new password. To force everyone to re-auth sooner, you would need operational steps (e.g. shorten TTL in code and redeploy, or clear KV keys — not exposed as a single button here).
6. **Other accounts** (`vimflowy_users` besides `admin`): create or edit in **Directus Admin**; passwords must be stored as **SHA-256 hex of the plaintext** to match the login code, unless you add a separate password tool.

**Rerun full schema setup “from scratch”** (collections + permissions + admin seed): same `npm run setup:directus`. It is idempotent for collections (adds missing fields) and always re-applies the admin password hash from the current `ADMIN_PASSWORD`.

## Cloudflare Worker configuration

`wrangler.toml` is **gitignored** so account-specific values stay out of the repo. Start from the template:

```bash
cp wrangler.toml.example wrangler.toml
```

1. Edit `wrangler.toml`: set `name`, `[vars] DIRECTUS_STATIC_URL`, KV namespace `id`, R2 `bucket_name`, and optional `[[routes]]` for a custom hostname.
2. Set the secret (never commit this):

```bash
npx wrangler secret put DIRECTUS_STATIC_TOKEN
```

Paste the same token as `DIRECTUS_STATIC_TOKEN` in `.env` when running `setup:directus` so permissions and collections match.

3. Ensure **KV** (`SESSION_KV`) and **R2** bindings in your local `wrangler.toml` match resources in your Cloudflare account.

## Deploy the frontend + Worker

From the repo root:

```bash
npm run deploy:cloudflare
```

This runs **`build:cloudflare`**, which sets `REACT_APP_SERVER_CONFIG={"socketserver":true}` so the browser uses **`wss://<your-host>/socket`** and login **`/api/auth/login`** on the Worker.

## Troubleshooting

| Symptom | Check |
|--------|--------|
| Login always fails | Re-run `setup:directus` with the intended `ADMIN_PASSWORD`; confirm Worker `DIRECTUS_STATIC_TOKEN` can read `vimflowy_users` in Directus. |
| App alert **“No user ID found”** after login | Old Worker sessions stored in KV may lack `id` if login did not request `fields=id,...` from Directus. **Redeploy** the Worker (see `cloudflare/worker.js` login query), then **sign out** or clear `localStorage` key `vimflowy_auth_token` and log in again so a new session is created. |
| Socket errors after login | Worker route must expose `/socket`; TLS must be valid on the custom domain. |
| Prompted for manual “Server” in Settings | Rebuild with `npm run build:cloudflare` and redeploy. |
