import { Injectable, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CreateShellyDeviceInput,
  CreateShellyPeriodInput,
  ShellyOverview,
  ShellyRange,
  ShellySeries,
  UpdateShellyDeviceInput,
} from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';

/** Shelly devices: overview (state + alerts), per-device series and settings. */
@Injectable({ providedIn: 'root' })
export class DevicesService {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly overview = signal<ShellyOverview | null>(null);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);

  load(): void {
    this.loading.set(true);
    this.api.get<ShellyOverview>('/api/shelly/overview').subscribe({
      next: (o) => {
        this.overview.set(o);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.detail ?? e?.error?.error ?? 'Nie udało się pobrać urządzeń');
        this.loading.set(false);
      },
    });
  }

  /** Ask the Worker to poll Shelly Cloud right now. */
  refresh(): void {
    this.refreshing.set(true);
    this.api.post<ShellyOverview>('/api/shelly/refresh').subscribe({
      next: (o) => {
        this.overview.set(o);
        this.error.set(null);
        this.refreshing.set(false);
      },
      error: () => {
        this.toast.error('Odświeżenie nie powiodło się');
        this.refreshing.set(false);
      },
    });
  }

  series(deviceId: string, range: ShellyRange): Observable<ShellySeries> {
    return this.api.get<ShellySeries>(`/api/shelly/devices/${deviceId}/series`, { range });
  }

  addDevice(input: CreateShellyDeviceInput, done?: () => void): void {
    this.api.post<{ id: string; detected: boolean }>('/api/shelly/devices', input).subscribe({
      next: (r) => {
        this.toast.success(
          r.detected ? 'Dodano urządzenie (parametry wykryte z chmury)' : 'Dodano urządzenie — parametry uzupełnią się, gdy będzie online',
        );
        done?.();
        this.load();
      },
      error: (e) => {
        const code = e?.error?.error;
        this.toast.error(
          code === 'already_exists' ? 'To urządzenie już jest na liście' : code === 'bad_id' ? 'Nieprawidłowe ID urządzenia' : 'Nie udało się dodać urządzenia',
        );
      },
    });
  }

  updateDevice(id: string, patch: UpdateShellyDeviceInput, done?: () => void): void {
    this.api.patch<void>(`/api/shelly/devices/${id}`, patch).subscribe({
      next: () => {
        this.toast.success('Zapisano');
        done?.();
        this.load();
      },
      error: () => this.toast.error('Nie udało się zapisać'),
    });
  }

  deleteDevice(id: string): void {
    this.api.delete<void>(`/api/shelly/devices/${id}`).subscribe({
      next: () => this.load(),
      error: () => this.toast.error('Nie udało się usunąć urządzenia'),
    });
  }

  addPeriod(deviceId: string, input: CreateShellyPeriodInput, done?: () => void): void {
    this.api.post<{ id: string }>(`/api/shelly/devices/${deviceId}/periods`, input).subscribe({
      next: () => {
        done?.();
        this.load();
      },
      error: (e) => this.toast.error(e?.error?.error === 'bad_dates' ? 'Nieprawidłowe daty okresu' : 'Nie udało się dodać okresu'),
    });
  }

  deletePeriod(periodId: string): void {
    this.api.delete<void>(`/api/shelly/periods/${periodId}`).subscribe({
      next: () => this.load(),
      error: () => this.toast.error('Nie udało się usunąć okresu'),
    });
  }
}
