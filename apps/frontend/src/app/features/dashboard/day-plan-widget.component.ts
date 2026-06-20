import { Component, OnInit, inject, signal } from '@angular/core';
import type { DayPlan } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-day-plan-widget',
  standalone: true,
  template: `
    <section class="lo-card p-4">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="font-medium">📋 Plan dnia</h2>
        <div class="flex items-center gap-2">
          @if (plan()?.generated_at) {
            <span class="text-[11px] text-slate-500">{{ plan()!.generated_at }}</span>
          }
          <button
            class="lo-btn-ghost px-2 text-xs"
            [disabled]="loading()"
            (click)="refresh()"
            title="Wygeneruj nowy plan dnia"
          >
            {{ loading() ? '…' : '↺' }}
          </button>
        </div>
      </header>

      @if (loading() && !plan()) {
        <p class="text-sm text-slate-500 animate-pulse">Układam plan dnia przez Gemini…</p>
      } @else if (error()) {
        <div class="space-y-2">
          <p class="text-sm text-red-400">{{ error() }}</p>
          <button class="lo-btn-ghost text-xs" (click)="refresh()">Spróbuj ponownie</button>
        </div>
      } @else if (plan() !== null) {
        @if (plan()!.summary) {
          <p class="mb-3 text-sm italic text-slate-400">{{ plan()!.summary }}</p>
        }

        @if (plan()!.alerts.length) {
          <div class="mb-3 space-y-1.5">
            @for (a of plan()!.alerts; track $index) {
              <div
                class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
              >
                <span class="shrink-0">⚠️</span>
                <span>{{ a.message }}</span>
              </div>
            }
          </div>
        }

        <ol class="space-y-1.5">
          @for (item of plan()!.plan; track item.order) {
            <li class="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-800">
              <span class="mt-0.5 w-5 shrink-0 text-center text-xs text-slate-500">{{ item.order }}</span>
              <span class="mt-0.5 shrink-0">{{ iconFor(item.type) }}</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-sm text-slate-100">{{ item.title }}</span>
                  @if (item.duration_min) {
                    <span class="shrink-0 text-[11px] text-slate-500">⏱ {{ item.duration_min }} min</span>
                  }
                </div>
                @if (item.reason) {
                  <p class="text-[11px] text-slate-500">{{ item.reason }}</p>
                }
              </div>
            </li>
          } @empty {
            <li class="text-sm text-slate-500">Brak rzeczy do zrobienia na dziś. 🎉</li>
          }
        </ol>
      } @else {
        <p class="text-sm text-slate-500">Brak planu. Kliknij ↺ aby wygenerować.</p>
      }
    </section>
  `,
})
export class DayPlanWidgetComponent implements OnInit {
  private api = inject(ApiService);

  plan = signal<DayPlan | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.load(false);
  }

  load(refresh: boolean): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<DayPlan>('/api/day-plan', refresh ? { refresh: true } : {}).subscribe({
      next: (p) => this.plan.set(p),
      error: (e) => {
        console.error('day-plan error:', e);
        const code = e?.error?.error ?? 'unknown';
        const messages: Record<string, string> = {
          gemini_not_configured: 'Brak klucza GEMINI_API_KEY — skonfiguruj go w środowisku.',
          gemini_error: 'Błąd połączenia z Gemini. Spróbuj ponownie.',
          gemini_parse_error: 'Gemini zwrócił niepoprawną odpowiedź. Odśwież plan.',
        };
        this.error.set(messages[code] ?? 'Nie udało się wczytać planu dnia.');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  refresh(): void {
    this.load(true);
  }

  iconFor(type: string): string {
    return type === 'habit' ? '✅' : type === 'alert' ? '⚠️' : '📌';
  }
}
