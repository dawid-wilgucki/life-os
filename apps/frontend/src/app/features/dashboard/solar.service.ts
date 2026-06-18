import { Injectable, inject, signal } from '@angular/core';
import type { SolarCurrentData, SolarStatus, SolarTokenRefreshResult } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class SolarService {
  // Goes through ApiService so the JWT interceptor attaches the session token.
  private api = inject(ApiService);

  readonly powerNow = signal<number | null>(null);
  readonly energyToday = signal<number | null>(null);
  readonly energyTotal = signal<number | null>(null);
  readonly status = signal<SolarStatus>('unknown');
  readonly temperature = signal<number | null>(null);
  readonly pvPower = signal<number | null>(null);
  readonly tokenRefreshing = signal(false);
  readonly lastError = signal<string | null>(null);

  load(): void {
    this.api.get<SolarCurrentData>('/api/solar/current').subscribe({
      next: (r) => {
        this.powerNow.set(r.powerNow);
        this.energyToday.set(r.energyToday);
        this.energyTotal.set(r.energyTotal);
        this.status.set(r.status);
        this.temperature.set(r.temperature);
        this.pvPower.set(r.pvPower);
        this.lastError.set(null);
      },
      error: (e) => {
        // Solarman unavailable / not configured — hide the PV section.
        this.status.set('unknown');
        this.lastError.set(e?.error?.error ?? 'solarman_unavailable');
      },
    });
  }

  refreshToken(): void {
    this.tokenRefreshing.set(true);
    this.lastError.set(null);
    this.api.get<SolarTokenRefreshResult>('/api/solar/token/refresh').subscribe({
      next: (r) => {
        if (!r.success) this.lastError.set('token_refresh_failed');
        this.load();
      },
      error: () => {
        this.lastError.set('token_refresh_failed');
      },
      complete: () => this.tokenRefreshing.set(false),
    });
  }
}
