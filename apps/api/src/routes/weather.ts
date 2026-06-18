import { Hono } from 'hono';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';

const BIRCZA = { latitude: 49.701879, longitude: 22.414214, label: 'Bircza' };
const OM_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEO_BASE = 'https://geocoding-api.open-meteo.com/v1/search';

export const weatherRouter = new Hono<AppContext>();
weatherRouter.use('*', requireAuth);

// GET /api/weather/search?q= — proxy Open-Meteo geocoding for city search
weatherRouter.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json([]);

  const res = await fetch(`${GEO_BASE}?name=${encodeURIComponent(q)}&count=10&language=pl`);
  if (!res.ok) return c.json([]);

  const data = await res.json() as {
    results?: Array<{ name: string; country: string; latitude: number; longitude: number; admin1?: string }>;
  };
  return c.json(
    (data.results ?? []).map((r) => ({
      name: r.name,
      country: r.country,
      latitude: r.latitude,
      longitude: r.longitude,
      admin1: r.admin1,
    })),
  );
});

// POST /api/weather/location — save preferred location to KV
weatherRouter.post('/location', async (c) => {
  const accountId = c.get('session').sub;
  const body = await c.req.json<{ latitude: number; longitude: number; label: string }>();
  if (body.latitude == null || body.longitude == null) {
    return c.json({ error: 'invalid_coords' }, 400);
  }
  await c.env.TOKENS.put(
    `weather_location:${accountId}`,
    JSON.stringify({
      latitude: body.latitude,
      longitude: body.longitude,
      label: body.label ?? 'Moja lokalizacja',
    }),
  );
  return c.json({ ok: true });
});

// GET /api/weather — current weather + 5-day forecast using saved location
weatherRouter.get('/', async (c) => {
  const accountId = c.get('session').sub;
  const stored = await c.env.TOKENS.get(`weather_location:${accountId}`);
  const loc = stored ? (JSON.parse(stored) as typeof BIRCZA) : BIRCZA;

  const url =
    `${OM_BASE}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&current=temperature_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=5` +
    `&timezone=Europe%2FWarsaw`;

  const res = await fetch(url);
  if (!res.ok) return c.json({ error: 'weather_unavailable' }, 502);
  const omData = await res.json();
  return c.json({ location: loc, ...(omData as object) });
});
