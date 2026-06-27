import { Injectable, inject, signal } from '@angular/core';
import type { JobOffer } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

export interface FetchResult {
  fetched: number;
  saved: number;
  sources: { justjoin: string; nofluffjobs: string };
}

@Injectable({ providedIn: 'root' })
export class JobSearchService {
  private api = inject(ApiService);

  readonly offers = signal<JobOffer[]>([]);
  readonly loading = signal(false);
  readonly fetching = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly fetchResult = signal<FetchResult | null>(null);

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get<JobOffer[]>('/api/job-search/offers').subscribe({
      next: (o) => this.offers.set(o),
      complete: () => this.loading.set(false),
      error: () => {
        this.loading.set(false);
        this.loadError.set('Nie udało się pobrać ofert. Sprawdź czy migracja 0013 została uruchomiona w Supabase.');
      },
    });
  }

  dismiss(id: string): void {
    this.api.patch(`/api/job-search/offers/${id}/dismiss`).subscribe(() =>
      this.offers.update((arr) => arr.filter((o) => o.id !== id)),
    );
  }

  fetchNew(): void {
    this.fetching.set(true);
    this.fetchResult.set(null);
    this.api.post<FetchResult>('/api/job-search/fetch').subscribe({
      next: (result) => {
        this.fetching.set(false);
        this.fetchResult.set(result);
        this.load();
      },
      error: () => this.fetching.set(false),
    });
  }
}
