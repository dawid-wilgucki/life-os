import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ApiService } from '../../core/api.service';

export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm';

export interface DayForecast {
  /** ISO date, e.g. "2026-06-19". */
  date: string;
  kind: WeatherKind;
  tempMax: number;
  tempMin: number;
}

export interface GeocodingResult {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  admin1?: string;
}

function kindFromCode(code: number): WeatherKind {
  if (code >= 95) return 'storm';
  if (code >= 71 && code <= 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 2) return 'cloud';
  return 'sun';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WeatherApiResponse = { location: { label: string }; current?: any; daily?: any };

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private api = inject(ApiService);

  readonly temperature = signal<number | null>(null);
  readonly kind = signal<WeatherKind>('sun');
  /** 4-day outlook (tomorrow onward). */
  readonly forecast = signal<DayForecast[]>([]);
  /** Today's sunrise/sunset, ISO strings (local Europe/Warsaw). */
  readonly sunrise = signal<string | null>(null);
  readonly sunset = signal<string | null>(null);
  /** Display label of current weather location (e.g. "Bircza" or "Kraków, Małopolskie"). */
  readonly locationLabel = signal<string>('Bircza');

  load(): void {
    this.api.get<WeatherApiResponse>('/api/weather').subscribe({
      next: (r) => {
        if (r.location?.label) this.locationLabel.set(r.location.label);

        const current = r.current;
        if (current?.temperature_2m != null) this.temperature.set(Math.round(current.temperature_2m));
        if (current?.weather_code != null) this.kind.set(kindFromCode(current.weather_code));

        const d = r.daily;
        if (d?.time?.length) {
          this.sunrise.set(d.sunrise?.[0] ?? null);
          this.sunset.set(d.sunset?.[0] ?? null);

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
      error: () => { /* offline / API unavailable — keep defaults */ },
    });
  }

  search(q: string): Observable<GeocodingResult[]> {
    if (!q.trim()) return of([]);
    return this.api.get<GeocodingResult[]>('/api/weather/search', { q });
  }

  saveLocation(latitude: number, longitude: number, label: string): void {
    this.api.post('/api/weather/location', { latitude, longitude, label }).subscribe(() => this.load());
  }
}
