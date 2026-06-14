import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { MaintenanceCategory, MaintenanceItem } from '@life-os/shared-types';
import { MaintenanceService } from './maintenance.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

const CATEGORY_ICON: Record<MaintenanceCategory, string> = {
  ogrod: '🌳',
  dom: '🏠',
  auto: '🚗',
};

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [FormsModule, DatePipe, PageBackgroundComponent],
  template: `
    <app-page-background theme="maintenance" />
    <div class="relative mx-auto max-w-3xl p-6">
      <h1 class="text-2xl font-semibold">Maintenance</h1>
      <p class="text-sm text-slate-400">Recurring home, garden and car tasks. Reminders via Telegram 3 days ahead.</p>

      <form class="lo-card mt-4 grid gap-3 p-4 sm:grid-cols-2" (ngSubmit)="add()">
        <input class="lo-input sm:col-span-2" placeholder="Task name" [(ngModel)]="form.name" name="name" required />
        <select class="lo-input" [(ngModel)]="form.category" name="category">
          <option value="dom">🏠 Dom</option>
          <option value="ogrod">🌳 Ogród</option>
          <option value="auto">🚗 Auto</option>
        </select>
        <label class="text-xs text-slate-400">
          Next due
          <input class="lo-input mt-1" type="date" [(ngModel)]="form.nextDue" name="nextDue" required />
        </label>
        <label class="text-xs text-slate-400">
          Interval (days)
          <input class="lo-input mt-1" type="number" min="1" [(ngModel)]="form.intervalDays" name="interval" required />
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" class="accent-indigo-500" [(ngModel)]="form.mirrorToCalendar" name="mirror" />
          Mirror to "Dom/Konserwacja" calendar
        </label>
        <button type="submit" class="lo-btn sm:col-span-2">Add item</button>
      </form>

      <div class="mt-6 space-y-2">
        @for (item of maint.items(); track item.id) {
          <div class="lo-card flex items-center justify-between p-4" [class.border-amber-500]="isSoon(item)">
            <div>
              <div class="font-medium">{{ icon(item.category) }} {{ item.name }}</div>
              <div class="text-sm" [class.text-amber-400]="isSoon(item)" [class.text-slate-400]="!isSoon(item)">
                Due {{ item.nextDue | date: 'EEE d MMM y' }} · every {{ item.intervalDays }}d
                @if (item.googleEventId) { · 📅 }
              </div>
            </div>
            <button class="lo-btn px-3" (click)="maint.markDone(item.id)">Done</button>
          </div>
        } @empty {
          @if (!maint.loading()) { <p class="text-slate-500">No maintenance items yet.</p> }
        }
      </div>
    </div>
  `,
})
export class MaintenanceComponent implements OnInit {
  maint = inject(MaintenanceService);

  form: {
    name: string;
    category: MaintenanceCategory;
    nextDue: string;
    intervalDays: number;
    mirrorToCalendar: boolean;
  } = { name: '', category: 'dom', nextDue: '', intervalDays: 30, mirrorToCalendar: false };

  ngOnInit(): void {
    this.maint.load();
  }

  icon(c: MaintenanceCategory): string {
    return CATEGORY_ICON[c];
  }

  isSoon(item: MaintenanceItem): boolean {
    const due = new Date(item.nextDue).getTime();
    return due - Date.now() <= 3 * 86_400_000;
  }

  add(): void {
    if (!this.form.name.trim() || !this.form.nextDue || !this.form.intervalDays) return;
    this.maint.add({
      name: this.form.name.trim(),
      category: this.form.category,
      nextDue: this.form.nextDue,
      intervalDays: Number(this.form.intervalDays),
      mirrorToCalendar: this.form.mirrorToCalendar,
    });
    this.form = { name: '', category: 'dom', nextDue: '', intervalDays: 30, mirrorToCalendar: false };
  }
}
