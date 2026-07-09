import { Injectable, inject, signal } from '@angular/core';
import type { ListItem, ListWithItems } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';

@Injectable({ providedIn: 'root' })
export class ListsService {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly lists = signal<ListWithItems[]>([]);
  readonly loading = signal(false);
  /** False when the last load couldn't reach Google Tasks (expired/revoked auth). */
  readonly googleTasksSynced = signal(true);
  /** True when the last load failed outright (network/server error). */
  readonly loadFailed = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<{ lists: ListWithItems[]; googleTasksSynced: boolean }>('/api/lists').subscribe({
      next: (res) => {
        this.lists.set(res.lists);
        this.googleTasksSynced.set(res.googleTasksSynced);
        this.loadFailed.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  create(title: string, type: 'list' | 'note' = 'list', content?: string): void {
    this.api.post<ListWithItems>('/api/lists', { title, type, content }).subscribe({
      next: (l) => this.lists.update((all) => [...all, l]),
      error: () => this.toast.error('Nie udało się utworzyć listy.'),
    });
  }

  updateContent(listId: string, content: string): void {
    const prev = this.lists().find((l) => l.id === listId)?.content;
    this.lists.update((all) => all.map((l) => (l.id === listId ? { ...l, content } : l)));
    this.api.patch(`/api/lists/${listId}`, { content }).subscribe({
      error: () => {
        this.lists.update((all) => all.map((l) => (l.id === listId ? { ...l, content: prev } : l)));
        this.toast.error('Nie udało się zapisać notatki.');
      },
    });
  }

  delete(id: string): void {
    const prev = this.lists();
    this.lists.update((all) => all.filter((l) => l.id !== id));
    this.api.delete(`/api/lists/${id}`).subscribe({
      error: () => {
        this.lists.set(prev);
        this.toast.error('Nie udało się usunąć listy.');
      },
    });
  }

  reorder(ids: string[]): void {
    this.api.patch('/api/lists/reorder', { ids }).subscribe({
      error: () => this.toast.error('Nie udało się zapisać kolejności.'),
    });
  }

  addItem(listId: string, text: string): void {
    this.api.post<ListItem>(`/api/lists/${listId}/items`, { text }).subscribe({
      next: (item) =>
        this.lists.update((all) =>
          all.map((l) => (l.id === listId ? { ...l, items: [...l.items, item] } : l)),
        ),
      error: () => this.toast.error('Nie udało się dodać pozycji.'),
    });
  }

  toggleItem(listId: string, item: ListItem): void {
    const next = !item.checked;
    this.setItemChecked(listId, item.id, next);
    this.api.patch(`/api/lists/${listId}/items/${item.id}`, { checked: next }).subscribe({
      error: () => {
        this.setItemChecked(listId, item.id, !next);
        this.toast.error('Nie udało się zapisać zmiany.');
      },
    });
  }

  deleteItem(listId: string, itemId: string): void {
    const prev = this.lists();
    this.lists.update((all) =>
      all.map((l) =>
        l.id === listId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l,
      ),
    );
    this.api.delete(`/api/lists/${listId}/items/${itemId}`).subscribe({
      error: () => {
        this.lists.set(prev);
        this.toast.error('Nie udało się usunąć pozycji.');
      },
    });
  }

  private setItemChecked(listId: string, itemId: string, checked: boolean): void {
    this.lists.update((all) =>
      all.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, checked } : i)) }
          : l,
      ),
    );
  }
}
