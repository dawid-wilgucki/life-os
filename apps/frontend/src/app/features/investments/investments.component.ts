import { Component, OnInit, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { InvestmentsService } from './investments.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PageBackgroundComponent],
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

      <p class="mt-4 text-xs text-slate-600">
        Read-only mirror of external Workers. Life.OS never modifies the source strategies.
      </p>
    </div>
  `,
})
export class InvestmentsComponent implements OnInit {
  inv = inject(InvestmentsService);
  ngOnInit(): void {
    this.inv.load();
  }
}
