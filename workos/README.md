# Telegram Work OS

A PWA that uses **Telegram as the message transport** but presents it as a
project workspace — Workspaces → Projects → Channels → Threads → Tasks — rather
than a flat list of chats. External contacts keep using ordinary Telegram.

This is **not** a Telegram client and **not** a Slack clone. The frontend never
speaks MTProto; all Telegram access is server-side.

```
Telegram ──MTProto──► telegram-worker ──► api ──► PostgreSQL / Redis
                                            └── WebSocket ──► Next.js PWA
```

## Monorepo layout

```
workos/
├── apps/
│   ├── web/               Next.js PWA (Vercel)              — 3-column workspace UI
│   ├── api/               Fastify backend (Railway)         — auth, CRUD, /ws realtime
│   └── telegram-worker/   GramJS user client (Railway)      — Telegram session + updates
├── packages/
│   ├── types/             Shared DTOs, enums, event envelopes, demo fixtures
│   ├── database/          Drizzle schema, client, session encryption, seed
│   ├── telegram/          TelegramClientAdapter interface + GramJS implementation
│   ├── config/            Env validation (zod) + log-redaction paths
│   ├── ui/                Shared UI helpers / tokens
│   ├── tsconfig/          Shared TS configs
│   └── eslint-config/     Shared lint config
└── docker-compose.dev.yml Local Postgres + Redis (dev only)
```

## Phase status

Development follows ТЗ §43. **Phase 1 is implemented**; later phases are
scaffolded with a stable API surface (see `apps/api/src/routes/placeholders.ts`).

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Monorepo, database, auth, workspace/project/channel, demo UI, PWA | ✅ Implemented |
| 2 | Telegram auth, chats, import, message history | 🔜 Scaffolded (adapter + routes 501) |
| 3 | Realtime send, reply, threads | 🔜 Hub + WS live; send pending |
| 4 | Tasks, activity, saved items, files | 🔜 Schema ready; routes 501 |
| 5 | PWA polish, IndexedDB, Railway/Vercel, security review | 🟡 PWA + IndexedDB in place |

## Quick start (local, ~10 minutes)

Prereqs: Node 20+, pnpm 10+, Docker.

```bash
cd workos
cp .env.example .env

# Generate the two secrets the .env needs:
node -e "console.log('SESSION_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('API_INTERNAL_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
# paste both into .env

pnpm install
pnpm dev:infra          # start Postgres + Redis
pnpm db:push            # create tables from the Drizzle schema
pnpm db:seed            # seed the demo workspace (Cityscape)
pnpm dev                # start web + api + worker via turbo
```

- Web: <http://localhost:3000> — the demo workspace works with **no Telegram login**.
- API health: <http://localhost:4000/health>
- Worker health: <http://localhost:4100/health>

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run all apps in watch mode (turbo) |
| `pnpm build` | Build every package and app |
| `pnpm typecheck` | Type-check the whole monorepo |
| `pnpm lint` | Lint the whole monorepo |
| `pnpm db:push` | Push the Drizzle schema to the database |
| `pnpm db:generate` | Generate SQL migration files |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed the demo workspace |
| `pnpm dev:infra` / `:down` | Start / stop local Postgres + Redis |

## Data model

All tables from ТЗ §5–§29 live in `packages/database/src/schema.ts`: users,
sessions, telegram_accounts, workspaces, workspace_members, projects, channels,
telegram_chat_sources, channel_sources, message_metadata, message_cache, tasks,
saved_items, files.

Key rules enforced in code:

- **Telegram sessions are stored only encrypted** (AES-256-GCM, `encryptSession` /
  `decryptSession`, key from `SESSION_ENCRYPTION_KEY`).
- **Selective sync** (ТЗ §11): a Telegram chat only becomes a `telegram_chat_source`
  after the user explicitly adds it — the schema has no “index everything” path.
- **Secrets never logged** (ТЗ §34): pino redaction paths in `packages/config`.

## Deployment (Phase 5)

- **web** → Vercel. Root Directory `workos/apps/web`. Set `NEXT_PUBLIC_API_URL`
  and `NEXT_PUBLIC_WS_URL`.
- **api** → Railway service. Root `workos`, build `pnpm --filter @workos/api build`,
  start `pnpm --filter @workos/api start`. Attach managed Postgres + Redis.
- **telegram-worker** → separate Railway service. Never on Vercel serverless
  (long-running Telegram connection).

Telegram long-running processes only run on Railway. `docker-compose.dev.yml` is
for local development only, never production.

## Security

Follows ТЗ §32: secrets server-side only, Telegram API hash never in the frontend
bundle, encrypted sessions, redacted logs, input validation (zod) on every route,
httpOnly secure cookies (no localStorage auth tokens), env validation on startup.
