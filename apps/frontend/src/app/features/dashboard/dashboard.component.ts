import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { CalendarEvent, HabitWithStreak, LifeProfile, ListWithItems, Trip } from '@life-os/shared-types';
import { ListsService } from '../tasks/lists.service';
import { CalendarService } from '../calendar/calendar.service';
import { HabitsService } from '../habits/habits.service';
import { TripsService } from '../trips/trips.service';
import { ApiService } from '../../core/api.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';
import { KrakowStatusComponent } from './krakow-status.component';
import { PinnedListsComponent } from './pinned-lists.component';
import { MealPlanWidgetComponent } from './meal-plan-widget.component';
import { OutfitSuggestionWidgetComponent } from './outfit-suggestion-widget.component';
import { DayPlanWidgetComponent } from './day-plan-widget.component';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, PageBackgroundComponent, KrakowStatusComponent, PinnedListsComponent, MealPlanWidgetComponent, OutfitSuggestionWidgetComponent, DayPlanWidgetComponent],
  template: `
    <app-page-background theme="dashboard" />
    <div class="relative mx-auto max-w-5xl p-6">
      <h1 class="text-2xl font-semibold">Dashboard</h1>
      <p class="text-sm text-slate-400">Your day at a glance.</p>

      <!-- Plan dnia — najważniejsza sekcja -->
      <app-day-plan-widget class="mt-6 block" />

      <app-krakow-status class="mt-4 block" />

      <!-- Outfit suggestion + daily prep (full-width row) -->
      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <app-outfit-suggestion-widget />
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <!-- To-do (the list with the lowest order_index) -->
        <section class="lo-card p-4">
          <header class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">
              {{ dashboardList()?.locked ? '⛓️' : '✅' }}
              {{ dashboardList()?.title ?? 'To-do' }}
            </h2>
            <a routerLink="/tasks" class="text-xs text-indigo-400 hover:underline">Open tasks →</a>
          </header>
          @if (dashboardList(); as dl) {
            @if (dl.type === 'note') {
              <p class="whitespace-pre-wrap text-sm text-slate-300">{{ dl.content || '(pusta notatka)' }}</p>
            } @else {
              <ul class="space-y-1.5">
                @for (item of dl.items; track item.id) {
                  <li
                    class="flex items-start gap-2 text-sm"
                    [class.line-through]="item.checked"
                    [class.text-slate-500]="item.checked"
                  >
                    <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"></span>
                    <span class="flex-1">{{ item.text }}</span>
                  </li>
                } @empty {
                  <li class="text-sm text-slate-500">Nothing open. 🎉</li>
                }
              </ul>
            }
          } @else {
            <p class="text-sm text-slate-500">Brak list.</p>
          }
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
              <li
                class="flex cursor-pointer items-baseline gap-2 rounded px-1 py-1 text-xs transition hover:bg-surface-800"
                (click)="openEvent(e)"
              >
                <span class="w-20 shrink-0 text-slate-400">{{ e.start | date: 'EEE d MMM' }}</span>
                <span class="shrink-0 text-slate-500">{{ e.allDay ? 'all day' : (e.start | date: 'HH:mm') }}</span>
                <span class="min-w-0 flex-1 truncate text-slate-200" [title]="e.summary">{{ e.summary }}</span>
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

      <!-- Life Profile snippet -->
      @if (profileSnippet().length) {
        <section class="lo-card mt-4 p-4">
          <header class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">👤 Mój profil</h2>
            <a routerLink="/profile" class="text-xs text-indigo-400 hover:underline">Edytuj →</a>
          </header>
          <ul class="space-y-1.5">
            @for (s of profileSnippet(); track s.key) {
              <li class="flex gap-2 text-sm">
                <span class="w-24 shrink-0 text-slate-500">{{ s.label }}</span>
                <span class="min-w-0 flex-1 truncate text-slate-300" [title]="s.value">{{ s.value }}</span>
              </li>
            }
          </ul>
        </section>
      }

      <!-- Pinned lists (up to 2) + meal plan — second row -->
      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        <!-- Pinned lists occupy 2 columns on desktop -->
        <div class="contents lg:col-span-2 lg:grid lg:grid-cols-2 lg:gap-4">
          <app-pinned-lists />
        </div>
        <!-- Meal plan widget: full width on mobile, 1 col on desktop -->
        <app-meal-plan-widget class="lg:col-span-1" />
      </div>

      <!-- Event details + delete modal -->
      @if (selectedEvent(); as ev) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          (click)="closeEvent()"
        >
          <div class="lo-card w-full max-w-sm p-5" (click)="$event.stopPropagation()">
            <header class="mb-3 flex items-start justify-between gap-2">
              <h2 class="min-w-0 break-words text-lg font-medium">{{ ev.summary }}</h2>
              <button class="lo-btn-ghost shrink-0 px-2 py-1 text-xs" (click)="closeEvent()">✕</button>
            </header>
            <dl class="space-y-1.5 text-sm">
              <div class="flex gap-2">
                <dt class="w-16 shrink-0 text-slate-500">Kiedy</dt>
                <dd class="min-w-0 text-slate-200">
                  {{ ev.start | date: 'EEE d MMM y' }}{{ ev.allDay ? ' (cały dzień)' : ', ' + (ev.start | date: 'HH:mm') }}
                </dd>
              </div>
              @if (ev.location) {
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-slate-500">Miejsce</dt>
                  <dd class="min-w-0 break-words text-slate-200">{{ ev.location }}</dd>
                </div>
              }
              @if (ev.description) {
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-slate-500">Opis</dt>
                  <dd class="min-w-0 break-words text-slate-300">{{ ev.description }}</dd>
                </div>
              }
            </dl>
            <div class="mt-4 flex justify-end gap-2">
              <button class="lo-btn-ghost text-sm" (click)="closeEvent()">Zamknij</button>
              <button
                class="lo-btn-ghost text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300"
                [disabled]="deletingEvent()"
                (click)="deleteEvent(ev.id)"
              >
                {{ deletingEvent() ? 'Usuwam…' : '🗑 Usuń' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
const SECTION_LABELS: Record<string, string> = {
  praca: '💼 Praca', dom: '🏠 Dom', cele: '🎯 Cele',
  zdrowie: '🏥 Zdrowie', relacje: '👥 Relacje', finanse: '💰 Finanse',
  projekty: '🚀 Projekty', inne: '📝 Inne',
};

export class DashboardComponent implements OnInit {
  private listsSvc = inject(ListsService);
  private cal = inject(CalendarService);
  private habitsSvc = inject(HabitsService);
  private tripsSvc = inject(TripsService);
  private api = inject(ApiService);

  weekdays = WEEKDAYS;
  habits = this.habitsSvc.habits;

  private anchor = new Date();
  private profileSections = signal<Record<string, string>>({});

  profileSnippet = computed(() =>
    Object.entries(this.profileSections())
      .filter(([, v]) => v && v.trim().length > 0)
      .slice(0, 3)
      .map(([key, value]) => ({
        key,
        label: SECTION_LABELS[key] ?? key,
        value: value.length > 80 ? value.slice(0, 80) + '…' : value,
      })),
  );

  ngOnInit(): void {
    this.listsSvc.load();
    this.habitsSvc.load();
    this.tripsSvc.load();
    const { start, end } = this.monthRange();
    this.cal.loadRange(start, end);
    this.api.get<LifeProfile>('/api/profile').subscribe({
      next: (p) => this.profileSections.set(p.sections ?? {}),
    });
  }

  monthLabel = computed(() =>
    this.anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  /** The list with the lowest order_index — the one surfaced on the dashboard. */
  dashboardList = computed<ListWithItems | null>(() => this.listsSvc.lists()[0] ?? null);

  selectedEvent = signal<CalendarEvent | null>(null);
  deletingEvent = signal(false);

  openEvent(e: CalendarEvent): void {
    this.selectedEvent.set(e);
  }

  closeEvent(): void {
    this.selectedEvent.set(null);
  }

  deleteEvent(id: string): void {
    this.deletingEvent.set(true);
    this.cal.remove(id).subscribe({
      next: () => {
        const { start, end } = this.monthRange();
        this.cal.loadRange(start, end);
        this.deletingEvent.set(false);
        this.closeEvent();
      },
      error: () => this.deletingEvent.set(false),
    });
  }

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
