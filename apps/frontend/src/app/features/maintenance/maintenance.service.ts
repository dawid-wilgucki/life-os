import { Injectable, inject, signal } from '@angular/core';
import type { CreateMaintenanceInput, MaintenanceItem } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class MaintenanceService {
  private api = inject(ApiService);

  readonly items = signal<MaintenanceItem[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<MaintenanceItem[]>('/api/maintenance').subscribe({
      next: (i) => this.items.set(i),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  add(input: CreateMaintenanceInput): void {
    this.api.post<MaintenanceItem>('/api/maintenance', input).subscribe((item) => {
      this.items.update((list) => [...list, item].sort((a, b) => a.nextDue.localeCompare(b.nextDue)));
    });
  }

  markDone(id: string): void {
    this.api.patch<MaintenanceItem>(`/api/maintenance/${id}`, {}).subscribe((updated) => {
      this.items.update((list) =>
        list.map((i) => (i.id === updated.id ? updated : i)).sort((a, b) => a.nextDue.localeCompare(b.nextDue)),
      );
    });
  }
}
