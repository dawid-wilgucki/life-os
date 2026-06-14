import { Component, OnInit, inject } from '@angular/core';
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
        <div>
          <h1 class="text-2xl font-semibold">Wardrobe</h1>
          <p class="text-sm text-slate-400">Read-only. Edit in the garderoba.html artifact.</p>
        </div>
        <button class="lo-btn-ghost" (click)="wardrobe.load()">↻ Refresh</button>
      </div>

      @if (wardrobe.loading()) {
        <p class="text-slate-400">Loading…</p>
      }
      @if (wardrobe.error(); as err) {
        <div class="lo-card border-red-500/40 p-4 text-sm text-red-300">{{ err }}</div>
      }

      @for (section of sections; track section.key) {
        @if (items(section.key).length) {
          <section class="mt-6">
            <h2 class="mb-3 text-lg font-medium">{{ section.label }}</h2>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              @for (item of items(section.key); track item.id) {
                <div class="lo-card overflow-hidden">
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
                  <div class="truncate px-2 py-1.5 text-xs" [title]="item.nazwa">{{ item.nazwa }}</div>
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

  ngOnInit(): void {
    this.wardrobe.load();
  }

  items(section: WardrobeSection): WardrobeItem[] {
    return this.wardrobe.wardrobe()?.[section] ?? [];
  }
}
