import { Component, OnInit, inject, signal } from '@angular/core';
import type { WardrobeItem, WardrobeSection } from '@life-os/shared-types';
import { WardrobeService } from './wardrobe.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

@Component({
  selector: 'app-wardrobe',
  standalone: true,
  imports: [PageBackgroundComponent],
  template: `
    <app-page-background theme="wardrobe" />
    <div class="relative mx-auto max-w-6xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Wardrobe</h1>
        <div class="flex items-center gap-2">
          <button class="lo-btn-ghost text-sm" [disabled]="wardrobe.saving()" (click)="toggleAddForm()">
            {{ showAddForm() ? '✕ Anuluj' : '+ Dodaj ubranie' }}
          </button>
          <button class="lo-btn-ghost" [disabled]="wardrobe.loading()" (click)="wardrobe.load()">↻</button>
        </div>
      </div>

      @if (showAddForm()) {
        <div class="lo-card mb-4 flex flex-wrap items-end gap-3 p-4">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-400">Sekcja</label>
            <select
              class="rounded border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm text-slate-100"
              [value]="addSection()"
              (change)="addSection.set($any($event.target).value)"
            >
              @for (s of sections; track s.key) {
                <option [value]="s.key">{{ s.label }}</option>
              }
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-400">Nazwa</label>
            <input
              class="rounded border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
              placeholder="np. Biała koszula Oxford"
              [value]="addNazwa()"
              (input)="addNazwa.set($any($event.target).value)"
              (keydown.enter)="submitAdd()"
            />
          </div>
          <button
            class="lo-btn-ghost px-3 py-1.5 text-sm"
            [disabled]="!addNazwa().trim() || wardrobe.saving()"
            (click)="submitAdd()"
          >
            {{ wardrobe.saving() ? '…' : 'Dodaj' }}
          </button>
        </div>
      }

      @if (wardrobe.loading()) {
        <p class="text-slate-400">Ładowanie…</p>
      }
      @if (wardrobe.error(); as err) {
        <div class="lo-card border-red-500/40 p-4 text-sm text-red-300">{{ err }}</div>
      }

      @for (section of sections; track section.key) {
        @if (items(section.key).length || showAddForm()) {
          <section class="mt-6">
            <h2 class="mb-3 text-lg font-medium">{{ section.label }}</h2>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              @for (item of items(section.key); track item.id; let idx = $index) {
                <div class="lo-card group relative overflow-hidden">
                  <!-- Delete button -->
                  <button
                    class="absolute right-1 top-1 z-10 hidden h-5 w-5 items-center justify-center rounded bg-red-900/70 text-[10px] text-red-300 hover:bg-red-700 group-hover:flex"
                    [disabled]="wardrobe.saving()"
                    (click)="deleteItem(section.key, idx)"
                    title="Usuń"
                  >
                    ×
                  </button>

                  <!-- Photo -->
                  <div class="aspect-square bg-surface-800">
                    @if (item.photoUrl) {
                      <img
                        [src]="item.photoUrl"
                        [alt]="item.nazwa"
                        loading="lazy"
                        class="h-full w-full object-cover"
                      />
                    } @else {
                      <div class="flex h-full items-center justify-center text-3xl">👕</div>
                    }
                  </div>

                  <!-- Name — click to edit inline -->
                  @if (editingItemId() === item.id) {
                    <div class="px-1 py-1">
                      <input
                        class="w-full rounded border border-indigo-500 bg-surface-800 px-1.5 py-0.5 text-xs text-slate-100 outline-none"
                        [value]="editingNazwa()"
                        (input)="editingNazwa.set($any($event.target).value)"
                        (keydown.enter)="saveEdit(section.key, idx)"
                        (keydown.escape)="cancelEdit()"
                        (blur)="saveEdit(section.key, idx)"
                      />
                    </div>
                  } @else {
                    <div
                      class="cursor-text truncate px-2 py-1.5 text-xs hover:text-indigo-300"
                      [title]="item.nazwa + ' (kliknij aby edytować)'"
                      (click)="startEdit(item)"
                    >
                      {{ item.nazwa }}
                    </div>
                  }
                </div>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class WardrobeComponent implements OnInit {
  wardrobe = inject(WardrobeService);

  sections: { key: WardrobeSection; label: string }[] = [
    { key: 'gora', label: 'Góra' },
    { key: 'dol', label: 'Dół' },
    { key: 'buty', label: 'Buty' },
    { key: 'bielizna_i_dodatki', label: 'Bielizna i dodatki' },
    { key: 'silownia', label: 'Siłownia' },
  ];

  showAddForm = signal(false);
  addSection = signal<WardrobeSection>('gora');
  addNazwa = signal('');
  editingItemId = signal<string | null>(null);
  editingNazwa = signal('');

  ngOnInit(): void {
    this.wardrobe.load();
  }

  items(section: WardrobeSection): WardrobeItem[] {
    return this.wardrobe.wardrobe()?.[section] ?? [];
  }

  toggleAddForm(): void {
    this.showAddForm.update((v) => !v);
    this.addNazwa.set('');
  }

  submitAdd(): void {
    const nazwa = this.addNazwa().trim();
    if (!nazwa) return;
    this.wardrobe.addItem(this.addSection(), nazwa);
    this.addNazwa.set('');
    this.showAddForm.set(false);
  }

  startEdit(item: WardrobeItem): void {
    this.editingItemId.set(item.id);
    this.editingNazwa.set(item.nazwa);
  }

  saveEdit(section: WardrobeSection, index: number): void {
    const nazwa = this.editingNazwa().trim();
    if (nazwa) this.wardrobe.updateItem(section, index, nazwa);
    this.editingItemId.set(null);
  }

  cancelEdit(): void {
    this.editingItemId.set(null);
  }

  deleteItem(section: WardrobeSection, index: number): void {
    this.wardrobe.deleteItem(section, index);
  }
}
