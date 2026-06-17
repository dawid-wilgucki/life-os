import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import type { WeatherKind } from './weather.service';
import { WeatherService } from './weather.service';
import { SolarService } from './solar.service';

const WEATHER_EMOJI: Record<WeatherKind, string> = {
  sun: '☀️',
  cloud: '☁️',
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

const SOLAR_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

@Component({
  selector: 'app-krakow-status',
  standalone: true,
  template: `
    <section class="lo-card relative overflow-hidden p-5">
      <!-- Top row: location + weather + inverter status -->
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-semibold text-slate-200">Kraków</h2>
            <span class="text-2xl leading-none">{{ emoji() }}</span>
          </div>
          <div class="text-sm capitalize text-slate-400">{{ dateLabel() }}</div>
        </div>

        <div class="text-right">
          <div class="flex items-center justify-end gap-2">
            <span class="text-3xl font-semibold tabular-nums text-slate-100">
              {{ weather.temperature() !== null ? weather.temperature() + '°C' : '—' }}
            </span>
            <span class="text-sm text-slate-400">{{ label() }}</span>
          </div>
          <div class="mt-1 text-sm font-medium" [class]="statusClass()">
            {{ statusDot() }} {{ statusLabel() }}
          </div>
        </div>
      </div>

      <!-- PV section (hidden when status is unknown / unavailable) -->
      @if (solar.status() !== 'unknown') {
        <div class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-surface-800 pt-4">
          <div class="text-2xl font-semibold tabular-nums text-amber-300">
            ⚡ {{ powerLabel() }}
          </div>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-400">
            @if (weather.sunrise()) {
              <span>☀️ Wschód {{ timeOf(weather.sunrise()) }}</span>
            }
            @if (weather.sunset()) {
              <span>🌙 Zachód {{ timeOf(weather.sunset()) }}</span>
            }
            <span>📅 {{ energyTodayLabel() }}</span>
          </div>
        </div>
      } @else if (weather.sunrise() || weather.sunset()) {
        <!-- No PV data — still show sun times. -->
        <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-surface-800 pt-4 text-sm text-slate-400">
          @if (weather.sunrise()) {
            <span>☀️ Wschód {{ timeOf(weather.sunrise()) }}</span>
          }
          @if (weather.sunset()) {
            <span>🌙 Zachód {{ timeOf(weather.sunset()) }}</span>
          }
        </div>
      }

      <!-- 4-day forecast strip -->
      @if (weather.forecast().length) {
        <div class="mt-4 grid grid-cols-4 gap-2 border-t border-surface-800 pt-4 text-center">
          @for (day of weather.forecast(); track day.date) {
            <div class="flex flex-col items-center gap-1">
              <div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {{ weekdayOf(day.date) }}
              </div>
              <div class="text-2xl leading-none">{{ emojiOf(day.kind) }}</div>
              <div class="text-xs tabular-nums">
                <span class="text-slate-200">{{ day.tempMax }}°</span>
                <span class="text-slate-500">/{{ day.tempMin }}°</span>
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class KrakowStatusComponent implements OnInit, OnDestroy {
  weather = inject(WeatherService);
  solar = inject(SolarService);

  private now = signal(new Date());
  private solarTimer?: ReturnType<typeof setInterval>;

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

  statusDot = computed(() => {
    switch (this.solar.status()) {
      case 'online': return '🟢';
      case 'offline': return '🔴';
      case 'alarm': return '🟡';
      default: return '⚪';
    }
  });
  statusLabel = computed(() => {
    switch (this.solar.status()) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'alarm': return 'Alarm';
      default: return 'Unknown';
    }
  });
  statusClass = computed(() => {
    switch (this.solar.status()) {
      case 'online': return 'text-emerald-400';
      case 'offline': return 'text-red-400';
      case 'alarm': return 'text-amber-400';
      default: return 'text-slate-500';
    }
  });

  ngOnInit(): void {
    this.weather.load();
    this.solar.load();
    this.solarTimer = setInterval(() => this.solar.load(), SOLAR_REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.solarTimer) clearInterval(this.solarTimer);
  }

  emojiOf(kind: WeatherKind): string {
    return WEATHER_EMOJI[kind];
  }

  /** "2026-06-19T04:52" → "04:52" (Open-Meteo returns local Europe/Warsaw time). */
  timeOf(iso: string | null): string {
    return iso ? iso.slice(11, 16) : '—';
  }

  /** ISO date → short Polish weekday, e.g. "czw". */
  weekdayOf(date: string): string {
    return new Date(date).toLocaleDateString('pl-PL', { weekday: 'short' });
  }
}
