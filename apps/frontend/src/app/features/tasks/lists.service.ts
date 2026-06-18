import { Injectable, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ListItem, ListWithItems } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class ListsService {
  private api = inject(ApiService);

  readonly lists = signal<ListWithItems[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<ListWithItems[]>('/api/lists').subscribe({
      next: (l) => { this.lists.set(l); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  create(title: string, type: 'list' | 'note' = 'list', content?: string): void {
    this.api.post<ListWithItems>('/api/lists', { title, type, content }).subscribe((l) => {
      this.lists.update((all) => [...all, l]);
    });
  }

  updateContent(listId: string, content: string): void {
    this.api.patch(`/api/lists/${listId}`, { content }).subscribe(() => {
      this.lists.update((all) =>
        all.map((l) => (l.id === listId ? { ...l, content } : l)),
      );
    });
  }

  delete(id: string): void {
    this.api.delete(`/api/lists/${id}`).subscribe(() => {
      this.lists.update((all) => all.filter((l) => l.id !== id));
    });
  }

  reorder(ids: string[]): void {
    this.api.patch('/api/lists/reorder', { ids }).subscribe();
  }

  addItem(listId: string, text: string): Observable<ListItem> {
    return this.api.post<ListItem>(`/api/lists/${listId}/items`, { text });
  }

  toggleItem(listId: string, item: ListItem): void {
    const next = !item.checked;
    this.api.patch(`/api/lists/${listId}/items/${item.id}`, { checked: next }).subscribe(() => {
      this.lists.update((all) =>
        all.map((l) =>
          l.id === listId
            ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, checked: next } : i)) }
            : l,
        ),
      );
    });
  }

  deleteItem(listId: string, itemId: string): void {
    this.api.delete(`/api/lists/${listId}/items/${itemId}`).subscribe(() => {
      this.lists.update((all) =>
        all.map((l) =>
          l.id === listId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l,
        ),
      );
    });
  }
}
