# Life.OS

Personal life-management system for a single user. Tasks, calendar, a GTD
inbox, investments, wardrobe, trips, home maintenance, habit tracking and
Shelly smart-home devices (state, energy charts, Telegram alerts) —
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
│       │   ├── cron/    # reminders, job-search fetch, Shelly polling
│       │   ├── shelly/  # Shelly: normalisation, rules, alerts, backfill
│       │   ├── lib/     # google, supabase, jwt, telegram
│       │   └── middleware/
│       └── migrations/  # Supabase SQL (0001..0016)
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
| `SHELLY_AUTH_KEY`           | Shelly app → User settings → Authorization cloud key       |
| `SHELLY_SERVER_URI`         | server shown next to the key, e.g. `https://shelly-270-eu.shelly.cloud` |
| `SHELLY_WEBHOOK_SECRET`     | optional, random string; enables `/hooks/shelly/<secret>`  |

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

Apply the SQL in `apps/api/migrations/` in order (0001 → 0016) via the Supabase
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

The cron triggers in `wrangler.toml` (UTC) drive the scheduled work — no extra
setup. Workers Free allows 5 per account; 4 are used:

| Cron           | Work                                                            |
| -------------- | --------------------------------------------------------------- |
| `0 6`, `0 7`   | maintenance reminders + job-search fetch at 08:00 Warsaw (DST)  |
| `0 8`          | subscription renewal reminders                                  |
| `*/15 * * * *` | Shelly devices: snapshot, alerts, cloud-history backfill        |

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

### Shelly devices (tab „Urządzenia”)

1. Apply migrations `0015_shelly.sql` and `0016_shelly_functions.sql`. They
   seed the pump (`e4b0637ece04`, with a yearly break 01.10–30.04) and the
   garden lights (`d885ac0681e8`, expected on from sunset to sunrise).
2. Set `SHELLY_AUTH_KEY` and `SHELLY_SERVER_URI` (`wrangler secret put …`).
3. Add further devices in the tab („+ Dodaj”, device ID from the Shelly app).
   Model, generation and power metering are detected from the cloud.

How it works:

- Every 15 min one `POST /v2/devices/api/get` call (≤10 devices) stores a
  sample per online device in `shelly_samples`. Energy charts come from
  increments of the device's cumulative counter (`aenergy.total`), so kWh are
  exact regardless of the polling interval; aggregation runs in SQL
  (`shelly_energy_series`, `shelly_activity_series`).
- History before the first own sample is backfilled from the (undocumented)
  `/v2/statistics/power-consumption` endpoint, one month of daily values per
  call, up to 3 years back, a couple of calls per poll.
- Alerts (Telegram, one per episode + „back to normal”): device offline longer
  than its threshold, Shelly Cloud failing 4 polls in a row (or rejecting the
  key), errors reported by the device, mains voltage outside 207–253 V, lights
  on in daylight / off after dusk, scheduled pump run missing, run longer than
  the limit, any activity during a break period. Quiet hours 22:00–07:00:
  alerts are recorded and sent at 07:00 if still active. Thresholds live in
  `shelly_devices` (`offline_after_hours`, `schedule`, `alerts` JSON) and
  `shelly_settings` (quiet hours, API failure threshold).
- Break periods (yearly or one-off, editable in the tab) switch monitoring off
  for a device, except the optional „works during a break” alert.

Optional webhooks (Gen2+ devices, exact start/stop and energy per run): set
`SHELLY_WEBHOOK_SECRET`, then on the device's local web UI → Actions add, for
`switch.on` and `switch.off`:

```
https://<your-worker>.workers.dev/hooks/shelly/<SECRET>?id=<device-id>&ev=on&e=${status["switch:0"].aenergy.total}
https://<your-worker>.workers.dev/hooks/shelly/<SECRET>?id=<device-id>&ev=off&e=${status["switch:0"].aenergy.total}
```

Configuration is one-off; afterwards the device calls the Worker directly.

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
GET    /api/shelly/overview · POST /api/shelly/refresh
GET    /api/shelly/devices/:id/series?range=24h|30d|12m
POST   /api/shelly/devices · PATCH/DELETE /api/shelly/devices/:id
POST   /api/shelly/devices/:id/periods · DELETE /api/shelly/periods/:id
GET    /hooks/shelly/:secret   (device webhooks, secret in path)
```

All `/api/*` routes (except the two webhooks) require `Authorization: Bearer <jwt>`;
`/hooks/shelly/*` is authorised by the secret in the path.
