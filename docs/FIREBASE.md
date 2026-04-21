# Firebase backend (Realtime Database)

Vimflowy’s optional **Firebase** mode stores document key/value data in **Firebase Realtime Database** and signs in with **Firebase Authentication** (email/password). The implementation lives in `src/assets/ts/data_backend/index.ts` (`FirebaseBackend`).

## What this codebase uses (be precise when provisioning Firebase)

| Concern | What Vimflowy expects |
|--------|------------------------|
| Database | **Realtime Database**, not Cloud Firestore. The client calls `firebase.database().ref(...).set/once`. |
| SDK | **Firebase JS SDK v8** (`import firebase from 'firebase'`) — the “namespaced” compat style. |
| Database URL | Code builds `https://<Firebase ID>.firebaseio.com`. New Firebase projects often show a URL like `https://<project-id>-default-rtdb.<region>.firebasedatabase.app`. If login works but reads/writes fail, compare your Realtime Database URL in the Firebase console; if it does not match `https://<id>.firebaseio.com`, you may need a small code change to use your actual `databaseURL` (Firebase console → Realtime Database → copy URL). |
| Auth | **Email / password** provider enabled; create a user under Authentication → Users. |

## Modern Firebase practices (recommended alongside this app)

These are **Google’s current best practices** for web apps using Firebase. This repo has not been migrated to the modular SDK yet; treat the bullets below as **how to run Firebase safely** until a future SDK upgrade.

1. **Lock down Realtime Database rules**  
   Start from “deny all”, then allow only what you need. The app reads/writes arbitrary keys under the authenticated session; rules must require `auth != null` at minimum. For a **single trusted user** or small team, many deployments use one Firebase Auth user and restrict writes to that project only. **Multi-tenant isolation** by `auth.uid` would require the app to store data under paths that include the UID (not how keys are laid out today), so treat shared-database + broad rules as **high risk**.

2. **Prefer App Check**  
   Enable [Firebase App Check](https://firebase.google.com/docs/app-check) for the web app (reCAPTCHA v3 or similar) to reduce abuse of your API keys and database endpoint.

3. **Enable MFA for human accounts**  
   In Google Cloud / Firebase, require multi-factor authentication for console access and use strong passwords on Auth users used by Vimflowy.

4. **Billing alerts and quotas**  
   Set budget alerts on the GCP project so unexpected traffic does not surprise you.

5. **Backups**  
   Use Firebase’s export/backup options or periodic JSON exports from Vimflowy’s export feature.

6. **SDK migration (future work)**  
   Google recommends the **modular v9+** API (`import { getDatabase, ref, set } from 'firebase/database'`). Migrating would mean swapping `FirebaseBackend` to the compat or modular packages and retesting Realtime paths. Until then, staying on v8 is acceptable if dependencies are pinned and rules are strict.

## Configuration in Vimflowy

1. Firebase console: create a project, enable **Realtime Database**, enable **Email/Password** sign-in.
2. Note **Project ID** (used as “Firebase ID” in settings) and **Web API key** (Project settings → Your apps).
3. In Vimflowy: **Settings → Data → Firebase** — enter Firebase ID, API key, user email, and password; save and reload.

## Firebase vs other backends in this repo

- **Firebase** ≠ **PostgreSQL**. If you want SQL, use **Directus** (which typically sits on PostgreSQL) with the **socket server** or **Cloudflare Worker** path — see `docs/BACKENDS.md` and `docs/CLOUDFLARE.md`.
- The **hosted Cloudflare** build is designed for **Directus + R2 + Worker WebSockets**, not Firebase. Using Firebase there is possible only if the UI is built **without** forced `socketserver` mode and you select Firebase in settings (not the recommended layout for that deployment).
