import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { ShellyActivitySignal, ShellyAlert } from '@life-os/shared-types';
import { DevicesService } from './devices.service';
import { DeviceCardComponent } from './device-card.component';
import { PageBackgroundComponent } from '../../shared/page-background.component';

const RULE_PL: Record<ShellyAlert['rule'], string> = {
  api: 'Shelly Cloud',
  offline: 'Brak kontaktu',
  device_error: 'Błąd urządzenia',
  voltage: 'Napięcie',
  break_activity: 'Praca w przerwie',
  schedule: 'Harmonogram',
  missed_run: 'Brak uruchomienia',
  run_too_long: 'Zbyt długa praca',
};

/** Telegram alerts are HTML; show them as plain text in the UI. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

@Component({
  selector: 'app-devices',
  standalone: true,
  imports: [DatePipe, FormsModule, DeviceCardComponent, PageBackgroundComponent],
  template: `
    <app-page-background theme="devices" />
    <div class="relative mx-auto max-w-6xl p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">Urządzenia</h1>
          <p class="text-sm text-slate-400">
            Shelly · odczyt co 15 min
            @if (health()?.lastSuccessAt) { · ostatni {{ health()?.lastSuccessAt | date: 'HH:mm' }} }
            · alerty na Telegramie (cisza {{ health()?.quietFrom ?? '22:00' }}–{{ health()?.quietTo ?? '07:00' }})
          </p>
        </div>
        <div class="flex gap-2">
          <button class="lo-btn-ghost border border-surface-700" (click)="svc.refresh()" [disabled]="svc.refreshing()">
            <span [class.animate-spin]="svc.refreshing()" class="inline-block">↻</span> Odśwież
          </button>
          <button class="lo-btn" (click)="showAdd.set(!showAdd())">{{ showAdd() ? '✕ Anuluj' : '+ Dodaj' }}</button>
        </div>
      </div>

      @if (svc.error(); as err) {
        <div class="lo-card mb-4 border-red-500/30 p-4 text-sm text-red-300">
          {{ err }}. Jeśli to pierwsze uruchomienie, sprawdź czy migracje 0015–0016 są zastosowane w Supabase.
        </div>
      }

      @if (health(); as h) {
        @if (!h.configured) {
          <div class="lo-card mb-4 p-4 text-sm text-amber-300">Brak sekretów SHELLY_AUTH_KEY / SHELLY_SERVER_URI w Workerze.</div>
        } @else if (h.consecutiveFailures > 0) {
          <div class="lo-card mb-4 p-4 text-sm text-amber-300">
            Shelly Cloud nie odpowiada ({{ h.consecutiveFailures }}× z rzędu{{ h.lastError ? ': ' + h.lastError : '' }}). Pokazuję ostatni znany stan.
          </div>
        }
      }

      @if (showAdd()) {
        <form class="lo-card mb-6 grid gap-3 p-5 sm:grid-cols-2" (ngSubmit)="add()">
          <p class="text-xs text-slate-400 sm:col-span-2">
            ID znajdziesz w aplikacji Shelly: urządzenie → Ustawienia → Informacje o urządzeniu → ID urządzenia (12 znaków, np. e4b0637ece04).
            Model i pomiar mocy wykryję sam, jeśli urządzenie jest online.
          </p>
          <div class="flex gap-2">
            <input class="lo-input w-16 text-center" placeholder="🔥" [(ngModel)]="f.icon" name="icon" maxlength="4" />
            <input class="lo-input flex-1" placeholder="Nazwa (np. Grzałka)" [(ngModel)]="f.name" name="name" required />
          </div>
          <input class="lo-input font-mono" placeholder="ID urządzenia" [(ngModel)]="f.id" name="id" required />
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" [(ngModel)]="f.hasPowerMeter" name="pm" /> Ma pomiar mocy
          </label>
          @if (f.hasPowerMeter) {
            <select class="lo-input" [(ngModel)]="f.activitySignal" name="signal">
              <option value="output">Pracuje = wyjście włączone</option>
              <option value="power">Pracuje = pobiera prąd (np. bojler)</option>
            </select>
          } @else {
            <input class="lo-input" type="number" min="0" placeholder="Moc nominalna (W), opcjonalnie" [(ngModel)]="f.nominalPowerW" name="nominal" />
          }
          <button type="submit" class="lo-btn sm:col-span-2" [disabled]="!f.id.trim() || !f.name.trim()">Dodaj urządzenie</button>
        </form>
      }

      @if (openAlerts().length) {
        <div class="lo-card mb-6 p-4">
          <h2 class="mb-2 text-sm font-medium">Aktywne alerty</h2>
          <ul class="space-y-1.5">
            @for (a of openAlerts(); track a.id) {
              <li class="flex items-start gap-2 text-sm">
                <span>{{ a.severity === 'critical' ? '🔴' : '🟠' }}</span>
                <span class="flex-1">
                  {{ plain(a.message) }}
                  <span class="block text-[11px] text-slate-500">
                    {{ rulePl[a.rule] }} · od {{ a.openedAt | date: 'd.MM HH:mm' }}{{ a.notifiedOpenAt ? '' : ' · powiadomienie po godzinach ciszy' }}
                  </span>
                </span>
              </li>
            }
          </ul>
        </div>
      }

      @if (svc.overview(); as o) {
        <div class="grid gap-4 lg:grid-cols-2">
          @for (d of o.devices; track d.id) {
            <app-device-card [device]="d" />
          } @empty {
            <p class="text-slate-500">Brak urządzeń. Dodaj pierwsze przyciskiem „+ Dodaj”.</p>
          }
        </div>

        @if (o.recentAlerts.length) {
          <div class="mt-6">
            <button class="text-sm text-slate-400 hover:text-white" (click)="showHistory.set(!showHistory())">
              {{ showHistory() ? '▾' : '▸' }} Historia alertów (14 dni, {{ o.recentAlerts.length }})
            </button>
            @if (showHistory()) {
              <ul class="lo-card mt-2 divide-y divide-white/5 p-2">
                @for (a of o.recentAlerts; track a.id) {
                  <li class="px-2 py-1.5 text-xs">
                    <span class="text-slate-300">{{ plain(a.message) }}</span>
                    <span class="block text-slate-500">
                      {{ a.openedAt | date: 'd.MM HH:mm' }} – {{ a.resolvedAt | date: 'd.MM HH:mm' }}
                      · {{ a.resolution === 'break' ? 'zamknięty: początek przerwy' : a.resolution === 'disabled' ? 'zamknięty: monitoring wyłączony' : 'wróciło do normy' }}
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        }
      } @else if (svc.loading()) {
        <p class="text-slate-500">Ładowanie…</p>
      }
    </div>
  `,
})
export class DevicesComponent implements OnInit, OnDestroy {
  svc = inject(DevicesService);
  readonly showAdd = signal(false);
  readonly showHistory = signal(false);
  readonly rulePl = RULE_PL;
  readonly plain = plain;

  readonly health = computed(() => this.svc.overview()?.health ?? null);
  readonly openAlerts = computed(() => this.svc.overview()?.openAlerts ?? []);

  f: { id: string; name: string; icon: string; hasPowerMeter: boolean; activitySignal: ShellyActivitySignal; nominalPowerW: number | null } = {
    id: '', name: '', icon: '', hasPowerMeter: true, activitySignal: 'output', nominalPowerW: null,
  };

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.svc.load();
    // Keep the page current while it is open (data changes every 15 min).
    this.timer = setInterval(() => this.svc.load(), 5 * 60_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  add(): void {
    this.svc.addDevice(
      {
        id: this.f.id.trim(),
        name: this.f.name.trim(),
        icon: this.f.icon.trim() || undefined,
        hasPowerMeter: this.f.hasPowerMeter,
        activitySignal: this.f.hasPowerMeter ? this.f.activitySignal : 'output',
        nominalPowerW: !this.f.hasPowerMeter && this.f.nominalPowerW ? Number(this.f.nominalPowerW) : null,
      },
      () => {
        this.f = { id: '', name: '', icon: '', hasPowerMeter: true, activitySignal: 'output', nominalPowerW: null };
        this.showAdd.set(false);
      },
    );
  }
}
