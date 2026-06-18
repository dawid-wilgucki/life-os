import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm';

export interface DayForecast {
  /** ISO date, e.g. "2026-06-19". */
  date: string;
  kind: WeatherKind;
  tempMax: number;
  tempMin: number;
}

// Bircza, Poland (PV installation location).
const LAT = 49.701879;
const LON = 22.414214;
const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,weather_code` +
  `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=5` +
  `&timezone=Europe%2FWarsaw`;

interface OpenMeteo {
  current?: { temperature_2m?: number; weather_code?: number };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
}

function kindFromCode(code: number): WeatherKind {
  if (code >= 95) return 'storm';
  if (code >= 71 && code <= 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 2) return 'cloud';
  return 'sun';
}

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private http = inject(HttpClient);

  readonly temperature = signal<number | null>(null);
  readonly kind = signal<WeatherKind>('sun');
  /** 4-day outlook (tomorrow onward). */
  readonly forecast = signal<DayForecast[]>([]);
  /** Today's sunrise/sunset, ISO strings (local Europe/Warsaw). */
  readonly sunrise = signal<string | null>(null);
  readonly sunset = signal<string | null>(null);

  load(): void {
    this.http.get<OpenMeteo>(URL).subscribe({
      next: (r) => {
        if (r.current?.temperature_2m != null) this.temperature.set(Math.round(r.current.temperature_2m));
        if (r.current?.weather_code != null) this.kind.set(kindFromCode(r.current.weather_code));

        const d = r.daily;
        if (d?.time?.length) {
          // Day 0 = today: take its sunrise/sunset.
          this.sunrise.set(d.sunrise?.[0] ?? null);
          this.sunset.set(d.sunset?.[0] ?? null);

          // Days 1-4 = next four days.
          const out: DayForecast[] = [];
          for (let i = 1; i < d.time.length && out.length < 4; i++) {
            out.push({
              date: d.time[i],
              kind: kindFromCode(d.weather_code?.[i] ?? 0),
              tempMax: Math.round(d.temperature_2m_max?.[i] ?? 0),
              tempMin: Math.round(d.temperature_2m_min?.[i] ?? 0),
            });
          }
          this.forecast.set(out);
        }
      },
      error: () => {
        /* offline / rate-limited — leave defaults */
      },
    });
  }
}
