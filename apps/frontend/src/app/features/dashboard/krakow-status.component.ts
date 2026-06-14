import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { WeatherService } from './weather.service';

@Component({
  selector: 'app-krakow-status',
  standalone: true,
  template: `
    <section class="lo-card relative overflow-hidden p-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 class="text-xs font-bold tracking-[0.2em] text-slate-400">CURRENT STATUS: KRAKÓW</h2>
          <div class="mt-1 font-mono text-5xl font-semibold tabular-nums tracking-tight">{{ time() }}</div>
          <div class="text-sm capitalize text-slate-400">{{ date() }}</div>
        </div>

        <div class="flex items-center gap-3">
          <!-- Flat weather icon -->
          <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">
            @switch (weather.kind()) {
              @case ('sun') {
                <circle cx="32" cy="32" r="13" fill="#f5c542" />
                <g stroke="#f5c542" stroke-width="4" stroke-linecap="round">
                  <line x1="32" y1="6" x2="32" y2="14" /><line x1="32" y1="50" x2="32" y2="58" />
                  <line x1="6" y1="32" x2="14" y2="32" /><line x1="50" y1="32" x2="58" y2="32" />
                  <line x1="13" y1="13" x2="19" y2="19" /><line x1="45" y1="45" x2="51" y2="51" />
                  <line x1="51" y1="13" x2="45" y2="19" /><line x1="19" y1="45" x2="13" y2="51" />
                </g>
              }
              @case ('cloud') {
                <circle cx="32" cy="22" r="11" fill="#f5c542" />
                <path d="M18 44 a12 12 0 0 1 6-22 a14 14 0 0 1 26 4 a10 10 0 0 1 2 18 Z" fill="#cbd5e1" />
              }
              @case ('rain') {
                <path d="M18 38 a12 12 0 0 1 6-22 a14 14 0 0 1 26 4 a10 10 0 0 1 2 18 Z" fill="#94a3b8" />
                <g stroke="#60a5fa" stroke-width="4" stroke-linecap="round">
                  <line x1="24" y1="46" x2="21" y2="54" /><line x1="34" y1="46" x2="31" y2="54" /><line x1="44" y1="46" x2="41" y2="54" />
                </g>
              }
              @case ('snow') {
                <path d="M18 38 a12 12 0 0 1 6-22 a14 14 0 0 1 26 4 a10 10 0 0 1 2 18 Z" fill="#cbd5e1" />
                <g fill="#e2e8f0"><circle cx="24" cy="50" r="3" /><circle cx="34" cy="54" r="3" /><circle cx="44" cy="50" r="3" /></g>
              }
              @case ('storm') {
                <path d="M18 36 a12 12 0 0 1 6-22 a14 14 0 0 1 26 4 a10 10 0 0 1 2 18 Z" fill="#94a3b8" />
                <polygon points="32,42 26,54 32,54 28,62 40,48 33,48 38,42" fill="#f5c542" />
              }
            }
          </svg>
          <div class="text-right">
            <div class="text-4xl font-semibold tabular-nums">
              {{ weather.temperature() !== null ? weather.temperature() + '°' : '—' }}
            </div>
            <div class="text-xs uppercase tracking-wide text-slate-500">{{ weather.kind() }}</div>
          </div>
        </div>
      </div>

      <!-- Wawel skyline silhouette -->
      <svg class="mt-4 h-10 w-full text-slate-700" viewBox="0 0 400 48" preserveAspectRatio="xMidYMax meet" fill="currentColor" aria-hidden="true">
        <rect x="0" y="40" width="400" height="8" />
        <!-- wall -->
        <rect x="40" y="30" width="320" height="12" />
        <!-- towers (rect body + conical roof) -->
        <g>
          <rect x="70" y="16" width="20" height="26" /><polygon points="68,16 80,2 92,16" />
          <rect x="150" y="10" width="24" height="32" /><polygon points="148,10 162,-4 176,10" />
          <rect x="230" y="18" width="18" height="24" /><polygon points="228,18 239,4 250,18" />
          <rect x="300" y="22" width="16" height="20" /><polygon points="298,22 308,8 318,22" />
        </g>
      </svg>
    </section>
  `,
})
export class KrakowStatusComponent implements OnInit, OnDestroy {
  weather = inject(WeatherService);
  private now = signal(new Date());
  private timer?: ReturnType<typeof setInterval>;

  time = computed(() =>
    this.now().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );
  date = computed(() =>
    this.now().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }),
  );

  ngOnInit(): void {
    this.weather.load();
    this.timer = setInterval(() => this.now.set(new Date()), 1000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
