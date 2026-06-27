import { Injectable, inject, signal } from '@angular/core';
import type { GemStatus, GoldCheckResult, GoldOffersResult, GoldOpportunities, GoldStatus } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

const GRAMS_PER_OZ = 31.1035;

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private api = inject(ApiService);

  readonly gold = signal<GoldStatus | null>(null);
  readonly goldError = signal<string | null>(null);
  readonly gem = signal<GemStatus | null>(null);
  readonly loading = signal(false);

  readonly offerResult = signal<GoldOffersResult | null>(null);
  readonly loadingOffers = signal(false);
  readonly offerError = signal<string | null>(null);

  readonly opportunities = signal<GoldOpportunities | null>(null);

  readonly checkResult = signal<GoldCheckResult | null>(null);
  readonly checking = signal(false);
  readonly checkError = signal<string | null>(null);

  spotPerOz(): number | null {
    const g = this.gold();
    return g ? g.spot * GRAMS_PER_OZ : null;
  }

  load(): void {
    this.loading.set(true);
    this.goldError.set(null);
    this.api.get<GoldStatus>('/api/investments/gold').subscribe({
      next: (g) => this.gold.set(g),
      error: () => this.goldError.set('Nie udało się pobrać kursu SPOT.'),
    });
    this.api.get<GemStatus>('/api/investments/gem').subscribe({
      next: (g) => this.gem.set(g),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  loadOpportunities(): void {
    this.api.get<GoldOpportunities>('/api/investments/gold/opportunities').subscribe({
      next: (o) => this.opportunities.set(o),
      error: () => this.opportunities.set({ date: null, spotPerGram: null, count: 0, offers: [] }),
    });
  }

  fetchOffers(maxPrice: number): void {
    this.loadingOffers.set(true);
    this.offerError.set(null);
    this.api.post<GoldOffersResult>('/api/investments/gold/offers', { maxPrice }).subscribe({
      next: (r) => this.offerResult.set(r),
      complete: () => this.loadingOffers.set(false),
      error: () => {
        this.offerError.set('Nie udało się pobrać ofert. Sprawdź połączenie.');
        this.loadingOffers.set(false);
      },
    });
  }

  check(price: number, weightGrams: number): void {
    this.checking.set(true);
    this.checkError.set(null);
    this.api.post<GoldCheckResult>('/api/investments/gold/check', { price, weightGrams }).subscribe({
      next: (r) => this.checkResult.set(r),
      complete: () => this.checking.set(false),
      error: () => {
        this.checkError.set('Nie udało się wykonać obliczeń. Sprawdź dane wejściowe.');
        this.checking.set(false);
      },
    });
  }
}
