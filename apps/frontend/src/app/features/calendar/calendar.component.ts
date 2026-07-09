import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { CalendarEvent } from '@life-os/shared-types';
import { CalendarService } from './calendar.service';
import { ToastService } from '../../core/toast.service';
import { WEEKDAYS_PL } from '../../shared/weekdays';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-6">
      <div class="mb-4 flex items-center justify-between gap-2">
        <h1 class="text-xl font-semibold capitalize sm:text-2xl">{{ monthLabel() }}</h1>
        <div class="flex items-center gap-1">
          <button class="lo-btn-ghost h-10 w-10" (click)="shiftMonth(-1)" aria-label="Poprzedni miesiąc">←</button>
          <button class="lo-btn-ghost" (click)="goToday()">Dziś</button>
          <button class="lo-btn-ghost h-10 w-10" (click)="shiftMonth(1)" aria-label="Następny miesiąc">→</button>
        </div>
      </div>

      <!-- Desktop: full month grid with event chips -->
      <div class="hidden grid-cols-7 gap-px overflow-hidden rounded-xl border border-surface-800 bg-surface-800 text-sm lg:grid">
        @for (wd of weekdays; track wd) {
          <div class="bg-surface-900 px-2 py-2 text-center text-xs font-medium text-slate-400">{{ wd }}</div>
        }
        @for (day of days(); track day.key) {
          <div
            class="min-h-24 cursor-pointer bg-surface-950 p-1.5 transition hover:bg-surface-900"
            [class.opacity-40]="!day.inMonth"
            [class.ring-1]="day.isToday"
            [class.ring-indigo-500]="day.isToday"
            (click)="selectDay(day.date)"
          >
            <div class="mb-1 text-right text-xs text-slate-400">{{ day.date.getDate() }}</div>
            <div class="space-y-0.5">
              @for (ev of eventsFor(day.key); track ev.id) {
                <div
                  class="truncate rounded bg-indigo-600/80 px-1 py-0.5 text-[11px] text-white"
                  [title]="ev.summary"
                >
                  {{ ev.allDay ? '' : (timeLabel(ev) + ' ') }}{{ ev.summary }}
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Mobile: compact mini-grid (dots) + agenda list -->
      <div class="lg:hidden">
        <div class="grid grid-cols-7 gap-1 rounded-xl border border-surface-800 bg-surface-950/60 p-2 text-center">
          @for (wd of weekdays; track wd) {
            <div class="py-1 text-[10px] text-slate-500">{{ wd }}</div>
          }
          @for (day of days(); track day.key) {
            <button
              class="relative flex h-9 items-center justify-center rounded text-xs"
              [class.text-slate-600]="!day.inMonth"
              [class.text-slate-200]="day.inMonth && !day.isToday"
              [class.bg-indigo-600]="day.isToday"
              [class.text-white]="day.isToday"
              [class.ring-1]="selectedDay() && keyOf(selectedDay()!) === day.key"
              [class.ring-indigo-400]="selectedDay() && keyOf(selectedDay()!) === day.key"
              (click)="selectDay(day.date)"
            >
              {{ day.date.getDate() }}
              @if (eventsFor(day.key).length && !day.isToday) {
                <span class="absolute bottom-1 h-1 w-1 rounded-full bg-emerald-400"></span>
              }
            </button>
          }
        </div>

        <!-- Agenda: this month's events, day by day -->
        <ul class="mt-4 space-y-1">
          @for (e of agenda(); track e.id) {
            <li>
              <button
                class="flex w-full items-baseline gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-surface-900"
                (click)="selectDay(e.date)"
              >
                <span class="w-16 shrink-0 text-xs text-slate-400">{{ e.date | date: 'EEE d MMM' }}</span>
                <span class="w-14 shrink-0 text-xs text-slate-500">{{ e.allDay ? 'cały dzień' : timeLabel(e) }}</span>
                <span class="min-w-0 flex-1 truncate text-slate-200">{{ e.summary }}</span>
              </button>
            </li>
          } @empty {
            <li class="px-2 py-3 text-sm text-slate-500">Brak wydarzeń w tym miesiącu.</li>
          }
        </ul>
      </div>

      <!-- Day panel -->
      @if (selectedDay(); as sel) {
        <div class="lo-card mt-4 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-medium capitalize">{{ sel | date: 'EEEE, d MMMM' }}</h2>
            <button class="lo-btn-ghost h-10 w-10" (click)="selectedDay.set(null)" aria-label="Zamknij">✕</button>
          </div>

          <ul class="mb-4 space-y-1">
            @for (ev of eventsFor(keyOf(sel)); track ev.id) {
              <li class="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-surface-800">
                <span class="min-w-0 flex-1 text-sm">
                  <span class="text-slate-400">{{ ev.allDay ? 'Cały dzień' : timeLabel(ev) }}</span>
                  — {{ ev.summary }}
                </span>
                <button
                  class="flex h-9 w-9 shrink-0 items-center justify-center text-slate-500 transition hover:text-red-400"
                  (click)="remove(ev)"
                  aria-label="Usuń wydarzenie"
                >✕</button>
              </li>
            } @empty {
              <li class="text-sm text-slate-500">Brak wydarzeń.</li>
            }
          </ul>

          <form class="grid gap-2 sm:grid-cols-2" (ngSubmit)="add()">
            <input class="lo-input sm:col-span-2" placeholder="Tytuł zdarzenia…" [(ngModel)]="title" name="title" />

            <!-- Calendar owner dropdown (populated from /api/calendar/owners) -->
            @if (owners().length > 1) {
              <div class="flex items-center gap-2 sm:col-span-2">
                <span class="shrink-0 text-sm text-slate-400">Kalendarz:</span>
                <select class="lo-input" [(ngModel)]="calendarId" name="calendarId">
                  @for (o of owners(); track o.id) {
                    <option [value]="o.id">{{ o.label }}</option>
                  }
                </select>
              </div>
            }

            <label class="flex items-center gap-2 py-1 text-sm text-slate-300">
              <input type="checkbox" class="h-5 w-5 accent-indigo-500" [(ngModel)]="allDay" name="allDay" /> Cały dzień
            </label>
            @if (!allDay) {
              <div class="flex items-center gap-2">
                <input class="lo-input" type="time" [(ngModel)]="startTime" name="startTime" />
                <span class="text-slate-500">→</span>
                <input class="lo-input" type="time" [(ngModel)]="endTime" name="endTime" />
              </div>
            }
            <button type="submit" class="lo-btn sm:col-span-2">Dodaj zdarzenie</button>
          </form>
        </div>
      }
    </div>
  `,
})
export class CalendarComponent implements OnInit {
  private cal = inject(CalendarService);
  private toast = inject(ToastService);
  weekdays = WEEKDAYS_PL;

  anchor = signal(new Date());
  selectedDay = signal<Date | null>(null);

  // Draft form
  title = '';
  allDay = false;
  startTime = '09:00';
  endTime = '10:00';
  calendarId = 'primary';

  owners = this.cal.owners;

  monthLabel = computed(() =>
    this.anchor().toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }),
  );

  /** 42-cell month grid (Monday-first). */
  days = computed(() => {
    const a = this.anchor();
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(a.getFullYear(), a.getMonth(), 1 - offset);
    const today = ymd(new Date());
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = ymd(date);
      return { date, key, inMonth: date.getMonth() === a.getMonth(), isToday: key === today };
    });
  });

  private eventsByDay = computed(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of this.cal.events()) {
      const key = ev.allDay ? ev.start.slice(0, 10) : ymd(new Date(ev.start));
      (map[key] ??= []).push(ev);
    }
    return map;
  });

  /** Mobile agenda: the anchor month's events sorted chronologically, with the day resolved. */
  agenda = computed<(CalendarEvent & { date: Date })[]>(() => {
    const month = this.anchor().getMonth();
    return this.cal
      .events()
      .map((e) => ({ ...e, date: e.allDay ? new Date(e.start.slice(0, 10) + 'T00:00') : new Date(e.start) }))
      .filter((e) => e.date.getMonth() === month)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  ngOnInit(): void {
    this.cal.loadOwners();
    this.reload();
  }

  reload(): void {
    const d = this.days();
    this.cal.loadRange(d[0].date.toISOString(), d[41].date.toISOString());
  }

  shiftMonth(delta: number): void {
    const a = this.anchor();
    this.anchor.set(new Date(a.getFullYear(), a.getMonth() + delta, 1));
    this.selectedDay.set(null);
    this.reload();
  }

  goToday(): void {
    this.anchor.set(new Date());
    this.reload();
  }

  selectDay(d: Date): void {
    this.selectedDay.set(d);
  }

  keyOf(d: Date): string {
    return ymd(d);
  }

  eventsFor(key: string): CalendarEvent[] {
    return this.eventsByDay()[key] ?? [];
  }

  timeLabel(ev: CalendarEvent): string {
    return new Date(ev.start).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  add(): void {
    const day = this.selectedDay();
    if (!day || !this.title.trim()) return;

    let input;
    if (this.allDay) {
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      input = { summary: this.title.trim(), start: ymd(day), end: ymd(next), allDay: true };
    } else {
      const [sh, sm] = this.startTime.split(':').map(Number);
      const [eh, em] = this.endTime.split(':').map(Number);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
      input = { summary: this.title.trim(), start: start.toISOString(), end: end.toISOString(), allDay: false };
    }

    const fullInput = this.calendarId && this.calendarId !== 'primary'
      ? { ...input, calendarId: this.calendarId }
      : input;
    this.cal.create(fullInput).subscribe({
      next: () => {
        this.title = '';
        this.reload();
      },
      error: () => this.toast.error('Nie udało się dodać wydarzenia.'),
    });
  }

  remove(ev: CalendarEvent): void {
    this.cal.remove(ev.id).subscribe({
      next: () => this.reload(),
      error: () => this.toast.error('Nie udało się usunąć wydarzenia.'),
    });
  }
}
