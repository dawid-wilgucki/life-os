import { Injectable, inject, signal } from '@angular/core';
import type { CreateHabitInput, HabitWithStreak } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class HabitsService {
  private api = inject(ApiService);

  readonly habits = signal<HabitWithStreak[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.get<HabitWithStreak[]>('/api/habits').subscribe({
      next: (h) => this.habits.set(h),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  add(input: CreateHabitInput): void {
    this.api.post<HabitWithStreak>('/api/habits', input).subscribe((h) => {
      this.habits.update((list) => [...list, h]);
    });
  }

  toggle(habit: HabitWithStreak): void {
    const req = habit.checkedToday
      ? this.api.delete(`/api/habits/${habit.id}/check`)
      : this.api.post(`/api/habits/${habit.id}/check`);
    // Reload afterwards so streaks reflect the change accurately.
    req.subscribe(() => this.load());
  }
}
