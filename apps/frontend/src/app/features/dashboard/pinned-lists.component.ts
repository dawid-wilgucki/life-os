import { Component, OnInit, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ListWithItems } from '@life-os/shared-types';
import { ListsService } from '../tasks/lists.service';

@Component({
  selector: 'app-pinned-lists',
  standalone: true,
  imports: [FormsModule],
  template: `
    @for (list of lists(); track list.id) {
      <section class="lo-card flex min-w-0 max-w-full flex-col p-4">
        <header class="mb-3 flex items-center justify-between gap-2">
          <h2 class="min-w-0 truncate font-medium">📋 {{ list.title }}</h2>
          <span class="shrink-0 text-xs text-slate-500">
            {{ checkedCount(list) }}/{{ list.items.length }}
          </span>
        </header>

        <ul class="flex-1 space-y-1.5 overflow-y-auto">
          @for (item of list.items; track item.id) {
            <li class="flex min-w-0 items-center gap-1">
              <button
                class="flex h-9 w-9 shrink-0 items-center justify-center"
                (click)="svc.toggleItem(list.id, item)"
                [attr.aria-label]="item.checked ? 'Odznacz' : 'Odhacz'"
              >
                <span
                  class="flex h-5 w-5 items-center justify-center rounded border transition"
                  [class.border-emerald-500]="item.checked"
                  [class.bg-emerald-500]="item.checked"
                  [class.border-surface-600]="!item.checked"
                >
                  @if (item.checked) { <span class="text-[10px] text-white">✓</span> }
                </span>
              </button>
              <span
                class="min-w-0 flex-1 break-words text-sm"
                [class.line-through]="item.checked"
                [class.text-slate-500]="item.checked"
              >{{ item.text }}</span>
              <button
                class="flex h-9 w-9 shrink-0 items-center justify-center text-slate-500 transition hover:text-red-400"
                (click)="svc.deleteItem(list.id, item.id)"
                aria-label="Usuń pozycję"
              >✕</button>
            </li>
          } @empty {
            <li class="text-sm text-slate-600">Lista pusta.</li>
          }
        </ul>

        <form class="mt-3 flex min-w-0 gap-2 border-t border-surface-800 pt-3" (ngSubmit)="addItem(list)">
          <input
            class="lo-input min-w-0 text-sm"
            placeholder="Dodaj pozycję…"
            [(ngModel)]="newItem[list.id]"
            [name]="'item-' + list.id"
            autocomplete="off"
          />
          <button type="submit" class="lo-btn shrink-0 px-3 text-sm">+</button>
        </form>
      </section>
    } @empty {
      @if (!svc.loading()) {
        <section class="lo-card col-span-2 p-4">
          <p class="text-sm text-slate-500">
            Brak przypiętych list. Przypnij je na stronie list.
          </p>
        </section>
      }
    }
  `,
})
export class PinnedListsComponent implements OnInit {
  svc = inject(ListsService);

  /** Up to two pinned checklists (notes have no items to tick off). */
  lists = computed<ListWithItems[]>(() =>
    this.svc.lists().filter((l) => l.pinned && l.type === 'list').slice(0, 2),
  );

  newItem: Record<string, string> = {};

  ngOnInit(): void {
    // The dashboard already triggers a load; only fetch when landing here cold.
    if (!this.svc.lists().length && !this.svc.loading()) this.svc.load();
  }

  checkedCount(list: ListWithItems): number {
    return list.items.filter((i) => i.checked).length;
  }

  addItem(list: ListWithItems): void {
    const text = (this.newItem[list.id] ?? '').trim();
    if (!text) return;
    this.svc.addItem(list.id, text);
    this.newItem[list.id] = '';
  }
}
