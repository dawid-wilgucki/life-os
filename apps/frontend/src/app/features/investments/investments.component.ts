import { Component, OnInit, inject } from '@angular/core';
import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvestmentsService } from './investments.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

const NUMITRACKER_URL = 'https://numitracker.com/produkty/zloto?max_price=2000&order_by=over_spot_asc&offers_country=PL';

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [DatePipe, DecimalPipe, NgClass, FormsModule, PageBackgroundComponent],
  template: `
    <app-page-background theme="investments" />
    <div class="relative mx-auto max-w-4xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Investments</h1>
        <button class="lo-btn-ghost" (click)="inv.load()">↻ Refresh</button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <!-- Gold — live SPOT -->
        <section class="lo-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="font-medium">🪙 Gold — SPOT</h2>
            @if (inv.gold()?.mock) { <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">mock</span> }
          </div>
          @if (inv.gold(); as g) {
            <div class="mt-3">
              <div class="text-3xl font-semibold">
                {{ g.spot | number: '1.2-2' }} <span class="text-base text-slate-400">{{ g.currency }}/g</span>
              </div>
              <p class="mt-1 text-sm text-slate-400">
                ≈ {{ inv.spotPerOz() | number: '1.0-0' }} {{ g.currency }}/oz
              </p>
              <p class="mt-1 text-xs text-slate-500">
                NBP gold price@if (g.asOf) { · {{ g.asOf | date: 'mediumDate' }} }
              </p>
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

        <!-- #10 — Premium calculator -->
        <section class="lo-card p-5">
          <h2 class="font-medium">🧮 Premium check</h2>
          <p class="mt-1 text-xs text-slate-500">Is an offer an opportunity? Uses live SPOT + tracker thresholds.</p>
          <form class="mt-3 grid grid-cols-2 gap-3" (ngSubmit)="runCheck()">
            <label class="text-xs text-slate-400">
              Offer price (PLN)
              <input class="lo-input mt-1" type="number" min="0" step="0.01" [(ngModel)]="form.price" name="price" required />
            </label>
            <label class="text-xs text-slate-400">
              Gold content (g)
              <input class="lo-input mt-1" type="number" min="0" step="0.001" [(ngModel)]="form.weightGrams" name="weight" required />
            </label>
            <button type="submit" class="lo-btn col-span-2" [disabled]="inv.checking()">
              {{ inv.checking() ? 'Checking…' : 'Check premium' }}
            </button>
          </form>

          @if (inv.checkError(); as err) {
            <p class="mt-3 text-sm text-rose-400">{{ err }}</p>
          }
          @if (inv.checkResult(); as r) {
            <div class="mt-4 rounded-lg border p-3 text-sm"
                 [ngClass]="r.isOpportunity ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-surface-700'">
              <div class="flex items-center justify-between">
                <span class="font-semibold" [ngClass]="r.isOpportunity ? 'text-emerald-400' : 'text-slate-300'">
                  {{ r.isOpportunity ? '✅ Opportunity' : '❌ Not an opportunity' }}
                </span>
                <span class="text-slate-400">premium <b>{{ r.overSpotPct | number: '1.2-2' }}%</b></span>
              </div>
              <dl class="mt-2 space-y-0.5 text-xs text-slate-400">
                <div class="flex justify-between"><dt>Fair gold value</dt><dd>{{ r.spotValue | number: '1.2-2' }} PLN</dd></div>
                <div class="flex justify-between"><dt>SPOT used</dt><dd>{{ r.spotPerGram | number: '1.2-2' }} PLN/g</dd></div>
                <div class="flex justify-between"><dt>Tier threshold</dt><dd>{{ r.threshold === null ? 'n/a' : (r.threshold | number: '1.1-1') + '%' }}</dd></div>
                <div class="flex justify-between"><dt>Tier</dt><dd class="text-right">{{ r.tier }}</dd></div>
              </dl>
            </div>
          }
        </section>

        <!-- #11 — Manual run trigger -->
        <section class="lo-card p-5">
          <h2 class="font-medium">🚨 Okazje</h2>
          <p class="mt-1 text-xs text-slate-500">
            Run the gold-tracker now: it scrapes NumiTracker and pushes any new opportunities to Telegram.
          </p>
          <button class="lo-btn mt-3" (click)="inv.run()" [disabled]="inv.running()">
            {{ inv.running() ? 'Checking…' : 'Sprawdź teraz' }}
          </button>

          @if (inv.runResult(); as r) {
            <div class="mt-4 rounded-lg border border-surface-700 p-3 text-sm">
              @if (r.mock) {
                <p class="text-amber-300">Tracker unavailable — no run performed.</p>
              } @else {
                <p>
                  Checked <b>{{ r.checked }}</b> offers · <b>{{ r.alertsSent }}</b>
                  new alert{{ r.alertsSent === 1 ? '' : 's' }} sent to Telegram.
                </p>
                @if (r.spotPerGram !== null) {
                  <p class="mt-1 text-xs text-slate-500">Worker SPOT: {{ r.spotPerGram | number: '1.2-2' }} PLN/g</p>
                }
              }
            </div>
          }
          <a class="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300" [href]="numitrackerUrl" target="_blank" rel="noopener">
            Open NumiTracker ↗
          </a>
        </section>
      </div>

      <p class="mt-4 text-xs text-slate-600">
        SPOT from NBP. Premium thresholds and alerts mirror the external gold-tracker Worker — Life.OS never modifies the source strategy.
      </p>
    </div>
  `,
})
export class InvestmentsComponent implements OnInit {
  inv = inject(InvestmentsService);
  readonly numitrackerUrl = NUMITRACKER_URL;

  form: { price: number | null; weightGrams: number | null } = { price: null, weightGrams: null };

  ngOnInit(): void {
    this.inv.load();
  }

  runCheck(): void {
    if (this.form.price == null || this.form.weightGrams == null) return;
    this.inv.check(this.form.price, this.form.weightGrams);
  }
}
