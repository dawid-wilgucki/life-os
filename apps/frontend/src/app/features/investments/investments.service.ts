import { Injectable, inject, signal } from '@angular/core';
import type { GemStatus, GoldStatus } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private api = inject(ApiService);

  readonly gold = signal<GoldStatus | null>(null);
  readonly gem = signal<GemStatus | null>(null);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<GoldStatus>('/api/investments/gold').subscribe((g) => this.gold.set(g));
    this.api.get<GemStatus>('/api/investments/gem').subscribe({
      next: (g) => this.gem.set(g),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }
}
