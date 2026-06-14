# Life.OS

Personal life management system (single-user). Tasks, calendar, GTD inbox,
investments, wardrobe, trips, home maintenance and habit tracking — unified on
Cloudflare's edge.

> Full setup & deploy instructions are added incrementally; see the
> **Development** section below to get the monorepo running locally.

## Stack

| Layer        | Tech                                                        |
| ------------ | ---------------------------------------------------------- |
| Frontend     | Angular 18 (standalone, signals), Tailwind, Cloudflare Pages |
| Backend      | Cloudflare Worker + Hono (TypeScript)                       |
| Database     | Supabase (PostgreSQL) via `@supabase/supabase-js`          |
| Auth         | Google OAuth 2.0 (single account)                          |
| Notifications| Telegram Bot                                               |

## Monorepo layout

```
life-os/
├── apps/
│   ├── frontend/        # Angular app  → Cloudflare Pages
│   └── api/             # Cloudflare Worker (Hono) → Cloudflare Workers
└── packages/
    └── shared-types/    # shared TypeScript interfaces
```

npm **workspaces** wire the three packages together.

## Development

```bash
npm install                 # install all workspaces

# API (Cloudflare Worker)
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in real values
npm run dev:api             # wrangler dev on http://localhost:8787

# Frontend (Angular)
npm run dev:web             # ng serve on http://localhost:4200
```

Never commit secrets — `.dev.vars` and `.env` are gitignored. Use
`wrangler secret put <NAME>` for production.
