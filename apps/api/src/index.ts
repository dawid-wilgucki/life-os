import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext, Env } from './types';
import { authRouter } from './routes/auth';
import { tasksRouter } from './routes/tasks';
import { calendarRouter } from './routes/calendar';
import { inboxRouter } from './routes/inbox';
import { telegramRouter } from './routes/telegram';
import { investmentsRouter } from './routes/investments';
import { wardrobeRouter } from './routes/wardrobe';
import { tripsRouter } from './routes/trips';
import { maintenanceRouter } from './routes/maintenance';
import { habitsRouter } from './routes/habits';
import { subscriptionsRouter } from './routes/subscriptions';
import { listsRouter } from './routes/lists';
import { mealPlanRouter } from './routes/meal-plan';
import { solarRouter } from './routes/solar';
import { weatherRouter } from './routes/weather';
import { dayPlanRouter } from './routes/day-plan';
import { handleScheduled } from './cron';

const app = new Hono<AppContext>();

// --- CORS: allow the configured Pages origin (+ localhost dev) with creds ---
app.use('*', (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = new Set([c.env.FRONTEND_ORIGIN, 'http://localhost:4200']);
      return allowed.has(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  })(c, next),
);

// --- Liveness ---
app.get('/health', (c) => c.json({ ok: true, service: 'life-os-api' }));

// --- Auth (Google OAuth) ---
app.route('/auth', authRouter);

// --- API modules ---
app.route('/api/tasks', tasksRouter);
app.route('/api/calendar', calendarRouter);
app.route('/api/inbox', inboxRouter);
app.route('/api/telegram', telegramRouter);
app.route('/api/investments', investmentsRouter);
app.route('/api/wardrobe', wardrobeRouter);
app.route('/api/trips', tripsRouter);
app.route('/api/maintenance', maintenanceRouter);
app.route('/api/habits', habitsRouter);
app.route('/api/subscriptions', subscriptionsRouter);
app.route('/api/lists', listsRouter);
app.route('/api/meal-plan', mealPlanRouter);
app.route('/api/solar', solarRouter);
app.route('/api/weather', weatherRouter);
app.route('/api/day-plan', dayPlanRouter);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error('unhandled error', err);
  return c.json({ error: 'internal_error' }, 500);
});

const handler: ExportedHandler<Env> = {
  fetch: (req, env, ctx) => app.fetch(req, env, ctx),
  scheduled: async (controller, env, ctx) => {
    ctx.waitUntil(handleScheduled(controller.cron, env));
  },
};

export default handler;
