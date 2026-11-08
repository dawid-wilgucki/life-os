import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Subscription } from 'rxjs';
import type { ShellyActivitySignal, ShellyDevice, ShellyPeriod, ShellyRange, ShellySeries } from '@life-os/shared-types';
import { DevicesService } from './devices.service';
import { BarChartComponent, type BarDatum } from '../../shared/bar-chart.component';

const RANGES: Array<{ id: ShellyRange; label: string }> = [
  { id: '24h', label: '24 h' },
  { id: '30d', label: '30 dni' },
  { id: '12m', label: '12 mies.' },
];

const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const pad = (n: number) => String(n).padStart(2, '0');

function relTime(iso?: string): string {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h temu`;
  return `${Math.round(h / 24)} dni temu`;
}

function periodLabel(p: ShellyPeriod): string {
  if (p.recurring) {
    const f = (md?: string) => (md ? `${md.slice(3, 5)}.${md.slice(0, 2)}` : '?');
    return `co roku ${f(p.startMd)} – ${f(p.endMd)}`;
  }
  const f = (d?: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '?');
  return `${f(p.startsOn)} – ${f(p.endsOn)}`;
}

@Component({
  selector: 'app-device-card',
  standalone: true,
  // Grid items default to min-width:auto — without this the fixed-width SVG
  // would push the card wider than the screen on phones.
  host: { class: 'block min-w-0' },
  imports: [DatePipe, DecimalPipe, FormsModule, BarChartComponent],
  template: `
    @let d = device();
    @let s = d.state;
    <div class="lo-card flex flex-col gap-4 p-4 sm:p-5" [class.opacity-60]="!d.enabled">
      <!-- Header -->
      <div class="flex items-start gap-3">
        <span class="text-3xl leading-none">{{ d.icon }}</span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-lg font-semibold">{{ d.name }}</h2>
            @if (!d.enabled) {
              <span class="rounded-full bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-300">wyłączone z monitoringu</span>
            } @else if (d.activeBreak) {
              <span class="rounded-full bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-300">⏸ przerwa</span>
            }
            <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
                  [class]="s?.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'">
              <span class="h-1.5 w-1.5 rounded-full" [class]="s?.online ? 'bg-emerald-400' : 'bg-red-400'"></span>
              {{ s?.online ? 'online' : 'offline' }}
            </span>
            @if (s?.online) {
              <span class="rounded-full px-2 py-0.5 text-[11px]"
                    [class]="s?.active ? 'bg-sky-500/15 text-sky-300' : 'bg-slate-700/60 text-slate-300'">
                {{ activityLabel() }}
              </span>
            }
          </div>
          <p class="mt-0.5 truncate text-xs text-slate-500">
            {{ d.modelCode || 'model nieznany' }}@if (d.gen) { · Gen{{ d.gen }}} ·
            @if (s?.online) { raport {{ rel(s?.lastReportAt) }} } @else if (s?.offlineSince) { brak kontaktu od {{ s?.offlineSince | date: 'd.MM HH:mm' }} } @else { jeszcze bez odczytu }
          </p>
        </div>
        <button class="lo-btn-ghost px-2 py-1 text-base" (click)="showSettings.set(!showSettings())" [attr.aria-expanded]="showSettings()" title="Ustawienia">⚙</button>
      </div>

      @if (d.activeBreak) {
        <p class="rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-300">
          Okres przerwy{{ d.breakUntil ? ' do ' + (d.breakUntil | date: 'd.MM.yyyy') : '' }}{{ d.activeBreak.note ? ' (' + d.activeBreak.note + ')' : '' }} — alerty wyłączone{{ d.activeBreak.alertOnActivity ? ', poza informacją o pracy urządzenia' : '' }}.
        </p>
      }

      <!-- Current parameters -->
      @if (s?.reading; as r) {
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          @if (d.hasPowerMeter) {
            <div><dt class="text-[11px] text-slate-500">Moc</dt><dd class="font-medium">{{ r.apowerW === null ? '—' : (r.apowerW | number: '1.0-1') }} W</dd></div>
            @if (r.voltageV !== null) {
              <div><dt class="text-[11px] text-slate-500">Napięcie</dt><dd class="font-medium">{{ r.voltageV | number: '1.1-1' }} V</dd></div>
            }
            @if (r.currentA !== null) {
              <div><dt class="text-[11px] text-slate-500">Prąd</dt><dd class="font-medium">{{ r.currentA | number: '1.2-2' }} A</dd></div>
            }
            @if (r.freqHz !== null) {
              <div><dt class="text-[11px] text-slate-500">Częstotliwość</dt><dd class="font-medium">{{ r.freqHz | number: '1.2-2' }} Hz</dd></div>
            }
            @if (r.energyTotalWh !== null) {
              <div><dt class="text-[11px] text-slate-500">Licznik energii</dt><dd class="font-medium">{{ r.energyTotalWh / 1000 | number: '1.2-2' }} kWh</dd></div>
            }
          } @else if (d.nominalPowerW) {
            <div><dt class="text-[11px] text-slate-500">Moc (szacunek)</dt><dd class="font-medium">~{{ r.output ? d.nominalPowerW : 0 }} W</dd></div>
          }
          @if (r.tempC !== null) {
            <div><dt class="text-[11px] text-slate-500">Temp. modułu</dt><dd class="font-medium">{{ r.tempC | number: '1.1-1' }} °C</dd></div>
          }
          @if (r.rssi !== null) {
            <div>
              <dt class="text-[11px] text-slate-500">Wi-Fi</dt>
              <dd class="font-medium" [class.text-amber-300]="r.rssi <= -80">{{ r.rssi }} dBm{{ r.rssi <= -80 ? ' · słaby' : '' }}</dd>
            </div>
          }
        </dl>
      }

      <!-- Schedule / last run / firmware -->
      <div class="space-y-1 text-xs text-slate-400">
        @if (d.scheduleInfo; as si) {
          <p>
            🗓 {{ si.description }}
            @if (si.nextRunAt) { · następne: {{ si.nextRunAt | date: 'EEE d.MM HH:mm' }} }
            @if (d.schedule?.type === 'night' && si.sunset && si.sunrise) { · dziś zachód {{ si.sunset | date: 'HH:mm' }}, wschód {{ si.sunrise | date: 'HH:mm' }} }
          </p>
        }
        @if (s?.activeSince && s?.active) {
          <p>▶ Pracuje od {{ s?.activeSince | date: 'HH:mm' }}</p>
        }
        @if (!(s?.activeSince && s?.active) && s?.lastRun; as run) {
          <p>
            ⏱ Ostatnia praca: {{ run.start | date: 'd.MM HH:mm' }}–{{ run.end | date: 'HH:mm' }}{{ run.exact ? '' : ' (±15 min)' }}
            @if (run.energyWh !== null) { · {{ run.energyWh | number: '1.0-1' }} Wh }
            @if (run.avgW !== null) { · śr. {{ run.avgW }} W }
          </p>
        }
        @if (s?.fwUpdate) {
          <p>⬆ Dostępna aktualizacja firmware {{ s?.fwUpdate }}{{ s?.fwVersion ? ' (jest ' + s?.fwVersion + ')' : '' }}</p>
        }
      </div>

      <!-- Chart -->
      <div>
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs text-slate-400">
            <span class="font-medium text-slate-200">{{ chartTitle() }}</span>
            @if (summary(); as sum) { · {{ sum }} }
          </div>
          <div class="flex gap-1 rounded-lg bg-surface-800/70 p-0.5" role="tablist">
            @for (r of ranges; track r.id) {
              <button
                role="tab"
                class="rounded-md px-2 py-1 text-xs transition"
                [class]="range() === r.id ? 'bg-surface-700 text-white' : 'text-slate-400 hover:text-white'"
                [attr.aria-selected]="range() === r.id"
                (click)="range.set(r.id)"
              >{{ r.label }}</button>
            }
          </div>
        </div>
        <div class="transition-opacity" [class.opacity-50]="seriesLoading()">
          @if (bars().length) {
            <app-bar-chart [data]="bars()" [unit]="chartUnit()" [decimals]="chartDecimals()" [labelEvery]="labelEvery()" [ariaLabel]="chartTitle()" />
          } @else {
            <div class="flex h-[170px] items-center justify-center text-xs text-slate-500">{{ seriesError() || 'Ładowanie…' }}</div>
          }
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          @if (hasCloud()) {
            @if (hasOwn()) {
              <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background:#3987e5"></span>własne pomiary</span>
            }
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background:#1c5cab"></span>historia z chmury Shelly</span>
          }
          @if (hasBreak()) {
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background:rgba(148,163,184,0.25)"></span>okres przerwy</span>
          }
          @if (series()?.estimated) { <span>szacunek: moc nominalna × czas pracy</span> }
          <button class="ml-auto text-slate-400 underline-offset-2 hover:text-white hover:underline" (click)="showTable.set(!showTable())">
            {{ showTable() ? 'Ukryj tabelę' : 'Pokaż tabelę' }}
          </button>
        </div>
        @if (showTable()) {
          <div class="mt-2 max-h-56 overflow-y-auto rounded-lg border border-white/5">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-surface-900 text-slate-500">
                <tr><th class="px-2 py-1 text-left font-normal">Okres</th><th class="px-2 py-1 text-right font-normal">{{ chartTitle() }}</th><th class="px-2 py-1 text-right font-normal">Praca</th></tr>
              </thead>
              <tbody>
                @for (b of tableRows(); track b.key) {
                  <tr class="border-t border-white/5">
                    <td class="px-2 py-1 text-slate-300">{{ b.label }}</td>
                    <td class="px-2 py-1 text-right" style="font-variant-numeric: tabular-nums">{{ b.value }}</td>
                    <td class="px-2 py-1 text-right text-slate-400" style="font-variant-numeric: tabular-nums">{{ b.hours }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Settings -->
      @if (showSettings()) {
        <div class="space-y-4 border-t border-white/5 pt-4">
          <div>
            <h3 class="mb-1 text-sm font-medium">Okresy przerwy</h3>
            <p class="mb-2 text-xs text-slate-500">
              W czasie przerwy urządzenie nie generuje alertów (np. offline, harmonogram), a dni przerwy nie liczą się do norm.
              Opcjonalnie dostaniesz informację, jeśli mimo przerwy zacznie pracować.
            </p>
            <ul class="mb-2 space-y-1">
              @for (p of d.periods; track p.id) {
                <li class="flex items-center gap-2 rounded-lg bg-surface-800/60 px-3 py-1.5 text-xs">
                  <span class="flex-1">
                    {{ label(p) }}
                    @if (p.note) { <span class="text-slate-500">· {{ p.note }}</span> }
                    @if (p.alertOnActivity) { <span class="text-slate-500">· alarm przy pracy</span> }
                  </span>
                  <button class="text-slate-500 hover:text-red-400" title="Usuń okres" (click)="removePeriod(p)">✕</button>
                </li>
              } @empty {
                <li class="text-xs text-slate-500">Brak — urządzenie monitorowane cały rok.</li>
              }
            </ul>
            <form class="grid gap-2 sm:grid-cols-2" (ngSubmit)="addPeriod()">
              <select class="lo-input" [(ngModel)]="pf.recurring" name="recurring">
                <option [ngValue]="true">Co roku</option>
                <option [ngValue]="false">Jednorazowo</option>
              </select>
              <input class="lo-input" placeholder="Notatka (opcjonalnie)" [(ngModel)]="pf.note" name="note" maxlength="80" />
              @if (pf.recurring) {
                <p class="text-[11px] text-slate-500 sm:col-span-2">Okres powtarza się co roku — liczą się dzień i miesiąc, rok w datach nie ma znaczenia.</p>
              }
              <label class="text-xs text-slate-400">Od<input class="lo-input mt-1" type="date" [(ngModel)]="pf.from" name="from" required /></label>
              <label class="text-xs text-slate-400">Do<input class="lo-input mt-1" type="date" [(ngModel)]="pf.to" name="to" required /></label>
              <label class="flex items-center gap-2 text-xs text-slate-300 sm:col-span-2">
                <input type="checkbox" [(ngModel)]="pf.alertOnActivity" name="alertOnActivity" />
                Powiadom, jeśli urządzenie będzie pracować w czasie przerwy
              </label>
              <button type="submit" class="lo-btn sm:col-span-2" [disabled]="!pf.from || !pf.to">Dodaj okres</button>
            </form>
          </div>

          <form class="grid gap-2 sm:grid-cols-2" (ngSubmit)="saveSettings()">
            <h3 class="text-sm font-medium sm:col-span-2">Ustawienia</h3>
            <label class="text-xs text-slate-400">Nazwa<input class="lo-input mt-1" [(ngModel)]="sf.name" name="name" required /></label>
            <label class="text-xs text-slate-400">Ikona<input class="lo-input mt-1" [(ngModel)]="sf.icon" name="icon" maxlength="4" /></label>
            <label class="text-xs text-slate-400">
              Alert „offline” po (godz.)
              <input class="lo-input mt-1" type="number" min="0.25" step="0.25" [(ngModel)]="sf.offlineAfterHours" name="offline" />
            </label>
            @if (!d.hasPowerMeter) {
              <label class="text-xs text-slate-400">
                Moc nominalna (W) — do szacunku zużycia
                <input class="lo-input mt-1" type="number" min="0" step="1" [(ngModel)]="sf.nominalPowerW" name="nominal" placeholder="np. 60" />
              </label>
            } @else {
              <label class="text-xs text-slate-400">
                „Pracuje”, gdy
                <select class="lo-input mt-1" [(ngModel)]="sf.activitySignal" name="signal">
                  <option value="output">wyjście włączone</option>
                  <option value="power">pobór mocy &gt; próg</option>
                </select>
              </label>
              @if (sf.activitySignal === 'power') {
                <label class="text-xs text-slate-400">
                  Próg mocy (W)
                  <input class="lo-input mt-1" type="number" min="0" step="1" [(ngModel)]="sf.activePowerMinW" name="minw" />
                </label>
              }
            }
            <label class="flex items-center gap-2 text-xs text-slate-300 sm:col-span-2">
              <input type="checkbox" [(ngModel)]="sf.enabled" name="enabled" /> Monitoruj to urządzenie
            </label>
            <div class="flex gap-2 sm:col-span-2">
              <button type="submit" class="lo-btn flex-1">Zapisz</button>
              <button type="button" class="lo-btn-ghost text-red-300 hover:text-red-200" (click)="remove()">Usuń urządzenie</button>
            </div>
            <p class="text-[11px] text-slate-600 sm:col-span-2">ID: {{ d.id }}</p>
          </form>
        </div>
      }
    </div>
  `,
})
export class DeviceCardComponent implements OnInit {
  device = input.required<ShellyDevice>();

  private svc = inject(DevicesService);
  private destroyRef = inject(DestroyRef);

  readonly ranges = RANGES;
  readonly range = signal<ShellyRange>('24h');
  readonly series = signal<ShellySeries | null>(null);
  readonly seriesLoading = signal(false);
  readonly seriesError = signal<string | null>(null);
  readonly showSettings = signal(false);
  readonly showTable = signal(false);

  pf = { recurring: true, from: '', to: '', note: '', alertOnActivity: true };
  sf: {
    name: string;
    icon: string;
    offlineAfterHours: number;
    nominalPowerW: number | null;
    activitySignal: ShellyActivitySignal;
    activePowerMinW: number;
    enabled: boolean;
  } = { name: '', icon: '', offlineAfterHours: 3, nominalPowerW: null, activitySignal: 'output', activePowerMinW: 20, enabled: true };

  private sub?: Subscription;

  constructor() {
    // Reload the series when the range changes or the device data refreshes.
    effect(() => {
      const range = this.range();
      const d = this.device();
      untracked(() => this.loadSeries(d.id, range));
    });
    effect(() => {
      const d = this.device();
      untracked(() => {
        this.sf = {
          name: d.name,
          icon: d.icon,
          offlineAfterHours: d.offlineAfterHours,
          nominalPowerW: d.nominalPowerW ?? null,
          activitySignal: d.activitySignal,
          activePowerMinW: d.activePowerMinW,
          enabled: d.enabled,
        };
      });
    });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
  }

  private loadSeries(id: string, range: ShellyRange): void {
    this.sub?.unsubscribe();
    this.seriesLoading.set(true);
    this.sub = this.svc.series(id, range).subscribe({
      next: (s) => {
        this.series.set(s);
        this.seriesError.set(null);
        this.seriesLoading.set(false);
      },
      error: () => {
        this.seriesError.set('Nie udało się pobrać danych');
        this.seriesLoading.set(false);
      },
    });
  }

  /** What the chart plots: energy (measured / estimated) or active hours. */
  readonly mode = computed<'energy' | 'hours'>(() => {
    const d = this.device();
    return d.hasPowerMeter || d.nominalPowerW ? 'energy' : 'hours';
  });

  readonly kwh = computed(() => {
    const s = this.series();
    if (!s || this.mode() !== 'energy') return false;
    return s.bucket !== 'hour' || Math.max(0, ...s.points.map((p) => p.wh ?? 0)) >= 1000;
  });

  readonly chartUnit = computed(() => (this.mode() === 'hours' ? 'h' : this.kwh() ? 'kWh' : 'Wh'));
  readonly chartDecimals = computed(() => (this.mode() === 'hours' ? 2 : this.kwh() ? 2 : 0));

  readonly chartTitle = computed(() => {
    if (this.mode() === 'hours') return 'Czas pracy';
    return this.series()?.estimated ? 'Zużycie (szacunek)' : 'Zużycie energii';
  });

  readonly activityLabel = computed(() => {
    const d = this.device();
    const s = d.state;
    if (d.activitySignal === 'power') return s?.active ? 'pobiera prąd' : 'bez poboru';
    return s?.output ? 'włączone' : 'wyłączone';
  });

  readonly bars = computed<BarDatum[]>(() => {
    const s = this.series();
    if (!s) return [];
    const kwh = this.kwh();
    return s.points.map((p) => {
      const t = new Date(p.start);
      let label: string;
      let tip: string;
      if (s.bucket === 'hour') {
        label = `${pad(t.getHours())}`;
        tip = `${t.getDate()}.${pad(t.getMonth() + 1)} ${pad(t.getHours())}:00–${pad((t.getHours() + 1) % 24)}:00`;
      } else if (s.bucket === 'day') {
        label = `${t.getDate()}.${pad(t.getMonth() + 1)}`;
        tip = t.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' });
      } else {
        label = MONTHS_PL[t.getMonth()];
        tip = t.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
      }
      let value: number | null;
      if (this.mode() === 'hours') value = p.activeHours;
      else value = p.wh === null ? null : kwh ? p.wh / 1000 : p.wh;
      const notes: string[] = [];
      if (p.source === 'cloud') notes.push('historia z chmury Shelly');
      if (p.source === 'mixed') notes.push('częściowo z chmury Shelly');
      if (p.source === 'estimate') notes.push('szacunek');
      if (p.inBreak) notes.push('okres przerwy');
      if (this.mode() === 'energy' && p.activeHours) notes.push(`praca ${p.activeHours.toFixed(2)} h`);
      return {
        key: p.start,
        label,
        tooltipLabel: tip,
        value,
        muted: p.source === 'cloud',
        shaded: p.inBreak,
        note: notes.join(' · ') || undefined,
      };
    });
  });

  readonly labelEvery = computed(() => {
    const b = this.series()?.bucket;
    return b === 'hour' ? 3 : b === 'day' ? 5 : 1;
  });

  readonly hasCloud = computed(() => this.series()?.points.some((p) => p.source === 'cloud' || p.source === 'mixed') ?? false);
  readonly hasOwn = computed(() => this.series()?.points.some((p) => p.source === 'own' || p.source === 'mixed') ?? false);
  readonly hasBreak = computed(() => this.series()?.points.some((p) => p.inBreak) ?? false);

  readonly summary = computed(() => {
    const s = this.series();
    if (!s) return null;
    const parts: string[] = [];
    if (this.mode() === 'energy' && s.totalWh !== null) {
      parts.push(s.totalWh >= 1000 ? `${(s.totalWh / 1000).toFixed(2).replace('.', ',')} kWh` : `${Math.round(s.totalWh)} Wh`);
    }
    if (s.totalActiveHours !== null) parts.push(`praca ${s.totalActiveHours.toFixed(1).replace('.', ',')} h`);
    return parts.join(' · ') || null;
  });

  readonly tableRows = computed(() => {
    const s = this.series();
    const unit = this.chartUnit();
    const dec = this.chartDecimals();
    return this.bars()
      .map((b, i) => ({
        key: b.key,
        label: b.tooltipLabel,
        value: b.value === null ? '—' : `${b.value.toFixed(dec).replace('.', ',')} ${unit}`,
        hours: s?.points[i]?.activeHours == null ? '—' : `${s.points[i].activeHours!.toFixed(2).replace('.', ',')} h`,
      }))
      .reverse();
  });

  rel = relTime;
  label = periodLabel;

  addPeriod(): void {
    const { recurring, from, to, note, alertOnActivity } = this.pf;
    if (!from || !to) return;
    const input = recurring
      ? { recurring: true, startMd: from.slice(5), endMd: to.slice(5), note, alertOnActivity }
      : { recurring: false, startsOn: from, endsOn: to, note, alertOnActivity };
    this.svc.addPeriod(this.device().id, input, () => {
      this.pf = { recurring: true, from: '', to: '', note: '', alertOnActivity: true };
    });
  }

  removePeriod(p: ShellyPeriod): void {
    if (confirm(`Usunąć okres ${periodLabel(p)}?`)) this.svc.deletePeriod(p.id);
  }

  saveSettings(): void {
    const d = this.device();
    this.svc.updateDevice(d.id, {
      name: this.sf.name,
      icon: this.sf.icon,
      offlineAfterHours: Number(this.sf.offlineAfterHours) || d.offlineAfterHours,
      nominalPowerW: d.hasPowerMeter ? undefined : this.sf.nominalPowerW ? Number(this.sf.nominalPowerW) : null,
      activitySignal: d.hasPowerMeter ? this.sf.activitySignal : undefined,
      activePowerMinW: d.hasPowerMeter ? Number(this.sf.activePowerMinW) : undefined,
      enabled: this.sf.enabled,
    });
  }

  remove(): void {
    const d = this.device();
    if (confirm(`Usunąć „${d.name}” razem z całą historią pomiarów?`)) this.svc.deleteDevice(d.id);
  }
}
