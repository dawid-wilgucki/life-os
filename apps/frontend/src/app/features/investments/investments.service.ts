import { Injectable, inject, signal } from '@angular/core';
import type { GemStatus, GoldCheckResult, GoldRunResult, GoldStatus } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

/** Grams of pure gold per troy ounce — for the PLN/oz readout. */
const GRAMS_PER_OZ = 31.1035;

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private api = inject(ApiService);

  readonly gold = signal<GoldStatus | null>(null);
  readonly gem = signal<GemStatus | null>(null);
  readonly loading = signal(false);

  // #10 — premium calculator
  readonly checkResult = signal<GoldCheckResult | null>(null);
  readonly checking = signal(false);
  readonly checkError = signal<string | null>(null);

  // #11 — manual "Sprawdź teraz" trigger
  readonly runResult = signal<GoldRunResult | null>(null);
  readonly running = signal(false);

  /** Derived PLN per troy ounce from the live PLN/g SPOT. */
  spotPerOz(): number | null {
    const g = this.gold();
    return g ? g.spot * GRAMS_PER_OZ : null;
  }

  load(): void {
    this.loading.set(true);
    this.api.get<GoldStatus>('/api/investments/gold').subscribe((g) => this.gold.set(g));
    this.api.get<GemStatus>('/api/investments/gem').subscribe({
      next: (g) => this.gem.set(g),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  /** #10 — check whether an offer qualifies as an opportunity. */
  check(price: number, weightGrams: number): void {
    this.checking.set(true);
    this.checkError.set(null);
    this.api.post<GoldCheckResult>('/api/investments/gold/check', { price, weightGrams }).subscribe({
      next: (r) => this.checkResult.set(r),
      complete: () => this.checking.set(false),
      error: () => {
        this.checkError.set('Could not run the check. Verify price and weight.');
        this.checking.set(false);
      },
    });
  }

  /** #11 — trigger the gold-tracker worker run (scrapes + Telegram alerts). */
  run(): void {
    this.running.set(true);
    this.api.post<GoldRunResult>('/api/investments/gold/run', {}).subscribe({
      next: (r) => this.runResult.set(r),
      complete: () => this.running.set(false),
      error: () => this.running.set(false),
    });
  }
}
