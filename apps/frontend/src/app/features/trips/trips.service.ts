import { Injectable, inject, signal } from '@angular/core';
import type { CreateTripInput, Trip } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

export interface ImportResult {
  imported: number;
  skipped: number;
  scanned: number;
}

@Injectable({ providedIn: 'root' })
export class TripsService {
  private api = inject(ApiService);

  readonly trips = signal<Trip[]>([]);
  readonly loading = signal(false);
  readonly importing = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<Trip[]>('/api/trips').subscribe({
      next: (t) => this.trips.set(t),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  add(input: CreateTripInput): void {
    this.api.post<Trip>('/api/trips', input).subscribe((trip) => {
      this.trips.update((list) => [trip, ...list].sort((a, b) => b.departureAt.localeCompare(a.departureAt)));
    });
  }

  importEmail(onDone: (r: ImportResult) => void): void {
    this.importing.set(true);
    this.api.post<ImportResult>('/api/trips/import-email').subscribe({
      next: (r) => {
        onDone(r);
        if (r.imported > 0) this.load();
      },
      complete: () => this.importing.set(false),
      error: () => this.importing.set(false),
    });
  }
}
