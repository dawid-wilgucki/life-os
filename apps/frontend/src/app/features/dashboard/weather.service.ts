import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm';

// Kraków, Poland.
const LAT = 50.0614;
const LON = 19.9366;
const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,weather_code&timezone=Europe%2FWarsaw`;

interface OpenMeteo {
  current?: { temperature_2m?: number; weather_code?: number };
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

  load(): void {
    this.http.get<OpenMeteo>(URL).subscribe({
      next: (r) => {
        if (r.current?.temperature_2m != null) this.temperature.set(Math.round(r.current.temperature_2m));
        if (r.current?.weather_code != null) this.kind.set(kindFromCode(r.current.weather_code));
      },
      error: () => {
        /* offline / rate-limited — leave defaults */
      },
    });
  }
}
