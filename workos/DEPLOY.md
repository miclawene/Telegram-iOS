# Deploying Work OS — Vercel (web) + Railway (api, worker, Postgres, Redis)

Goal: open a Vercel link, sign in, connect Telegram, use the client.

Two things must be live for that: the **web app** on Vercel and the **backend**
(api + telegram-worker + Postgres + Redis) on Railway. The Vercel link alone
works in **demo mode** only; sign-in and Telegram need the backend.

Order: Railway first (you need the API URL for Vercel).

---

## 1. Railway — Postgres + Redis + api + worker

1. Create a new Railway project. Add **PostgreSQL** and **Redis** from the
   database templates. Railway exposes `DATABASE_URL` and `REDIS_URL`.
2. Add a service from this GitHub repo → name it **api**:
   - Root Directory: `workos`
   - Build Command: `pnpm install --frozen-lockfile && pnpm --filter @workos/api... build`
   - Start Command: `pnpm --filter @workos/api start`
   - Generate a public domain → this is your `API_URL` (e.g. `https://api-xxxx.up.railway.app`).
3. Add a second service from the same repo → name it **telegram-worker**:
   - Root Directory: `workos`
   - Build Command: `pnpm install --frozen-lockfile && pnpm --filter @workos/telegram-worker... build`
   - Start Command: `pnpm --filter @workos/telegram-worker start`
   - No public domain needed. Use its **private** hostname for `WORKER_URL`
     (Railway private networking: `http://telegram-worker.railway.internal:4100`).

### Variables

Generate secrets once (same values in both services):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SESSION_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # API_INTERNAL_SECRET
```

**api** service:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | reference the Postgres service |
| `REDIS_URL` | reference the Redis service |
| `SESSION_ENCRYPTION_KEY` | generated (base64, 32 bytes) |
| `API_INTERNAL_SECRET` | generated |
| `API_PORT` | `4000` |
| `WORKER_URL` | `http://telegram-worker.railway.internal:4100` |
| `WEB_ORIGIN` | your Vercel URL, e.g. `https://workos-xxxx.vercel.app` (set after step 2) |

**telegram-worker** service:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | reference the Postgres service |
| `REDIS_URL` | reference the Redis service |
| `SESSION_ENCRYPTION_KEY` | **same** as api |
| `API_INTERNAL_SECRET` | **same** as api |
| `TELEGRAM_API_ID` | from https://my.telegram.org/apps |
| `TELEGRAM_API_HASH` | from https://my.telegram.org/apps |
| `WORKER_PORT` | `4100` |
| `API_URL` | the api public URL (or `http://api.railway.internal:4000`) |

### Create the tables (once)

From your machine, pointed at the Railway Postgres:

```bash
cd workos
DATABASE_URL='<railway postgres url>' pnpm db:push
```

Check: `https://<api-domain>/health` → `{"status":"ok","database":"ok","redis":"ok"}`.

---

## 2. Vercel — web

1. Vercel → **Add New Project** → import this GitHub repo.
2. Settings:
   - **Root Directory**: `workos/apps/web`
   - Framework: Next.js (auto-detected)
   - Keep **"Include source files outside of the Root Directory"** enabled
     (needed for the pnpm workspace; on by default).
3. Environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<api-domain>` (from Railway, no trailing slash) |
| `NEXT_PUBLIC_WS_URL` | `wss://<api-domain>/ws` |

4. Deploy. Copy the resulting URL and put it into the api's `WEB_ORIGIN`
   on Railway, then redeploy the api (so cookies/CORS accept your domain).

---

## 3. Use it

1. Open the Vercel URL → **Sign in** (top of the project pane or the rail) →
   **Create account**. A first workspace is created automatically.
2. **+ Add** → enter phone → code from Telegram → (2FA if enabled) → search a
   conversation → pick it → project name + channel name → **Create channel**.
3. Open the channel: live Telegram history, send a message, watch it appear in
   normal Telegram.

Without signing in the link still opens the **demo workspace** (offline, no
backend needed).

---

## Why cookies need `WEB_ORIGIN`

The web app (Vercel) and API (Railway) are different sites. The session cookie is
set `SameSite=None; Secure` in production and CORS allows `*.vercel.app` plus
`WEB_ORIGIN`. If sign-in "succeeds" but you stay logged out, `WEB_ORIGIN` is
missing or wrong.
