import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import type { WeatherKind } from './weather.service';
import type { GeocodingResult } from './weather.service';
import { WeatherService } from './weather.service';
import { SolarService } from './solar.service';

const WEATHER_EMOJI: Record<WeatherKind, string> = {
  sun: '☀️',
  cloud: '⛅',
  rain: '🌧️',
  snow: '❄️',
  storm: '⛈️',
};

const WEATHER_LABEL: Record<WeatherKind, string> = {
  sun: 'Słonecznie',
  cloud: 'Pochmurno',
  rain: 'Deszcz',
  snow: 'Śnieg',
  storm: 'Burza',
};

const SOLAR_REFRESH_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-krakow-status',
  standalone: true,
  template: `
    <section class="lo-card relative overflow-hidden p-5">
      <!-- Top row: location/date + weather + inverter status -->
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="flex items-center gap-1.5 text-lg font-semibold text-slate-200">
            <span>📍</span>
            @if (!showSearch()) {
              <span>{{ weather.locationLabel() }}</span>
              <button
                class="ml-1 text-sm text-slate-500 transition hover:text-slate-300"
                title="Zmień lokalizację"
                (click)="showSearch.set(true)"
              >🔍</button>
            } @else {
              <div class="relative">
                <input
                  class="lo-input w-44 text-sm"
                  placeholder="Szukaj miasta…"
                  [value]="searchQuery()"
                  (input)="onSearchInput($event)"
                  (blur)="onSearchBlur()"
                  autofocus
                />
                @if (searchResults().length) {
                  <ul class="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-xl">
                    @for (r of searchResults(); track r.latitude + ',' + r.longitude) {
                      <li>
                        <button
                          class="w-full px-3 py-2 text-left text-sm transition hover:bg-surface-800"
                          (mousedown)="selectLocation(r)"
                        >
                          <span class="font-medium text-slate-200">{{ r.name }}</span>
                          @if (r.admin1) {
                            <span class="text-slate-500">, {{ r.admin1 }}</span>
                          }
                          <span class="text-slate-500">, {{ r.country }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </h2>
          <div class="text-sm capitalize text-slate-400">{{ dateLabel() }}</div>
        </div>

        <div class="text-right">
          <div class="flex items-center justify-end gap-2">
            <span class="text-2xl leading-none">{{ emoji() }}</span>
            <span class="text-3xl font-semibold tabular-nums text-slate-100">
              {{ weather.temperature() !== null ? weather.temperature() + '°C' : '—' }}
            </span>
          </div>
          <div class="mt-0.5 flex items-center justify-end gap-3 text-sm">
            <span class="text-slate-400">{{ label() }}</span>
            @if (solar.status() !== 'unknown') {
              <span class="font-medium" [class]="statusClass()">{{ statusDot() }} {{ statusLabel() }}</span>
            }
          </div>
        </div>
      </div>

      <!-- Stats line: sun times + PV power/energy -->
      <div class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
        @if (weather.sunrise()) {
          <span>🌅 Wschód {{ timeOf(weather.sunrise()) }}</span>
        }
        @if (weather.sunset()) {
          <span>🌇 Zachód {{ timeOf(weather.sunset()) }}</span>
        }
        @if (solar.status() !== 'unknown') {
          <span class="font-semibold text-amber-300">
            ⚡ <span class="font-normal text-slate-400">Moc teraz:</span> {{ powerLabel() }}
          </span>
          <span>📅 <span class="text-slate-500">Produkcja dziś:</span> {{ energyTodayLabel() }}</span>
          @if (solar.energyTotal() !== null) {
            <span>📊 <span class="text-slate-500">Łącznie:</span> {{ energyTotalLabel() }}</span>
          }
          @if (solar.temperature() !== null) {
            <span>🌡️ <span class="text-slate-500">Inwerter:</span> {{ temperatureLabel() }}</span>
          }
        }
      </div>

      <!-- 4-day forecast + token refresh -->
      @if (weather.forecast().length) {
        <div class="mt-4 border-t border-surface-800 pt-4">
          <div class="grid grid-cols-4 gap-2 text-center">
            @for (day of weather.forecast(); track day.date) {
              <div class="flex flex-col items-center gap-1">
                <div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {{ weekdayOf(day.date) }}
                </div>
                <div class="text-2xl leading-none">{{ emojiOf(day.kind) }}</div>
                <div class="text-xs tabular-nums">
                  <span class="text-slate-200">{{ day.tempMax }}°</span>
                  <span class="text-slate-500">/ {{ day.tempMin }}°</span>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <div class="mt-3 flex justify-end">
        <button
          class="lo-btn-ghost text-xs"
          [disabled]="solar.tokenRefreshing()"
          (click)="solar.refreshToken()"
        >
          {{ solar.tokenRefreshing() ? '⏳ Odświeżanie…' : '🔄 Odśwież token' }}
        </button>
      </div>
    </section>
  `,
})
export class KrakowStatusComponent implements OnInit, OnDestroy {
  weather = inject(WeatherService);
  solar = inject(SolarService);

