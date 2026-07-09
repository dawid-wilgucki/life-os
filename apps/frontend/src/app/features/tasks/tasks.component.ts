import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ListItem, ListWithItems } from '@life-os/shared-types';
import { ListsService } from './lists.service';
import { AuthService } from '../../core/auth.service';

type CreateDialogState = { type: 'list' | 'note'; title: string; content: string } | null;

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="p-6">
      <!-- Header -->
      <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Listy</h1>
          <p class="text-sm text-slate-400">Twoje notatki i listy zadań.</p>
        </div>
        <div class="flex shrink-0 gap-2">
          <button class="lo-btn-ghost border border-surface-700" (click)="openCreateDialog('list')">+ Lista</button>
          <button class="lo-btn-ghost border border-surface-700" (click)="openCreateDialog('note')">+ Notatka</button>
        </div>
      </div>

      @if (svc.loadFailed()) {
        <p class="text-red-400">
          Nie udało się wczytać list. Spróbuj odświeżyć stronę.
        </p>
      } @else {
        @if (!svc.googleTasksSynced()) {
          <p class="mb-4 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
            ⚠️ Nie udało się zsynchronizować z Google Tasks — Twoje zadania z Google mogą tu chwilowo nie być widoczne.
            Spróbuj <button type="button" class="underline" (click)="reconnectGoogle()">połączyć konto Google ponownie</button>.
          </p>
        }

        @if (svc.loading()) {
          <p class="text-slate-400">Ładowanie…</p>
        } @else if (svc.lists().length === 0) {
          <p class="text-slate-400">Brak list. Utwórz pierwszą!</p>
        } @else {
        <!-- Card grid — Keep-style -->
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          @for (list of svc.lists(); track list.id; let idx = $index; let last = $last) {
            <div
              class="lo-card relative cursor-pointer select-none p-4 transition hover:ring-1 hover:ring-indigo-500"
              draggable="true"
              [class.opacity-40]="dragId() === list.id"
              [class.ring-2]="dragOverId() === list.id"
              [class.ring-indigo-400]="dragOverId() === list.id"
              (click)="openList(list)"
              (dragstart)="onDragStart($event, list.id)"
              (dragover)="onDragOver($event, list.id)"
              (dragleave)="onDragLeave(list.id)"
              (drop)="onDrop($event, list.id)"
              (dragend)="onDragEnd()"
            >
              <h3 class="mb-2 truncate pr-6 text-sm font-medium">
                @if (list.locked) { <span class="mr-1" title="Zsynchronizowane z Google Tasks">⛓️</span> }
                @if (list.pinned) { <span class="mr-1">📌</span> }
                {{ list.type === 'note' ? '📝 ' : '' }}{{ list.title }}
              </h3>

              <!-- Touch reorder (HTML5 drag&drop doesn't fire on touch) -->
              <div class="absolute right-1 top-1 flex lg:hidden">
                @if (idx > 0) {
                  <button
                    class="flex h-8 w-8 items-center justify-center text-slate-500"
                    (click)="move(list.id, -1); $event.stopPropagation()"
                    aria-label="Przesuń wcześniej"
                  >↑</button>
                }
                @if (!last) {
                  <button
                    class="flex h-8 w-8 items-center justify-center text-slate-500"
                    (click)="move(list.id, 1); $event.stopPropagation()"
                    aria-label="Przesuń dalej"
                  >↓</button>
                }
              </div>

              @if (list.type === 'note') {
                <p class="line-clamp-3 text-xs text-slate-400">{{ list.content || '(pusta notatka)' }}</p>
              } @else {
                <ul class="space-y-1">
                  @for (item of list.items.slice(0, 4); track item.id) {
                    <li
                      class="flex items-center gap-1.5 text-xs"
                      [class.line-through]="item.checked"
                      [class.text-slate-500]="item.checked"
                    >
                      <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        [class.bg-emerald-500]="item.checked"
                        [class.bg-slate-600]="!item.checked"
                      ></span>
                      {{ item.text }}
                    </li>
                  }
                  @if (list.items.length > 4) {
                    <li class="text-xs text-slate-600">+{{ list.items.length - 4 }} więcej…</li>
                  }
                  @if (list.items.length === 0) {
                    <li class="text-xs text-slate-600">Lista pusta.</li>
                  }
                </ul>
              }
            </div>
          }
        </div>
        }
      }

      <!-- View/edit modal -->
      @if (selectedList(); as sel) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          (click)="closeList()"
        >
          <div
            class="lo-card flex w-full max-w-md flex-col p-6"
            style="max-height: 80dvh"
            (click)="$event.stopPropagation()"
          >
            <header class="mb-4 flex items-center justify-between gap-2">
              <h2 class="truncate text-lg font-medium">{{ sel.title }}</h2>
              <div class="flex shrink-0 items-center gap-2">
                @if (sel.locked) {
                  <span class="text-xs text-slate-500" title="Lista zsynchronizowana z Google Tasks — nie można jej usunąć">⛓️ Google Tasks</span>
                } @else {
                  <button
                    class="lo-btn-ghost text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300"
                    (click)="deleteList(sel.id)"
                  >🗑 Usuń</button>
                }
                <button class="lo-btn-ghost px-3 py-2 text-sm" (click)="closeList()" aria-label="Zamknij">✕</button>
              </div>
            </header>

            @if (sel.type === 'note') {
              <textarea
                class="lo-input flex-1 resize-none text-sm"
                rows="10"
                [value]="sel.content ?? ''"
                placeholder="Treść notatki…"
                (blur)="onNoteBlur($event)"
              ></textarea>
            } @else {
              <!-- List items -->
              <ul class="flex-1 space-y-1 overflow-y-auto">
                @for (item of sel.items; track item.id) {
                  <li class="flex items-center gap-1">
                    <button
                      class="flex h-9 w-9 shrink-0 items-center justify-center"
                      (click)="toggleItem(item)"
                      [attr.aria-label]="item.checked ? 'Odznacz' : 'Odhacz'"
                    >
                      <span
                        class="flex h-5 w-5 items-center justify-center rounded border transition"
                        [class.border-emerald-500]="item.checked"
                        [class.bg-emerald-500]="item.checked"
                        [class.border-surface-600]="!item.checked"
                      >
                        @if (item.checked) {
                          <span class="text-[10px] text-white">✓</span>
                        }
                      </span>
                    </button>
                    <span
                      class="min-w-0 flex-1 break-words text-sm"
                      [class.line-through]="item.checked"
                      [class.text-slate-500]="item.checked"
                    >{{ item.text }}</span>
                    <button
                      class="flex h-9 w-9 shrink-0 items-center justify-center text-slate-500 transition hover:text-red-400"
                      (click)="deleteItem(item.id)"
                      aria-label="Usuń pozycję"
                    >✕</button>
                  </li>
                } @empty {
                  <li class="text-sm text-slate-500">Lista pusta.</li>
                }
              </ul>

              <!-- Add item -->
              <form
                class="mt-3 flex gap-2 border-t border-surface-800 pt-3"
                (ngSubmit)="addItemToSelected()"
              >
                <input
                  class="lo-input text-sm"
                  placeholder="Dodaj pozycję…"
                  [(ngModel)]="newItemText"
                  name="new-item"
                  autocomplete="off"
                />
                <button type="submit" class="lo-btn shrink-0 px-4 text-sm">+</button>
              </form>
            }
          </div>
        </div>
      }

      <!-- Create dialog -->
      @if (createDialog()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          (click)="closeCreateDialog()"
        >
          <div
            class="lo-card w-full max-w-sm p-6"
            (click)="$event.stopPropagation()"
          >
            <h2 class="mb-4 text-lg font-medium">
              {{ createDialog()!.type === 'note' ? '📝 Nowa notatka' : '📋 Nowa lista' }}
            </h2>
            <input
              class="lo-input mb-3"
              placeholder="Tytuł…"
              [(ngModel)]="createDialog()!.title"
              name="create-title"
              autofocus
            />
            @if (createDialog()!.type === 'note') {
              <textarea
                class="lo-input mb-3 resize-none"
                rows="4"
                placeholder="Treść (opcjonalnie)…"
                [(ngModel)]="createDialog()!.content"
                name="create-content"
              ></textarea>
            }
            <div class="flex justify-end gap-2">
              <button class="lo-btn-ghost" (click)="closeCreateDialog()">Anuluj</button>
              <button class="lo-btn px-4" (click)="confirmCreate()">Utwórz</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class TasksComponent implements OnInit {
  svc = inject(ListsService);
  private auth = inject(AuthService);

  private selectedId = signal<string | null>(null);
  /** The open list, always read from the service so optimistic updates/rollbacks show. */
  selectedList = computed<ListWithItems | null>(() => {
    const id = this.selectedId();
    return id ? (this.svc.lists().find((l) => l.id === id) ?? null) : null;
  });

  newItemText = '';
  dragId = signal<string | null>(null);
  dragOverId = signal<string | null>(null);
  createDialog = signal<CreateDialogState>(null);

  ngOnInit(): void {
    this.svc.load();
  }

  reconnectGoogle(): void {
    this.auth.login();
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.createDialog()) this.closeCreateDialog();
    else if (this.selectedId()) this.closeList();
  }

  // ── View modal ────────────────────────────────────────────────────────────

  openList(list: ListWithItems): void {
    this.selectedId.set(list.id);
  }

  closeList(): void {
    this.selectedId.set(null);
    this.newItemText = '';
  }

  deleteList(id: string): void {
    this.svc.delete(id);
    this.closeList();
  }

  addItemToSelected(): void {
    const text = this.newItemText.trim();
    const list = this.selectedList();
    if (!text || !list) return;
    this.svc.addItem(list.id, text);
    this.newItemText = '';
  }

  toggleItem(item: ListItem): void {
    const list = this.selectedList();
    if (list) this.svc.toggleItem(list.id, item);
  }

  deleteItem(itemId: string): void {
    const list = this.selectedList();
    if (list) this.svc.deleteItem(list.id, itemId);
  }

  onNoteBlur(event: Event): void {
    const list = this.selectedList();
    if (!list) return;
    this.svc.updateContent(list.id, (event.target as HTMLTextAreaElement).value);
  }

  // ── Create dialog ─────────────────────────────────────────────────────────

  openCreateDialog(type: 'list' | 'note'): void {
    this.createDialog.set({ type, title: '', content: '' });
  }

  closeCreateDialog(): void {
    this.createDialog.set(null);
  }

  confirmCreate(): void {
    const d = this.createDialog();
    if (!d?.title.trim()) return;
    this.svc.create(d.title.trim(), d.type, d.type === 'note' ? d.content : undefined);
    this.closeCreateDialog();
  }

  // ── Reorder: drag on desktop, ↑/↓ buttons on touch ───────────────────────

  move(id: string, delta: number): void {
    const current = [...this.svc.lists()];
    const from = current.findIndex((l) => l.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= current.length) return;
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    this.svc.lists.set(current);
    this.svc.reorder(current.map((l) => l.id));
  }

  onDragStart(event: DragEvent, id: string): void {
    this.dragId.set(id);
    event.dataTransfer?.setData('text/plain', id);
  }

  onDragOver(event: DragEvent, id: string): void {
    event.preventDefault();
    if (id !== this.dragId()) this.dragOverId.set(id);
  }

  onDragLeave(id: string): void {
    if (this.dragOverId() === id) this.dragOverId.set(null);
  }

  onDrop(event: DragEvent, targetId: string): void {
    event.preventDefault();
    const sourceId = this.dragId();
    if (!sourceId || sourceId === targetId) { this.onDragEnd(); return; }

    const current = [...this.svc.lists()];
    const from = current.findIndex((l) => l.id === sourceId);
    const to = current.findIndex((l) => l.id === targetId);
    if (from === -1 || to === -1) { this.onDragEnd(); return; }

    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    this.svc.lists.set(current);
    this.svc.reorder(current.map((l) => l.id));
    this.onDragEnd();
  }

  onDragEnd(): void {
    this.dragId.set(null);
    this.dragOverId.set(null);
  }
}
