import { Component, OnInit, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { CalendarEvent, HabitWithStreak, Trip } from '@life-os/shared-types';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { HabitsService } from '../habits/habits.service';
import { TripsService } from '../trips/trips.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';
import { KrakowStatusComponent } from './krakow-status.component';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, PageBackgroundComponent, KrakowStatusComponent],
  template: `
    <app-page-background theme="dashboard" />
    <div class="relative mx-auto max-w-5xl p-6">
      <h1 class="text-2xl font-semibold">Dashboard</h1>
      <p class="text-sm text-slate-400">Your day at a glance.</p>

      <app-krakow-status class="mt-6 block" />

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <!-- To-do -->
        <section class="lo-card p-4">
          <header class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">✅ To-do</h2>
            <a routerLink="/tasks" class="text-xs text-indigo-400 hover:underline">Open tasks →</a>
          </header>
          <ul class="space-y-1.5">
            @for (t of openTasks(); track t.id) {
              <li class="flex items-start gap-2 text-sm">
                <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"></span>
                <span class="flex-1">{{ t.title }}</span>
                <span class="shrink-0 text-[11px] text-slate-500">{{ t.list }}</span>
              </li>
            } @empty {
              <li class="text-sm text-slate-500">Nothing open. 🎉</li>
            }
          </ul>
        </section>

        <!-- Mini calendar -->
        <section class="lo-card p-4">
          <header class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">📅 {{ monthLabel() }}</h2>
            <a routerLink="/calendar" class="text-xs text-indigo-400 hover:underline">Open calendar →</a>
          </header>
          <div class="grid grid-cols-7 gap-1 text-center">
            @for (wd of weekdays; track wd) {
              <div class="text-[10px] text-slate-500">{{ wd[0] }}</div>
            }
            @for (d of days(); track d.key) {
              <a
                routerLink="/calendar"
                class="relative flex h-7 items-center justify-center rounded text-[11px]"
                [class.text-slate-600]="!d.inMonth"
                [class.text-slate-200]="d.inMonth"
                [class.bg-indigo-600]="d.isToday"
                [class.text-white]="d.isToday"
                [class.font-semibold]="d.events.length && !d.isToday"
                [class.hover:bg-surface-800]="!d.isToday"
                [title]="d.events.length ? dayTooltip(d.events) : ''"
              >
                {{ d.day }}
                @if (d.events.length && !d.isToday) {
                  <span class="absolute bottom-0.5 h-1 w-1 rounded-full bg-emerald-400"></span>
                }
              </a>
            }
          </div>

          <!-- What's coming up (so you know what's on which day at a glance) -->
          <ul class="mt-3 space-y-1.5 border-t border-surface-800 pt-3">
            @for (e of upcomingEvents(); track e.id) {
              <li class="flex items-baseline gap-2 text-xs">
                <span class="w-20 shrink-0 text-slate-400">{{ e.start | date: 'EEE d MMM' }}</span>
                <span class="shrink-0 text-slate-500">{{ e.allDay ? 'all day' : (e.start | date: 'HH:mm') }}</span>
                <span class="flex-1 truncate text-slate-200" [title]="e.summary">{{ e.summary }}</span>
              </li>
            } @empty {
              <li class="text-xs text-slate-500">No upcoming events.</li>
            }
          </ul>
        </section>

        <!-- Habits (weekly) -->
        <section class="lo-card p-4">
          <header class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">🔥 Habits this week</h2>
            <a routerLink="/habits" class="text-xs text-indigo-400 hover:underline">Open habits →</a>
          </header>
          <ul class="space-y-2.5">
            @for (h of habits(); track h.id) {
              <li class="flex items-center gap-3">
                <span class="w-28 shrink-0 truncate text-sm">{{ h.icon }} {{ h.name }}</span>
                <div class="flex items-center gap-1">
                  @for (done of h.weeklyChecks; track $index) {
                    <span
                      class="flex h-5 w-5 items-center justify-center rounded-full text-[10px]"
                      [class.bg-emerald-600]="done"
                      [class.text-white]="done"
                      [class.bg-surface-800]="!done"
                      [class.text-slate-600]="!done"
                      [title]="weekdays[$index]"
                    >
                      {{ done ? '✓' : weekdays[$index][0] }}
                    </span>
                  }
                </div>
                <span class="ml-auto text-xs text-slate-500">{{ weekCount(h) }}/7</span>
              </li>
            } @empty {
              <li class="text-sm text-slate-500">No habits yet.</li>
            }
          </ul>
        </section>

        <!-- Upcoming trips -->
        <section class="lo-card p-4">
          <header class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">🚆 Upcoming trips</h2>
            <a routerLink="/trips" class="text-xs text-indigo-400 hover:underline">Open trips →</a>
          </header>
          <ul class="space-y-2">
            @for (t of upcomingTrips(); track t.id) {
              <li class="flex items-center justify-between gap-3 text-sm">
                <span class="font-medium">{{ t.fromLoc }} → {{ t.toLoc }}</span>
                <span class="shrink-0 text-xs text-slate-400">{{ t.departureAt | date: 'EEE d MMM, HH:mm' }}</span>
              </li>
            } @empty {
              <li class="text-sm text-slate-500">No upcoming trips.</li>
            }
          </ul>
        </section>
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private tasks = inject(TasksService);
  private cal = inject(CalendarService);
  private habitsSvc = inject(HabitsService);
  private tripsSvc = inject(TripsService);

  weekdays = WEEKDAYS;
  habits = this.habitsSvc.habits;

  private anchor = new Date();

  ngOnInit(): void {
    this.tasks.loadLists();
    this.habitsSvc.load();
    this.tripsSvc.load();
    const { start, end } = this.monthRange();
    this.cal.loadRange(start, end);
  }

  monthLabel = computed(() =>
    this.anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  /** Open tasks across all lists (capped), with their list name. */
  openTasks = computed(() => {
    const map = this.tasks.tasksByList();
    const out: { id: string; title: string; list: string }[] = [];
    for (const l of this.tasks.lists()) {
      for (const t of map[l.id] ?? []) {
        if (t.status !== 'completed') out.push({ id: `${l.id}:${t.id}`, title: t.title, list: l.title });
      }
    }
    return out.slice(0, 8);
  });

  private eventsByDay = computed(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of this.cal.events()) {
      const key = e.allDay ? e.start.slice(0, 10) : ymd(new Date(e.start));
      (map[key] ??= []).push(e);
    }
    return map;
  });

  /** 42-cell mini month grid; each day carries its events for dot + tooltip. */
  days = computed(() => {
    const a = this.anchor;
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(a.getFullYear(), a.getMonth(), 1 - offset);
    const today = ymd(new Date());
    const byDay = this.eventsByDay();
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = ymd(date);
      return {
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === a.getMonth(),
        isToday: key === today,
        events: byDay[key] ?? [],
      };
    });
  });

  /** Next few events from today onward, for the labelled list under the grid. */
  upcomingEvents = computed<CalendarEvent[]>(() => {
    const todayKey = ymd(new Date());
    return this.cal
      .events()
      .filter((e) => (e.allDay ? e.start.slice(0, 10) : ymd(new Date(e.start))) >= todayKey)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 5);
  });

  dayTooltip(events: CalendarEvent[]): string {
    return events.map((e) => e.summary).join(', ');
  }

  upcomingTrips = computed<Trip[]>(() => {
    const since = Date.now() - 12 * 3_600_000; // keep today's trips visible
    return this.tripsSvc
      .trips()
      .filter((t) => new Date(t.departureAt).getTime() >= since)
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt))
      .slice(0, 5);
  });

  private monthRange(): { start: string; end: string } {
    const a = this.anchor;
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(a.getFullYear(), a.getMonth(), 1 - offset);
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 41);
    return { start: gridStart.toISOString(), end: gridEnd.toISOString() };
  }

  weekCount(h: HabitWithStreak): number {
    return h.weeklyChecks.filter(Boolean).length;
  }
}
