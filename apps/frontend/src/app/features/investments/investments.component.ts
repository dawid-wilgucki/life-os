import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvestmentsService } from './investments.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

/** Opportunity thresholds mirroring numitracker.ts GOLD_TIERS. */
const TIERS = [
  { maxPrice: 600, threshold: 10.0 },
  { maxPrice: 1200, threshold: 7.0 },
  { maxPrice: 2000, threshold: 5.5 },
];

function isOpp(price: number, overSpot: number): boolean {
  const tier = TIERS.find((t) => price <= t.maxPrice);
  return tier != null && overSpot <= tier.threshold;
}

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [DatePipe, DecimalPipe, NgClass, FormsModule, PageBackgroundComponent],
  template: `
    <app-page-background theme="investments" />

    <div class="relative mx-auto max-w-5xl p-6">
      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Investments</h1>
        <button class="lo-btn-ghost text-sm" (click)="inv.load(); inv.loadOpportunities()">↻ Odśwież</button>
      </div>

      <div class="space-y-4">

        <!-- Row 1: SPOT + GEM -->
        <div class="grid gap-4 md:grid-cols-2">

          <!-- SPOT card -->
          <section class="lo-card p-5">
            <div class="mb-4 flex items-center gap-2">
              <span class="text-lg">🪙</span>
              <h2 class="font-medium">SPOT — Złoto (NBP)</h2>
            </div>
            @if (inv.goldError(); as err) {
              <p class="text-sm text-rose-400">{{ err }}</p>
            } @else if (inv.gold(); as g) {
              <div class="text-4xl font-bold tracking-tight text-amber-300">
                {{ g.spot | number: '1.2-2' }}
                <span class="text-base font-normal text-slate-400">PLN/g</span>
              </div>
              <div class="mt-1 text-base text-slate-400">
                ≈ {{ inv.spotPerOz() | number: '1.0-0' }} PLN/oz
              </div>
              @if (g.asOf) {
                <span class="mt-3 inline-flex items-center rounded-full bg-surface-800 px-2.5 py-0.5 text-xs text-slate-500">
                  NBP · {{ g.asOf | date: 'mediumDate' }}
                </span>
              }
            } @else {
              <p class="text-slate-500">Pobieranie…</p>
            }
          </section>

          <!-- GEM card -->
          <section class="lo-card p-5">
            <div class="mb-3 flex items-center gap-2">
              <span class="text-lg">📊</span>
              <h2 class="font-medium">GEM Strategy</h2>
            </div>
            @if (inv.gem(); as g) {
              <div class="mb-3 text-sm">
                Holding:
                <span class="font-bold text-emerald-400">{{ g.currentHolding ?? '—' }}</span>
              </div>
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-surface-700 text-xs uppercase text-slate-500">
                    <th class="pb-1.5 text-left">#</th>
                    <th class="pb-1.5 text-left">Ticker</th>
                    <th class="pb-1.5 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of g.ranking; track r.ticker; let i = $index) {
                    <tr class="border-b border-surface-800 last:border-0">
                      <td class="py-1.5 text-slate-500">{{ i + 1 }}</td>
                      <td class="font-medium">{{ r.ticker }}</td>
                      <td class="text-right tabular-nums">{{ r.score | number: '1.2-2' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="text-sm text-slate-500">Brak danych.</p>
            }
          </section>

        </div>

        <!-- Row 2: Main offer-check card (full-width) -->
        <section class="lo-card border-amber-500/20 p-6">
          <h2 class="font-semibold">🔍 Sprawdź okazje złota</h2>
          <p class="mt-1 text-xs text-slate-500">
            Pobiera aktualne oferty z NumiTracker, filtruje okazje wg progów i wysyła podsumowanie na Telegram.
          </p>

          <div class="mt-4 flex flex-wrap items-end gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400">Maks. cena (PLN)</span>
              <input
                class="lo-input w-36 tabular-nums"
                type="number"
                min="100"
                max="10000"
                step="100"
                [ngModel]="maxPrice()"
                (ngModelChange)="maxPrice.set(+$event)"
                name="maxPrice"
              />
            </label>
            <div class="flex gap-1.5">
              @for (preset of pricePresets; track preset) {
                <button
                  class="rounded border px-2.5 py-1.5 text-xs transition-colors"
                  [ngClass]="maxPrice() === preset
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-surface-600 text-slate-400 hover:border-slate-500 hover:text-slate-300'"
                  (click)="maxPrice.set(preset)"
                >{{ preset | number }}</button>
              }
            </div>
            <button
              class="lo-btn ml-auto flex items-center gap-2 px-6 py-2.5"
              [disabled]="inv.loadingOffers()"
              (click)="fetchOffers()"
            >
              @if (inv.loadingOffers()) {
                <span class="animate-spin inline-block">⟳</span> Sprawdzam…
              } @else {
                🔍 Sprawdź teraz
              }
            </button>
          </div>

          @if (inv.offerError(); as err) {
            <p class="mt-4 text-sm text-rose-400">{{ err }}</p>
          }

          @if (inv.offerResult(); as r) {
            <div class="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-surface-700 bg-surface-900/60 p-3">
              <div class="flex items-center gap-1.5 text-sm">
                <span class="text-slate-400">Ofert:</span>
                <span class="font-semibold tabular-nums">{{ r.count }}</span>
              </div>
              <div class="flex items-center gap-1.5 text-sm">
                <span class="text-slate-400">Okazje:</span>
                <span
                  class="font-semibold tabular-nums"
                  [ngClass]="oppCount() > 0 ? 'text-emerald-400' : 'text-slate-300'"
                >{{ oppCount() }}</span>
              </div>
              @if (r.spotPerGram) {
                <span class="text-xs text-slate-500">SPOT {{ r.spotPerGram | number: '1.2-2' }} PLN/g</span>
              }
              <button class="lo-btn-ghost ml-auto text-sm" (click)="openDialog()">
                Pokaż oferty →
              </button>
            </div>
          }
        </section>

        <!-- Row 3: Daily opportunities + Premium calculator -->
        <div class="grid gap-4 md:grid-cols-2">

          <!-- Daily opportunities tile -->
          <section class="lo-card p-5">
            <div class="mb-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-lg">📅</span>
                <h2 class="font-medium">Dzisiejsze okazje</h2>
              </div>
              <button class="lo-btn-ghost text-xs" (click)="inv.loadOpportunities()">↻</button>
            </div>
            @if (inv.opportunities(); as opp) {
              @if (opp.date) {
                <p class="mb-3 text-xs text-slate-500">
                  Sprawdzono: {{ opp.date | date: 'mediumDate' }}
                  @if (opp.spotPerGram) { · SPOT {{ opp.spotPerGram | number: '1.2-2' }} PLN/g }
                </p>
                @if (opp.count > 0) {
                  <div class="space-y-1.5">
                    @for (o of opp.offers.slice(0, 5); track o.id) {
                      <a
                        [href]="o.numitrackerUrl"
                        target="_blank"
                        rel="noopener"
                        class="flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-xs no-underline transition-colors hover:bg-emerald-500/20"
                      >
                        <span class="shrink-0 font-bold tabular-nums text-emerald-400">
                          {{ o.overSpot | number: '1.1-1' }}%
                        </span>
                        <span class="min-w-0 flex-1 truncate text-slate-300">{{ o.title }}</span>
                        <span class="shrink-0 tabular-nums text-slate-500">{{ o.price | number: '1.0-0' }} zł</span>
                      </a>
                    }
                    @if (opp.count > 5) {
                      <p class="pl-1 text-xs text-slate-500">+{{ opp.count - 5 }} więcej…</p>
                    }
                  </div>
                } @else {
                  <div class="flex items-center gap-2 text-sm text-slate-400">
                    <span>✅</span>
                    <span>Dziś brak okazji (≤ 2000 zł).</span>
                  </div>
                }
              } @else {
                <p class="text-sm text-slate-500">Cron jeszcze nie uruchomiony dziś (07:00 UTC).</p>
              }
            } @else {
              <p class="text-sm text-slate-500">Pobieranie…</p>
            }
          </section>

          <!-- Premium calculator -->
          <section class="lo-card p-5">
            <div class="mb-3 flex items-center gap-2">
              <span class="text-lg">🧮</span>
              <h2 class="font-medium">Kalkulator premii</h2>
            </div>
            <p class="mb-4 text-xs text-slate-500">
              Sprawdź czy konkretna oferta jest okazją wg progów gold-trackera i aktualnego SPOT.
            </p>
            <form class="space-y-3" (ngSubmit)="runCheck()">
              <label class="flex flex-col gap-1 text-xs text-slate-400">
                Cena oferty (PLN)
                <input class="lo-input" type="number" min="0" step="0.01"
                  [(ngModel)]="form.price" name="price" required />
              </label>
              <label class="flex flex-col gap-1 text-xs text-slate-400">
                Zawartość złota (g)
                <input class="lo-input" type="number" min="0" step="0.001"
                  [(ngModel)]="form.weightGrams" name="weight" required />
              </label>
              <button type="submit" class="lo-btn w-full" [disabled]="inv.checking()">
                {{ inv.checking() ? 'Obliczam…' : 'Oblicz premię' }}
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
                    {{ r.isOpportunity ? '✅ Okazja!' : '❌ Nie okazja' }}
                  </span>
                  <span class="text-slate-400">
                    premium <b class="tabular-nums">{{ r.overSpotPct | number: '1.2-2' }}%</b>
                  </span>
                </div>
                <dl class="mt-2 space-y-0.5 text-xs text-slate-500">
                  <div class="flex justify-between">
                    <dt>Wartość złota</dt>
                    <dd class="tabular-nums">{{ r.spotValue | number: '1.2-2' }} PLN</dd>
                  </div>
                  <div class="flex justify-between">
                    <dt>SPOT użyty</dt>
                    <dd class="tabular-nums">{{ r.spotPerGram | number: '1.2-2' }} PLN/g</dd>
                  </div>
                  <div class="flex justify-between">
                    <dt>Próg</dt>
                    <dd>{{ r.threshold === null ? 'poza zakresem' : (r.threshold | number: '1.1-1') + '%' }}</dd>
                  </div>
                  <div class="flex justify-between">
                    <dt>Tier</dt>
                    <dd class="max-w-[55%] text-right">{{ r.tier }}</dd>
                  </div>
                </dl>
              </div>
            }
          </section>

        </div>
      </div>

      <p class="mt-6 text-xs text-slate-600">
        SPOT z NBP. Progi okazji odwzorowują zewnętrzny gold-tracker Worker — Life.OS nie modyfikuje strategii.
      </p>
    </div>

    <!-- Offers dialog -->
    @if (showDialog()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        (click)="closeDialog()"
      >
        <div
          class="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-950 shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <!-- Dialog header -->
          <div class="flex shrink-0 items-start justify-between border-b border-surface-700 px-5 py-4">
            <div>
              <h3 class="font-semibold">
                Oferty złota
                @if (inv.offerResult(); as r) { (≤ {{ r.maxPrice | number }} PLN) }
              </h3>
              @if (inv.offerResult(); as r) {
                <p class="mt-0.5 text-xs text-slate-500">
                  {{ r.count }} ofert · <span [ngClass]="oppCount() > 0 ? 'text-emerald-400' : ''">{{ oppCount() }} okazji</span>
                  @if (r.spotPerGram) { · SPOT {{ r.spotPerGram | number: '1.2-2' }} PLN/g }
                </p>
              }
            </div>
            <div class="flex items-center gap-2">
              <button class="lo-btn-ghost flex items-center gap-1 text-sm" (click)="downloadJson()">
                ↓ JSON
              </button>
              <button class="lo-btn-ghost text-lg leading-none" (click)="closeDialog()">✕</button>
            </div>
          </div>

          <!-- Table -->
          <div class="overflow-auto">
            <table class="w-full min-w-[640px] text-sm">
              <thead class="sticky top-0 border-b border-surface-700 bg-surface-950">
                <tr class="text-xs uppercase text-slate-500">
                  <th class="px-3 py-2.5 text-right">#</th>
                  <th class="px-3 py-2.5 text-left">Produkt</th>
                  <th class="px-3 py-2.5 text-right">Gramatura</th>
                  <th class="px-3 py-2.5 text-right">Cena</th>
                  <th class="px-3 py-2.5 text-right">Premium</th>
                  <th class="px-3 py-2.5 text-left">Dealer</th>
                </tr>
              </thead>
              <tbody>
                @if (inv.offerResult(); as r) {
                  @for (o of r.offers; track o.id; let i = $index) {
                    <tr
                      class="cursor-pointer border-b border-surface-800 transition-colors last:border-0"
                      [ngClass]="isOpp(o.price, o.overSpot)
                        ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                        : 'hover:bg-surface-800'"
                      (click)="openOffer(o.numitrackerUrl)"
                    >
                      <td class="px-3 py-2 text-right text-slate-500">{{ i + 1 }}</td>
                      <td class="px-3 py-2 font-medium" [title]="o.title">
                        <span class="line-clamp-1">{{ o.title }}</span>
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums text-slate-400">
                        {{ o.weightGrams != null ? ((o.weightGrams | number: '1.2-2') + ' g') : '—' }}
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums font-medium">
                        {{ o.price | number: '1.0-0' }} PLN
                      </td>
                      <td
                        class="px-3 py-2 text-right tabular-nums font-semibold"
                        [ngClass]="premiumClass(o.price, o.overSpot)"
                      >
                        {{ o.overSpot | number: '1.1-1' }}%
                      </td>
                      <td class="px-3 py-2 text-slate-400">{{ o.dealer ?? '—' }}</td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
})
export class InvestmentsComponent implements OnInit {
  inv = inject(InvestmentsService);

  readonly maxPrice = signal(2000);
  readonly showDialog = signal(false);
  readonly pricePresets = [600, 1200, 2000];

  form: { price: number | null; weightGrams: number | null } = { price: null, weightGrams: null };

  ngOnInit(): void {
    this.inv.load();
    this.inv.loadOpportunities();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showDialog()) this.showDialog.set(false);
  }

  fetchOffers(): void {
    this.inv.fetchOffers(this.maxPrice());
  }

  runCheck(): void {
    if (this.form.price == null || this.form.weightGrams == null) return;
    this.inv.check(this.form.price, this.form.weightGrams);
  }

  openDialog(): void {
    this.showDialog.set(true);
  }

  closeDialog(): void {
    this.showDialog.set(false);
  }

  openOffer(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  downloadJson(): void {
    const r = this.inv.offerResult();
    if (!r) return;
    const blob = new Blob([JSON.stringify(r.offers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gold-offers-${r.maxPrice}pln-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  oppCount(): number {
    return this.inv.offerResult()?.offers.filter((o) => isOpp(o.price, o.overSpot)).length ?? 0;
  }

  isOpp(price: number, overSpot: number): boolean {
    return isOpp(price, overSpot);
  }

  premiumClass(price: number, overSpot: number): string {
    if (isOpp(price, overSpot)) return 'text-emerald-400';
    if (overSpot <= 12) return 'text-amber-400';
    return 'text-slate-400';
  }
}
