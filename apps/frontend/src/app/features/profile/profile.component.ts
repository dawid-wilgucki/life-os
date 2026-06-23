import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LifeProfile } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

interface Section {
  key: string;
  value: string;
}

const SECTION_META: Record<string, { label: string; emoji: string }> = {
  praca:    { label: 'Praca',    emoji: '💼' },
  dom:      { label: 'Dom',      emoji: '🏠' },
  cele:     { label: 'Cele',     emoji: '🎯' },
  zdrowie:  { label: 'Zdrowie',  emoji: '🏥' },
  relacje:  { label: 'Relacje',  emoji: '👥' },
  finanse:  { label: 'Finanse',  emoji: '💰' },
  projekty: { label: 'Projekty', emoji: '🚀' },
  inne:     { label: 'Inne',     emoji: '📝' },
};

function labelFor(key: string): string {
  return SECTION_META[key]?.label ?? key;
}
function emojiFor(key: string): string {
  return SECTION_META[key]?.emoji ?? '📌';
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, PageBackgroundComponent],
  template: `
    <app-page-background theme="habits" />
    <div class="relative mx-auto max-w-4xl p-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">👤 O mnie</h1>
          <p class="text-sm text-slate-400">Profil życiowy — asystent AI ma dostęp do tych informacji.</p>
        </div>
        @if (toast()) {
          <span class="rounded-lg bg-emerald-700/80 px-3 py-1.5 text-sm text-emerald-100">
            ✓ {{ toast() }}
          </span>
        }
      </div>

      @if (loading()) {
        <div class="mt-10 flex justify-center">
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
        </div>
      } @else {
        <!-- Desktop: 2 columns. Mobile: single column. -->
        <div class="mt-6 grid gap-4 lg:grid-cols-2">
          <!-- Left: section cards -->
          <div class="space-y-3">
            @for (s of sections(); track s.key) {
              <div
                class="lo-card p-4 cursor-pointer transition hover:border-indigo-500/30"
                [class.ring-1]="editingKey() === s.key"
                [class.ring-indigo-500]="editingKey() === s.key"
                (click)="startEdit(s)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <h3 class="flex items-center gap-2 text-sm font-medium">
                      <span>{{ emojiFor(s.key) }}</span>
                      <span>{{ labelFor(s.key) }}</span>
                      <span class="text-xs font-normal text-slate-500">({{ s.key }})</span>
                    </h3>
                    @if (s.value.trim()) {
                      <p class="mt-1.5 line-clamp-3 text-sm text-slate-300 leading-relaxed">{{ s.value }}</p>
                    } @else {
                      <p class="mt-1.5 text-sm text-slate-600 italic">Kliknij aby dodać...</p>
                    }
                  </div>
                  <div class="flex shrink-0 gap-1" (click)="$event.stopPropagation()">
                    <button
                      class="lo-btn-ghost px-2 py-1 text-xs"
                      title="Edytuj"
                      (click)="startEdit(s)"
                    >✏️</button>
                    <button
                      class="lo-btn-ghost px-2 py-1 text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300"
                      title="Usuń sekcję"
                      (click)="confirmDelete(s.key)"
                    >🗑</button>
                  </div>
                </div>
              </div>
            } @empty {
              <p class="text-slate-500 text-sm">Brak sekcji — dodaj pierwszą poniżej.</p>
            }

            <!-- Add new section -->
            <div class="lo-card p-4">
              @if (addingNew()) {
                <div class="flex flex-col gap-2">
                  <label class="text-xs text-slate-400">Klucz sekcji (snake_case, np. hobby)</label>
                  <input
                    class="lo-input"
                    placeholder="np. hobby, sport, nauka..."
                    [(ngModel)]="newKey"
                    name="newKey"
                    autocomplete="off"
                    (keydown.enter)="addSection()"
                    (keydown.escape)="addingNew.set(false)"
                  />
                  <div class="flex gap-2">
                    <button class="lo-btn flex-1 py-1.5" (click)="addSection()">Dodaj</button>
                    <button class="lo-btn-ghost border border-surface-700" (click)="addingNew.set(false)">Anuluj</button>
                  </div>
                </div>
              } @else {
                <button
                  class="lo-btn-ghost w-full justify-start gap-2 text-sm text-slate-400"
                  (click)="addingNew.set(true)"
                >
                  <span class="text-lg">+</span> Dodaj sekcję
                </button>
              }
            </div>
          </div>

          <!-- Right: editor panel -->
          <div>
            @if (editingKey(); as key) {
              <div class="lo-card sticky top-4 p-5">
                <div class="mb-3 flex items-center justify-between">
                  <h2 class="font-medium">
                    {{ emojiFor(key) }} Edytuj: <span class="text-indigo-400">{{ labelFor(key) }}</span>
                  </h2>
                  <button class="lo-btn-ghost px-2 py-1 text-xs" (click)="cancelEdit()">✕</button>
                </div>
                <textarea
                  class="lo-input min-h-[200px] resize-y font-normal leading-relaxed"
                  placeholder="Opisz aktualną sytuację w tej dziedzinie..."
                  [(ngModel)]="editValue"
                  name="editValue"
                ></textarea>
                <p class="mt-2 text-xs text-slate-500">
                  💡 Asystent AI ma dostęp do tej sekcji i personalizuje na jej podstawie odpowiedzi.
                </p>
                <div class="mt-3 flex gap-2">
                  <button
                    class="lo-btn flex-1 py-2"
                    [disabled]="saving()"
                    (click)="saveEdit()"
                  >{{ saving() ? 'Zapisuję…' : 'Zapisz' }}</button>
                  <button class="lo-btn-ghost border border-surface-700" (click)="cancelEdit()">Anuluj</button>
                </div>
              </div>
            } @else {
              <div class="lo-card p-6 text-center text-slate-500">
                <p class="text-3xl mb-2">👈</p>
                <p class="text-sm">Kliknij sekcję aby ją edytować.</p>
              </div>
            }
          </div>
        </div>
      }

      <!-- Delete confirmation modal -->
      @if (deletingKey()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          (click)="deletingKey.set(null)"
        >
          <div class="lo-card w-full max-w-sm p-5" (click)="$event.stopPropagation()">
            <h2 class="font-medium">Usuń sekcję</h2>
            <p class="mt-2 text-sm text-slate-400">
              Na pewno chcesz usunąć sekcję <strong>{{ emojiFor(deletingKey()!) }} {{ labelFor(deletingKey()!) }}</strong>?
              Tej operacji nie można cofnąć.
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button class="lo-btn-ghost border border-surface-700" (click)="deletingKey.set(null)">Anuluj</button>
              <button
                class="lo-btn bg-red-700 hover:brightness-110 py-2 px-4"
                (click)="deleteSection()"
              >Usuń</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProfileComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  saving = signal(false);
  toast = signal('');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private rawSections = signal<Record<string, string>>({});

  sections = computed<Section[]>(() =>
    Object.entries(this.rawSections()).map(([key, value]) => ({ key, value })),
  );

  editingKey = signal<string | null>(null);
  editValue = '';

  addingNew = signal(false);
  newKey = '';

  deletingKey = signal<string | null>(null);

  labelFor = labelFor;
  emojiFor = emojiFor;

  ngOnInit(): void {
    this.api.get<LifeProfile>('/api/profile').subscribe({
      next: (p) => {
        this.rawSections.set(p.sections ?? {});
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  startEdit(s: Section): void {
    this.editingKey.set(s.key);
    this.editValue = s.value;
  }

  cancelEdit(): void {
    this.editingKey.set(null);
    this.editValue = '';
  }

  saveEdit(): void {
    const key = this.editingKey();
    if (!key) return;
    this.saving.set(true);
    this.api.patch<LifeProfile>('/api/profile', { sections: { [key]: this.editValue } }).subscribe({
      next: (p) => {
        this.rawSections.set(p.sections);
        this.saving.set(false);
        this.cancelEdit();
        this.showToast('Zapisano');
      },
      error: () => this.saving.set(false),
    });
  }

  addSection(): void {
    const key = this.newKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    this.rawSections.update((s) => ({ ...s, [key]: '' }));
    this.newKey = '';
    this.addingNew.set(false);
    // Start editing the newly created section immediately.
    this.startEdit({ key, value: '' });
  }

  confirmDelete(key: string): void {
    this.deletingKey.set(key);
  }

  deleteSection(): void {
    const key = this.deletingKey();
    if (!key) return;
    this.api.delete(`/api/profile/section/${encodeURIComponent(key)}`).subscribe({
      next: () => {
        this.rawSections.update((s) => {
          const copy = { ...s };
          delete copy[key];
          return copy;
        });
        if (this.editingKey() === key) this.cancelEdit();
        this.deletingKey.set(null);
        this.showToast('Sekcja usunięta');
      },
    });
  }

  private showToast(msg: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set(msg);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2500);
  }
}
