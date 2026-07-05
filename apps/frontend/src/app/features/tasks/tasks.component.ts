import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Listy</h1>
          <p class="text-sm text-slate-400">Twoje notatki i listy zadań.</p>
        </div>
        <div class="flex gap-2">
          <button class="lo-btn-ghost" (click)="openCreateDialog('list')">+ Nowa lista</button>
          <button class="lo-btn-ghost" (click)="openCreateDialog('note')">+ Nowa notatka</button>
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
          @for (list of svc.lists(); track list.id) {
            <div
              class="lo-card cursor-pointer select-none p-4 transition hover:ring-1 hover:ring-indigo-500"
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
              <h3 class="mb-2 truncate text-sm font-medium">
                @if (list.locked) { <span class="mr-1" title="Zsynchronizowane z Google Tasks">⛓️</span> }
                @if (list.pinned) { <span class="mr-1">📌</span> }
                {{ list.type === 'note' ? '📝 ' : '' }}{{ list.title }}
              </h3>

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
      @if (selectedList()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          (click)="closeList()"
        >
          <div
            class="lo-card flex w-full max-w-md flex-col p-6"
            style="max-height: 80vh"
            (click)="$event.stopPropagation()"
          >
            <header class="mb-4 flex items-center justify-between gap-2">
              <h2 class="truncate text-lg font-medium">{{ selectedList()!.title }}</h2>
              <div class="flex shrink-0 items-center gap-2">
                @if (selectedList()!.locked) {
                  <span class="text-xs text-slate-500" title="Lista zsynchronizowana z Google Tasks — nie można jej usunąć">⛓️ Google Tasks</span>
                } @else {
                  <button
                    class="lo-btn-ghost text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300"
                    (click)="deleteList(selectedList()!.id)"
                  >🗑 Usuń</button>
                }
                <button class="lo-btn-ghost text-xs" (click)="closeList()">✕</button>
              </div>
            </header>

            @if (selectedList()!.type === 'note') {
              <textarea
                class="lo-input flex-1 resize-none text-sm"
                rows="10"
                [value]="selectedList()!.content ?? ''"
                placeholder="Treść notatki…"
                (blur)="onNoteBlur($event)"
              ></textarea>
            } @else {
              <!-- List items -->
              <ul class="flex-1 space-y-2 overflow-y-auto">
                @for (item of selectedList()!.items; track item.id) {
                  <li class="group flex items-center gap-2">
                    <button
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition"
                      [class.border-emerald-500]="item.checked"
                      [class.bg-emerald-500]="item.checked"
                      [class.border-surface-600]="!item.checked"
                      (click)="toggleItem(item)"
                    >
                      @if (item.checked) {
                        <span class="text-[10px] text-white">✓</span>
                      }
                    </button>
                    <span
                      class="flex-1 text-sm"
                      [class.line-through]="item.checked"
                      [class.text-slate-500]="item.checked"
                    >{{ item.text }}</span>
                    <button
                      class="invisible text-slate-600 transition hover:text-red-400 group-hover:visible"
                      (click)="deleteItem(item.id)"
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
                <button type="submit" class="lo-btn shrink-0 px-3 text-sm">+</button>
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

  selectedList = signal<ListWithItems | null>(null);
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

  // ── View modal ────────────────────────────────────────────────────────────

  openList(list: ListWithItems): void {
    this.selectedList.set({ ...list });
  }

  closeList(): void {
    this.selectedList.set(null);
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
    this.svc.addItem(list.id, text).subscribe((item) => {
      this.selectedList.update((l) => l ? { ...l, items: [...l.items, item] } : l);
      this.svc.lists.update((all) =>
        all.map((l) => (l.id === list.id ? { ...l, items: [...l.items, item] } : l)),
      );
    });
    this.newItemText = '';
  }

  toggleItem(item: ListItem): void {
    const list = this.selectedList();
    if (!list) return;
    this.svc.toggleItem(list.id, item);
    const next = !item.checked;
    this.selectedList.update((l) =>
      l ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, checked: next } : i)) } : l,
    );
  }

  deleteItem(itemId: string): void {
    const list = this.selectedList();
    if (!list) return;
    this.svc.deleteItem(list.id, itemId);
    this.selectedList.update((l) => l ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l);
  }

  onNoteBlur(event: Event): void {
    const list = this.selectedList();
    if (!list) return;
    const content = (event.target as HTMLTextAreaElement).value;
    this.svc.updateContent(list.id, content);
    this.selectedList.update((l) => l ? { ...l, content } : l);
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

  // ── Drag-to-reorder (HTML5 DnD) ───────────────────────────────────────────

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

  // Computed for template — unused direct computed, keep as method for clarity
  checkedCount = computed(() => {
    const l = this.selectedList();
    return l ? l.items.filter((i) => i.checked).length : 0;
  });
}
