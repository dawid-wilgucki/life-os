import { Injectable, inject, signal } from '@angular/core';
import type { JobOffer } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class JobSearchService {
  private api = inject(ApiService);

  readonly offers = signal<JobOffer[]>([]);
  readonly loading = signal(false);
  readonly fetching = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<JobOffer[]>('/api/job-search/offers').subscribe({
      next: (o) => this.offers.set(o),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  dismiss(id: string): void {
    this.api.patch(`/api/job-search/offers/${id}/dismiss`).subscribe(() =>
      this.offers.update((arr) => arr.filter((o) => o.id !== id)),
    );
  }

  fetchNew(): void {
    this.fetching.set(true);
    this.api.post<{ fetched: number; saved: number }>('/api/job-search/fetch').subscribe({
      next: () => {
        this.fetching.set(false);
        this.load();
      },
      error: () => this.fetching.set(false),
    });
  }
}
