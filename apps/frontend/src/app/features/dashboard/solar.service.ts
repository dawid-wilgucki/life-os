import { Injectable, inject, signal } from '@angular/core';
import type { SolarData } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class SolarService {
  // Goes through ApiService so the JWT interceptor attaches the session token.
  private api = inject(ApiService);

  readonly powerNow = signal<number | null>(null);
  readonly energyToday = signal<number | null>(null);
  readonly energyTotal = signal<number | null>(null);
  readonly status = signal<'online' | 'offline' | 'alarm' | 'unknown'>('unknown');
  readonly updatedAt = signal<string | null>(null);

  load(): void {
    this.api.get<SolarData>('/api/solar/current').subscribe({
      next: (r) => {
        this.powerNow.set(r.powerNow);
        this.energyToday.set(r.energyToday);
        this.energyTotal.set(r.energyTotal);
        this.status.set(r.status);
        this.updatedAt.set(r.updatedAt);
      },
      error: () => {
        // Solarman unavailable / not configured — hide the PV section.
        this.status.set('unknown');
      },
    });
  }
}
