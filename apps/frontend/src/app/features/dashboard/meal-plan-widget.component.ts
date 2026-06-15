import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { MealDay, MealPlan } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-meal-plan-widget',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="lo-card p-4">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="font-medium">🍽 Jadłospis</h2>
        <div class="flex items-center gap-2">
          @if (plan()) {
            <span class="text-[11px] text-slate-500">
              {{ plan()!.generatedAt | date: 'd MMM' }}
            </span>
          }
          <button
            class="lo-btn-ghost px-2 text-xs"
            [disabled]="loading()"
            (click)="regenerate()"
            title="Wygeneruj nowy jadłospis"
          >
            {{ loading() ? '…' : '↺' }}
          </button>
        </div>
      </header>

      @if (error()) {
        <p class="text-sm text-red-400">{{ error() }}</p>
      } @else if (!plan() && !loading()) {
        <p class="text-sm text-slate-500">
          Kliknij ↺ aby wygenerować jadłospis na podstawie listy zakupów.
        </p>
      } @else if (loading()) {
        <p class="text-sm text-slate-500 animate-pulse">Generuję jadłospis przez Gemini…</p>
      } @else {
        <!-- Horizontal scroll on mobile, grid on desktop -->
        <div class="flex gap-2 overflow-x-auto pb-1">
          @for (day of plan()!.meal_plan; track day.day_id) {
            <div
              class="min-w-36 shrink-0 cursor-pointer rounded-lg border p-2.5 transition"
              [class.opacity-55]="day.is_batch_leftover"
              [class.border-surface-700]="expandedDay() !== day.day_id"
              [class.border-indigo-500]="expandedDay() === day.day_id"
              [class.bg-surface-900]="expandedDay() !== day.day_id"
              [class.bg-surface-800]="expandedDay() === day.day_id"
              (click)="toggle(day)"
            >
              <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-medium text-slate-400">{{ day.day_name }}</span>
                @if (day.is_batch_leftover) {
                  <span class="text-[11px]" title="Reszta z poprzedniego dnia">♻</span>
                }
              </div>
              <p class="mt-1 text-xs font-medium leading-tight text-slate-100">{{ day.meal_name }}</p>
              <div class="mt-1.5 flex flex-wrap gap-1">
                <span class="rounded bg-surface-950 px-1 py-0.5 text-[10px] text-slate-500">
                  ⏱ {{ day.prep_time_min }} min
                </span>
                @for (tag of day.tags.slice(0, 2); track tag) {
                  <span class="rounded bg-surface-950 px-1 py-0.5 text-[10px] text-slate-500">
                    {{ tag }}
                  </span>
                }
              </div>

              <!-- Expandable recipe steps -->
              @if (expandedDay() === day.day_id) {
                <ol class="mt-2 space-y-0.5 border-t border-surface-700 pt-2">
                  @for (step of day.recipe_steps; track $index) {
                    <li class="flex gap-1.5 text-[11px] text-slate-300">
                      <span class="shrink-0 font-medium text-slate-500">{{ $index + 1 }}.</span>
                      {{ step }}
                    </li>
                  }
                </ol>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class MealPlanWidgetComponent implements OnInit {
  private api = inject(ApiService);

  plan = signal<MealPlan | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  expandedDay = signal<number | null>(null);

  ngOnInit(): void {
    this.fetch(false);
  }

  fetch(force: boolean): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<MealPlan>('/api/meal-plan', force ? { force: true } : {}).subscribe({
      next: (p) => this.plan.set(p),
      error: (e) => {
        const msg = e?.error?.error ?? 'Błąd generowania jadłospisu';
        if (msg === 'gemini_not_configured') {
          this.error.set('Skonfiguruj GEMINI_API_KEY w .dev.vars aby włączyć jadłospis.');
        } else {
          this.error.set(msg);
        }
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  regenerate(): void {
    this.fetch(true);
  }

  toggle(day: MealDay): void {
    this.expandedDay.update((cur) => (cur === day.day_id ? null : day.day_id));
  }
}
