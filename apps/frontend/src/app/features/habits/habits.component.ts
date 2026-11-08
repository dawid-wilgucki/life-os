import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { HabitWithStreak } from '@life-os/shared-types';
import { HabitsService } from './habits.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';
import { WEEKDAYS_PL } from '../../shared/weekdays';

@Component({
  selector: 'app-habits',
  standalone: true,
  imports: [FormsModule, PageBackgroundComponent],
  template: `
    <app-page-background theme="habits" />
    <div class="relative mx-auto max-w-2xl p-6">
      <h1 class="text-2xl font-semibold">Nawyki</h1>
      <p class="text-sm text-slate-400">Odhaczaj codziennie.</p>

      <form class="lo-card mt-4 flex flex-wrap gap-2 p-4" (ngSubmit)="add()">
        <input class="lo-input w-20 text-center" placeholder="🔥" [(ngModel)]="icon" name="icon" maxlength="2" />
        <input class="lo-input flex-1" placeholder="Nowy nawyk (np. Czytanie 20 min)" [(ngModel)]="name" name="name" />
        <button type="submit" class="lo-btn px-4">Dodaj</button>
      </form>

      <div class="mt-6 space-y-3">
        @for (h of habits.habits(); track h.id) {
          <div class="lo-card flex items-center gap-4 p-4">
            <button
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl transition"
              [class.bg-emerald-600]="h.checkedToday"
              [class.bg-surface-800]="!h.checkedToday"
              (click)="habits.toggle(h)"
              [title]="h.checkedToday ? 'Odhaczone dziś' : 'Oznacz jako zrobione'"
            >
              {{ h.checkedToday ? '✓' : h.icon }}
            </button>

            <div class="min-w-0 flex-1">
              <div class="font-medium">{{ h.icon }} {{ h.name }}</div>
              <div class="mt-1.5 flex items-center gap-1.5">
                @for (done of h.weeklyChecks; track $index) {
                  <span
                    class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium"
                    [class.bg-emerald-600]="done"
                    [class.text-white]="done"
                    [class.bg-surface-800]="!done"
                    [class.text-slate-500]="!done"
                    [title]="weekdays[$index]"
                  >
                    {{ done ? '✓' : weekdays[$index][0] }}
                  </span>
                }
                <span class="ml-1 text-xs text-slate-500">{{ weekCount(h) }}/7</span>
              </div>
              <div class="mt-1 text-xs text-slate-500">
                🔥 {{ h.currentStreak }} dni z rzędu · rekord {{ h.longestStreak }}
              </div>
            </div>

            <button
              class="flex h-10 w-10 shrink-0 items-center justify-center text-slate-500 transition hover:text-red-400"
              title="Usuń nawyk"
              aria-label="Usuń nawyk"
              (click)="confirmRemove(h)"
            >
              🗑
            </button>
          </div>
        } @empty {
          @if (!habits.loading()) { <p class="text-slate-500">Brak nawyków. Dodaj pierwszy powyżej.</p> }
        }
      </div>
    </div>
  `,
})
export class HabitsComponent implements OnInit {
  habits = inject(HabitsService);
  weekdays = WEEKDAYS_PL;
  name = '';
  icon = '🔥';

  ngOnInit(): void {
    this.habits.load();
  }

  weekCount(h: HabitWithStreak): number {
    return h.weeklyChecks.filter(Boolean).length;
  }

  add(): void {
    if (!this.name.trim()) return;
    this.habits.add({ name: this.name.trim(), icon: this.icon || '✅' });
    this.name = '';
    this.icon = '🔥';
  }

  confirmRemove(h: HabitWithStreak): void {
    if (confirm(`Usunąć nawyk "${h.name}"? Skasuje to też historię odhaczeń.`)) {
      this.habits.remove(h.id);
    }
  }
}
