# Life.OS

Personal life-management system for a single user. Tasks, calendar, a GTD
inbox, investments, wardrobe, trips, home maintenance and habit tracking —
unified on Cloudflare's edge.

> Private, single-owner tool. Not multi-tenant. Google Calendar & Google Tasks
> are the source of truth for events and tasks; Supabase holds everything that
> has no Google home; Telegram is the notification channel.

## Stack

| Layer         | Tech                                                          |
| ------------- | ------------------------------------------------------------ |
| Frontend      | Angular 18 (standalone + signals), Tailwind → Cloudflare Pages |
| Backend       | Cloudflare Worker + Hono (TypeScript) → Cloudflare Workers     |
| Database      | Supabase (PostgreSQL) via `@supabase/supabase-js`            |
| Auth          | Google OAuth 2.0 (single account)                            |
| Notifications | Telegram Bot                                                 |

## Monorepo layout

```
life-os/
├── apps/
│   ├── frontend/        # Angular app  → Cloudflare Pages
│   └── api/             # Cloudflare Worker (Hono) → Cloudflare Workers
│       ├── src/
│       │   ├── routes/  # auth, tasks, calendar, inbox, investments,
│       │   │            #   wardrobe, trips, maintenance, habits, telegram
│       │   ├── cron/    # scheduled maintenance + habit reminders
│       │   ├── lib/     # google, supabase, jwt, telegram
│       │   └── middleware/
│       └── migrations/  # Supabase SQL (0001..0007)
└── packages/
    └── shared-types/    # shared TypeScript interfaces (frontend + api)
```

npm **workspaces** wire the three packages together.

---

## 1. Prerequisites

- Node.js ≥ 20
- A [Cloudflare](https://dash.cloudflare.com) account (Workers + Pages, free tier)
- A [Supabase](https://supabase.com) project (free tier)
- A Google Cloud project with OAuth credentials
- A Telegram bot token + your chat id

## 2. Install

```bash
npm install
```

## 3. Configure secrets (local)

The Worker reads local secrets from `apps/api/.dev.vars` (gitignored).

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
# then edit apps/api/.dev.vars with real values
```

| Variable                    | Notes                                                        |
| --------------------------- | ----------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`          | OAuth client id                                             |
| `GOOGLE_CLIENT_SECRET`      | OAuth client secret                                        |
| `GOOGLE_REDIRECT_URI`       | `http://localhost:8787/auth/google/callback` for local dev |
| `SUPABASE_URL`              | `https://<ref>.supabase.co`                                |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (Worker only — bypasses RLS)              |
| `JWT_SECRET`                | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TELEGRAM_BOT_TOKEN`        | from @BotFather                                            |
| `TELEGRAM_CHAT_ID`          | your numeric chat id                                       |

Non-secret vars (`FRONTEND_ORIGIN`) live in `apps/api/wrangler.toml`.

### Google Cloud OAuth setup

1. APIs & Services → enable **Tasks API, Calendar API, Drive API, Gmail API**.
2. Credentials → **OAuth client ID** → *Web application*.
3. Authorized redirect URIs:
   - `http://localhost:8787/auth/google/callback` (dev)
   - `https://<your-worker>.workers.dev/auth/google/callback` (prod)
4. OAuth consent screen → add yourself as a **test user** (or publish).
   Scopes used: `tasks`, `calendar`, `drive` (full — the wardrobe JSON is
   edited in place, so `drive.file`/`drive.readonly` aren't enough),
   `gmail.readonly`, `openid email profile`.

## 4. Database migrations

Apply the SQL in `apps/api/migrations/` in order (0001 → 0007) via the Supabase
SQL editor or CLI. See [`apps/api/migrations/README.md`](apps/api/migrations/README.md).
RLS is enabled on every table with no policies, so only the Worker's
service-role key can read/write.

## 5. Run locally

```bash
# Worker API on http://localhost:8787
npm run dev:api

# Angular app on http://localhost:4200
npm run dev:web
```

Open <http://localhost:4200>, click **Sign in with Google**, approve consent.
The Worker stores your `refresh_token` in Supabase, caches the `access_token`
in KV, and redirects back with a session JWT (URL fragment) that the SPA keeps
in `localStorage` and sends as `Authorization: Bearer` on every API call.

---

## 6. Deploy

### Worker (apps/api)

```bash
# one-time: create the KV namespace and paste the id into wrangler.toml
npx wrangler kv namespace create TOKENS

# set production secrets (repeat per variable)
cd apps/api
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI      # the prod callback URL
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put JWT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

# update FRONTEND_ORIGIN in wrangler.toml to your Pages URL, then:
npm run deploy:api
```

The cron triggers in `wrangler.toml` (`0 6`, `0 19`, `0 20` UTC) drive the
maintenance and habit reminders — no extra setup.

### Frontend (apps/frontend → Cloudflare Pages)

1. Set `apiBase` in `src/environments/environment.prod.ts` to your Worker URL.
2. Cloudflare Pages → connect the GitHub repo with:
   - **Build command:** `npm run build:web`
   - **Build output directory:** `apps/frontend/dist/frontend/browser`
   - **Root directory:** repository root (workspaces install everything)
3. After the first deploy, set the Worker's `FRONTEND_ORIGIN` (CORS) and Google
   redirect URI to the Pages URL, then redeploy the Worker.

### Telegram webhook (inbound `/inbox`)

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-worker>.workers.dev/api/telegram/webhook"
```

Then send `/inbox buy milk` to the bot — it lands in your Life.OS inbox.

---

## 7. Free-tier notes

- Supabase 500 MB DB, Cloudflare Workers 100K req/day — comfortable for one user.
- Wardrobe images stream through the Worker and are cached via the Cache API.
- Calendar/Tasks reads are live (Google is source of truth); a Supabase cache +
  Calendar `events.watch` push are left as optional future work.

## 8. Security

- `.env` and `apps/api/.dev.vars` are gitignored — **never commit secrets**.
- The Supabase **service-role key** bypasses RLS and lives only in the Worker.
- Rotate any secret that has been shared or committed by accident.

## API reference (summary)

```
GET    /health
GET    /auth/google · /auth/google/callback · /auth/status
GET    /api/tasks/lists · GET/POST /api/tasks/lists/:id
PATCH/DELETE /api/tasks/lists/:id/:taskId
GET/POST /api/calendar/events · PATCH/DELETE /api/calendar/events/:id
POST   /api/calendar/webhook
GET/POST /api/inbox · PATCH /api/inbox/:id
POST   /api/telegram/webhook
GET    /api/investments/gold · /api/investments/gem
GET    /api/wardrobe · GET /api/wardrobe/photo/:name
GET/POST /api/trips · POST /api/trips/import-email
GET/POST /api/maintenance · PATCH /api/maintenance/:id
GET/POST /api/habits · POST/DELETE /api/habits/:id/check
```

All `/api/*` routes (except the two webhooks) require `Authorization: Bearer <jwt>`.
