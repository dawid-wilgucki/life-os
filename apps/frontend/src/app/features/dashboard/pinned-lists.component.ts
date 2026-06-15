import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ListWithItems } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-pinned-lists',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    @for (list of lists(); track list.id) {
      <section class="lo-card flex flex-col p-4">
        <header class="mb-3 flex items-center justify-between">
          <h2 class="font-medium">📋 {{ list.title }}</h2>
          <span class="text-xs text-slate-500">
            {{ checkedCount(list) }}/{{ list.items.length }}
          </span>
        </header>

        <ul class="flex-1 space-y-1.5 overflow-y-auto">
          @for (item of list.items; track item.id) {
            <li class="flex items-center gap-2">
              <button
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition"
                [class.border-emerald-500]="item.checked"
                [class.bg-emerald-500]="item.checked"
                [class.border-surface-600]="!item.checked"
                (click)="toggle(list, item)"
              >
                @if (item.checked) { <span class="text-[10px] text-white">✓</span> }
              </button>
              <span
                class="flex-1 text-sm"
                [class.line-through]="item.checked"
                [class.text-slate-500]="item.checked"
              >{{ item.text }}</span>
              <button
                class="shrink-0 text-slate-700 transition hover:text-red-400"
                (click)="deleteItem(list, item.id)"
              >✕</button>
            </li>
          } @empty {
            <li class="text-sm text-slate-600">Lista pusta.</li>
          }
        </ul>

        <form class="mt-3 flex gap-2 border-t border-surface-800 pt-3" (ngSubmit)="addItem(list)">
          <input
            class="lo-input text-sm"
            placeholder="Dodaj pozycję…"
            [(ngModel)]="newItem[list.id]"
            [name]="'item-' + list.id"
            autocomplete="off"
          />
          <button type="submit" class="lo-btn shrink-0 px-3 text-sm">+</button>
        </form>
      </section>
    } @empty {
      @if (!loading()) {
        <section class="lo-card col-span-2 p-4">
          <p class="text-sm text-slate-500">
            Brak przypiętych list. Utwórz je na stronie list lub w bazie.
          </p>
        </section>
      }
    }
  `,
})
export class PinnedListsComponent implements OnInit {
  private api = inject(ApiService);

  lists = signal<ListWithItems[]>([]);
  loading = signal(false);
  newItem: Record<string, string> = {};

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.get<ListWithItems[]>('/api/lists').subscribe({
      next: (all) => this.lists.set(all.filter((l) => l.pinned).slice(0, 2)),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  checkedCount(list: ListWithItems): number {
    return list.items.filter((i) => i.checked).length;
  }

  toggle(list: ListWithItems, item: ListWithItems['items'][number]): void {
    const next = !item.checked;
    this.api
      .patch(`/api/lists/${list.id}/items/${item.id}`, { checked: next })
      .subscribe(() => {
        this.lists.update((all) =>
          all.map((l) =>
            l.id === list.id
              ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, checked: next } : i)) }
              : l,
          ),
        );
      });
  }

  addItem(list: ListWithItems): void {
    const text = (this.newItem[list.id] ?? '').trim();
    if (!text) return;
    this.api
      .post<ListWithItems['items'][number]>(`/api/lists/${list.id}/items`, { text })
      .subscribe((item) => {
        this.lists.update((all) =>
          all.map((l) => (l.id === list.id ? { ...l, items: [...l.items, item] } : l)),
        );
        this.newItem[list.id] = '';
      });
  }

  deleteItem(list: ListWithItems, itemId: string): void {
    this.api.delete(`/api/lists/${list.id}/items/${itemId}`).subscribe(() => {
      this.lists.update((all) =>
        all.map((l) =>
          l.id === list.id ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l,
        ),
      );
    });
  }
}