  showSearch = signal(false);
  searchQuery = signal('');
  searchResults = signal<GeocodingResult[]>([]);

  private now = signal(new Date());
  private solarTimer?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;

  dateLabel = computed(() =>
    this.now().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }),
  );
  emoji = computed(() => WEATHER_EMOJI[this.weather.kind()]);
  label = computed(() => WEATHER_LABEL[this.weather.kind()]);

  powerLabel = computed(() => {
    const p = this.solar.powerNow();
    return p !== null ? `${p.toLocaleString('pl-PL')} W` : '— W';
  });
  energyTodayLabel = computed(() => {
    const e = this.solar.energyToday();
    return e !== null ? `${e} kWh` : '— kWh';
  });
  energyTotalLabel = computed(() => {
    const e = this.solar.energyTotal();
    return e !== null ? `${e.toLocaleString('pl-PL')} kWh` : '— kWh';
  });
  temperatureLabel = computed(() => {
    const t = this.solar.temperature();
    return t !== null ? `${t} °C` : '— °C';
  });

  statusDot = computed(() => {
    switch (this.solar.status()) {
      case 'online': return '🟢';
      case 'alarm': return '🟡';
      case 'offline': return '🔴';
      default: return '⚪';
    }
  });
  statusLabel = computed(() => {
    switch (this.solar.status()) {
      case 'online': return 'Online';
      case 'alarm': return 'Alarm';
      case 'offline': return 'Offline';
      default: return 'Unknown';
    }
  });
  statusClass = computed(() => {
    switch (this.solar.status()) {
      case 'online': return 'text-emerald-400';
      case 'alarm': return 'text-amber-400';
      case 'offline': return 'text-red-400';
      default: return 'text-slate-500';
    }
  });

  ngOnInit(): void {
    this.weather.load();
    this.solar.load();
    this.solarTimer = setInterval(() => this.solar.load(), SOLAR_REFRESH_MS);

    // Silently update location if geolocation is already granted.
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.weather.saveLocation(pos.coords.latitude, pos.coords.longitude, 'Moja lokalizacja');
        },
        () => { /* denied — use saved location or default Bircza */ },
        { timeout: 8000 },
      );
    }
  }

  ngOnDestroy(): void {
    if (this.solarTimer) clearInterval(this.solarTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  onSearchInput(event: Event): void {
    const q = (event.target as HTMLInputElement).value;
    this.searchQuery.set(q);
    clearTimeout(this.searchTimer);
    if (!q.trim()) { this.searchResults.set([]); return; }
    this.searchTimer = setTimeout(() => {
      this.weather.search(q).subscribe((results) => this.searchResults.set(results));
    }, 400);
  }

  onSearchBlur(): void {
    // Short delay so mousedown on a result fires before blur clears the list.
    setTimeout(() => {
      this.showSearch.set(false);
      this.searchResults.set([]);
      this.searchQuery.set('');
    }, 200);
  }

  selectLocation(r: GeocodingResult): void {
    const label = r.admin1 ? `${r.name}, ${r.admin1}` : r.name;
    this.weather.saveLocation(r.latitude, r.longitude, label);
    this.showSearch.set(false);
    this.searchResults.set([]);
    this.searchQuery.set('');
  }

  emojiOf(kind: WeatherKind): string {
    return WEATHER_EMOJI[kind];
  }

  /** "2026-06-19T04:52" → "04:52" (Open-Meteo returns local time). */
  timeOf(iso: string | null): string {
    return iso ? iso.slice(11, 16) : '—';
  }

  /** ISO date → short Polish weekday, e.g. "czw". */
  weekdayOf(date: string): string {
    return new Date(date).toLocaleDateString('pl-PL', { weekday: 'short' });
  }
}
