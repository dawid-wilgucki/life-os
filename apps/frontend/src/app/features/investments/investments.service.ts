import { Injectable, inject, signal } from '@angular/core';
import type {
  GemRunResult,
  GoldAnalysisResult,
  GoldCheckResult,
  GoldStatus,
} from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private api = inject(ApiService);

  readonly gold = signal<GoldStatus | null>(null);
  readonly loading = signal(false);

  // On-demand: gold offers check (odpowiednik /check kwota [premia%]).
  readonly goldCheck = signal<GoldCheckResult | null>(null);
  readonly goldChecking = signal(false);

  // On-demand: Gemini analysis of gold offers.
  readonly goldAnalysis = signal<GoldAnalysisResult | null>(null);
  readonly goldAnalyzing = signal(false);

  // On-demand: GEM momentum analysis (odpowiednik /sprawdz).
  readonly gemRun = signal<GemRunResult | null>(null);
  readonly gemRunning = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<GoldStatus>('/api/investments/gold').subscribe({
      next: (g) => this.gold.set(g),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  checkGold(maxPrice: number, maxPremium: number | null): void {
    this.goldChecking.set(true);
    this.goldAnalysis.set(null);
    this.api
      .post<GoldCheckResult>('/api/investments/gold/check', { maxPrice, maxPremium })
      .subscribe({
        next: (r) => this.goldCheck.set(r),
        complete: () => this.goldChecking.set(false),
        error: () => this.goldChecking.set(false),
      });
  }

  analyzeGold(check: GoldCheckResult): void {
    this.goldAnalyzing.set(true);
    this.api
      .post<GoldAnalysisResult>('/api/investments/gold/analyze', {
        offers: check.offers,
        spotPlnPerGram: check.spotPlnPerGram,
      })
      .subscribe({
        next: (r) => this.goldAnalysis.set(r),
        complete: () => this.goldAnalyzing.set(false),
        error: () => this.goldAnalyzing.set(false),
      });
  }

  runGem(currentHolding: string | null): void {
    this.gemRunning.set(true);
    this.api.post<GemRunResult>('/api/investments/gem/run', { currentHolding }).subscribe({
      next: (r) => this.gemRun.set(r),
      complete: () => this.gemRunning.set(false),
      error: () => this.gemRunning.set(false),
    });
  }
}
