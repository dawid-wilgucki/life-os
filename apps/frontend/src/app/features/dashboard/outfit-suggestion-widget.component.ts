import { Component, OnInit, inject, signal } from '@angular/core';
import type { OutfitSuggestion } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-outfit-suggestion-widget',
  standalone: true,
  template: `
    <section class="lo-card p-4">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="font-medium">👔 Stylizacja na dziś</h2>
        <button
          class="lo-btn-ghost text-xs"
          [disabled]="loading()"
          (click)="refresh()"
        >
          {{ loading() ? '⏳' : '↺ Odśwież' }}
        </button>
      </header>

      @if (loading()) {
        <div class="animate-pulse space-y-2">
          <div class="h-5 w-3/4 rounded bg-surface-700"></div>
          <div class="h-5 w-1/2 rounded bg-surface-700"></div>
          <div class="h-5 w-2/3 rounded bg-surface-700"></div>
          <div class="mt-2 h-3 w-full rounded bg-surface-700"></div>
        </div>
      } @else if (outfit(); as o) {
        <div class="space-y-1.5">
          <div class="flex items-baseline gap-2">
            <span class="w-5 shrink-0 text-slate-400">👕</span>
            <span class="text-base font-light text-slate-100">{{ o.top }}</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="w-5 shrink-0 text-slate-400">👖</span>
            <span class="text-base font-light text-slate-100">{{ o.bottom }}</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="w-5 shrink-0 text-slate-400">👟</span>
            <span class="text-base font-light text-slate-100">{{ o.shoes }}</span>
          </div>
        </div>
        <p class="mt-2 text-xs italic text-slate-400">{{ o.note }}</p>
        <div class="mt-1 text-xs text-slate-500">Na dziś: {{ o.temp_range }}</div>
      } @else if (error()) {
        <p class="text-sm text-slate-500">Brak garderoby lub klucza Gemini.</p>
      }
    </section>
  `,
})
export class OutfitSuggestionWidgetComponent implements OnInit {
  private api = inject(ApiService);

  outfit = signal<OutfitSuggestion | null>(null);
  loading = signal(false);
  error = signal(false);

  ngOnInit(): void {
    this.load();
  }

  load(force = false): void {
    this.loading.set(true);
    this.error.set(false);
    const params = force ? { force: 'true' } : {};
    this.api.get<OutfitSuggestion>('/api/wardrobe/outfit-suggestion', params).subscribe({
      next: (r) => { this.outfit.set(r); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }

  refresh(): void {
    this.load(true);
  }
}
