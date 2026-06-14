import { Injectable, inject, signal } from '@angular/core';
import type { InboxItem } from '@life-os/shared-types';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class InboxService {
  private api = inject(ApiService);

  readonly items = signal<InboxItem[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<InboxItem[]>('/api/inbox').subscribe({
      next: (items) => this.items.set(items),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  add(text: string): void {
    this.api.post<InboxItem>('/api/inbox', { text }).subscribe((item) => {
      this.items.update((list) => [item, ...list]);
    });
  }

  archive(id: string): Observable<unknown> {
    return this.api.patch(`/api/inbox/${id}`, { action: 'archive' });
  }

  convertTask(id: string, listId: string): Observable<unknown> {
    return this.api.patch(`/api/inbox/${id}`, { action: 'convert_task', listId });
  }

  convertEvent(id: string, start: string, end: string): Observable<unknown> {
    return this.api.patch(`/api/inbox/${id}`, { action: 'convert_event', start, end });
  }

  removeLocal(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }
}
