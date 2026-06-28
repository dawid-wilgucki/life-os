import { Component, OnInit, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { GoldCheckResult } from '@life-os/shared-types';
import { InvestmentsService } from './investments.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, PageBackgroundComponent],
  template: `
    <app-page-background theme="investments" />
    <div class="relative mx-auto max-w-4xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Investments</h1>
        <button class="lo-btn-ghost" (click)="inv.load()">↻ Refresh</button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <!-- Gold -->
        <section class="lo-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="font-medium">🪙 Gold</h2>
            @if (inv.gold()?.mock) { <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">mock</span> }
          </div>
          @if (inv.gold(); as g) {
            <div class="mt-3">
              <div class="text-3xl font-semibold">{{ g.spot | number: '1.2-2' }} <span class="text-base text-slate-400">{{ g.currency }}</span></div>
              <p class="mt-1 text-xs text-slate-500">SPOT price</p>
            </div>
            <div class="mt-4">
              <h3 class="text-xs font-medium uppercase text-slate-500">Recent alerts</h3>
              <ul class="mt-1 space-y-1">
                @for (a of g.alerts; track a.at) {
                  <li class="text-sm">
                    <span class="text-slate-400">{{ a.at | date: 'short' }}</span> — {{ a.message }}
                  </li>
                } @empty {
                  <li class="text-sm text-slate-500">No alerts.</li>
                }
              </ul>
            </div>
          } @else {
            <p class="mt-3 text-slate-500">Loading…</p>
          }
        </section>

        <!-- GEM -->
        <section class="lo-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="font-medium">📊 GEM strategy</h2>
            @if (inv.gem()?.mock) { <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">mock</span> }
          </div>
          @if (inv.gem(); as g) {
            <div class="mt-3 text-sm">
              Current holding:
              <span class="font-semibold text-emerald-400">{{ g.currentHolding ?? '—' }}</span>
            </div>
            <table class="mt-4 w-full text-sm">
              <thead class="text-xs uppercase text-slate-500">
                <tr><th class="py-1 text-left">#</th><th class="text-left">Ticker</th><th class="text-right">Score</th></tr>
              </thead>
              <tbody>
                @for (r of g.ranking; track r.ticker; let i = $index) {
                  <tr class="border-t border-surface-800">
                    <td class="py-1 text-slate-500">{{ i + 1 }}</td>
                    <td class="font-medium">{{ r.ticker }}</td>
                    <td class="text-right">{{ r.score | number: '1.2-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="mt-3 text-slate-500">Loading…</p>
          }
        </section>
      </div>

      <!-- Sprawdź oferty złota (odpowiednik /check kwota [premia%]) -->
      <section class="lo-card mt-4 p-5">
        <h2 class="font-medium">🔎 Sprawdź oferty złota</h2>
        <p class="mt-1 text-xs text-slate-500">
          Odpowiednik komendy <code>/check kwota [premia%]</code> — szukaj okazji do podanej kwoty.
        </p>

        <div class="mt-3 flex flex-wrap items-end gap-3">
          <label class="text-sm">
            <span class="block text-xs text-slate-500">Max cena (PLN)</span>
            <input type="number" min="1" class="lo-input mt-1 w-36" [(ngModel)]="amount" />
          </label>
          <label class="text-sm">
            <span class="block text-xs text-slate-500">Max premia % (opcjonalnie)</span>
            <input type="number" step="0.1" class="lo-input mt-1 w-44" [(ngModel)]="premium" placeholder="np. 9" />
          </label>
          <button
            class="lo-btn"
            [disabled]="inv.goldChecking() || !amount"
            (click)="inv.checkGold(amount, premium)"
          >
            {{ inv.goldChecking() ? 'Szukam…' : 'Sprawdź' }}
          </button>
        </div>

        @if (inv.goldCheck(); as r) {
          <div class="mt-4">
            <div class="flex items-center justify-between text-sm">
              <span>
                {{ r.count }} pozycji • SPOT NBP:
                <strong>{{ r.spotPlnPerGram !== null ? (r.spotPlnPerGram | number: '1.2-2') + ' zł/g' : 'n/d' }}</strong>
              </span>
              @if (r.count > 0) {
                <button class="lo-btn-ghost text-xs" (click)="downloadJson(r)">⬇ Pobierz pełny JSON</button>
              }
            </div>

            @if (r.count > 0) {
              <table class="mt-3 w-full text-sm">
                <thead class="text-xs uppercase text-slate-500">
                  <tr>
                    <th class="py-1 text-left">Produkt</th>
                    <th class="text-right">Waga</th>
                    <th class="text-right">Cena</th>
                    <th class="text-right">Premia</th>
                    <th class="text-left">Dealer</th>
                  </tr>
                </thead>
                <tbody>
                  @for (o of r.offers.slice(0, 12); track o.numiUrl) {
                    <tr class="border-t border-surface-800">
                      <td class="py-1">
                        <a class="text-sky-400 hover:underline" [href]="o.dealerUrl ?? o.numiUrl" target="_blank" rel="noopener">
                          {{ o.title }}
                        </a>
                      </td>
                      <td class="text-right text-slate-400">{{ o.grams !== null ? (o.grams | number: '1.0-2') + ' g' : '?' }}</td>
                      <td class="text-right">{{ o.price | number: '1.2-2' }} zł</td>
                      <td class="text-right text-amber-300">+{{ o.overSpot | number: '1.2-2' }}%</td>
                      <td class="text-slate-400">{{ o.dealer ?? '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (r.count > 12) {
                <p class="mt-2 text-xs text-slate-500">Pokazano top 12 z {{ r.count }} — pełna lista w pliku JSON.</p>
              }
            } @else {
              <p class="mt-3 text-sm text-slate-500">Brak wyników dla podanych kryteriów.</p>
            }
          </div>
        }
      </section>

      <!-- Analiza GEM (odpowiednik /sprawdz) -->
      <section class="lo-card mt-4 p-5">
        <div class="flex items-center justify-between">
          <h2 class="font-medium">📈 Analiza GEM</h2>
          <button
            class="lo-btn"
            [disabled]="inv.gemRunning()"
            (click)="inv.runGem(inv.gem()?.currentHolding ?? null)"
          >
            {{ inv.gemRunning() ? 'Liczę…' : 'Uruchom analizę' }}
          </button>
        </div>
        <p class="mt-1 text-xs text-slate-500">
          Odpowiednik komendy <code>/sprawdz</code> — ranking momentum 12m-1m i decyzja rotacji.
        </p>

        @if (inv.gemRun(); as r) {
          <table class="mt-4 w-full text-sm">
            <thead class="text-xs uppercase text-slate-500">
              <tr><th class="py-1 text-left">#</th><th class="text-left">Ticker</th><th class="text-right">Momentum</th></tr>
            </thead>
            <tbody>
              @for (e of r.ranking; track e.name; let i = $index) {
                <tr class="border-t border-surface-800">
                  <td class="py-1 text-slate-500">{{ i === 0 ? '🥇' : i + 1 }}</td>
                  <td class="font-medium">{{ e.name }}</td>
                  <td class="text-right" [class.text-emerald-400]="e.momentum >= 0" [class.text-rose-400]="e.momentum < 0">
                    {{ e.momentum | number: '1.2-2' }}%
                  </td>
                </tr>
              }
            </tbody>
          </table>

          <div class="mt-3 text-sm">
            🎯 <span class="font-medium">Decyzja:</span>
            @if (r.rotate) {
              <span class="text-amber-300">⚠️ ROTACJA — nowym liderem jest <strong>{{ r.leader }}</strong>. Sprzedaj {{ r.currentHolding ?? '—' }} i kup {{ r.leader }}.</span>
            } @else {
              <span class="text-emerald-400">Trzymasz <strong>{{ r.currentHolding ?? r.leader ?? '—' }}</strong>. Brak rotacji.</span>
            }
          </div>
          @if (r.errorCount > 0) {
            <p class="mt-1 text-xs text-slate-500">Uwaga: {{ r.errorCount }} instrumentów nie udało się pobrać.</p>
          }
        }
      </section>

      <p class="mt-4 text-xs text-slate-600">
        Dane on-demand z publicznych źródeł (NBP, NumiTracker, Yahoo Finance). Logika przeniesiona z workerów gold-tracker i gem-strategy.
      </p>
    </div>
  `,
})
export class InvestmentsComponent implements OnInit {
  inv = inject(InvestmentsService);

  amount = 700;
  premium: number | null = null;

  ngOnInit(): void {
    this.inv.load();
  }

  downloadJson(result: GoldCheckResult): void {
    const blob = new Blob([JSON.stringify(result.offers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gold_${result.maxPrice}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
