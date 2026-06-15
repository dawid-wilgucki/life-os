import type { SessionPayload } from './lib/jwt';

/** Worker bindings: KV + non-secret vars + secrets (see .dev.vars.example). */
export interface Env {
  // Bindings
  TOKENS: KVNamespace;

  // Vars
  FRONTEND_ORIGIN: string;

  // Secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  /** Google AI Studio key — used for meal-plan and wardrobe suggestion endpoints. */
  GEMINI_API_KEY?: string;
  /** Google Calendar IDs for shared parent calendars (optional). */
  PARENT_MOM_CALENDAR_ID?: string;
  PARENT_DAD_CALENDAR_ID?: string;
}

/** Per-request values set by middleware and read by route handlers. */
export interface Variables {
  session: SessionPayload;
}

/** Convenience generic for `new Hono<AppContext>()` and middleware factories. */
export type AppContext = { Bindings: Env; Variables: Variables };
