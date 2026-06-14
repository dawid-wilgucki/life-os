import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { InboxItem } from '@life-os/shared-types';
import { InboxService } from './inbox.service';
import { TasksService } from '../tasks/tasks.service';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-inbox',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="mx-auto max-w-2xl p-6">
      <h1 class="text-2xl font-semibold">Inbox</h1>
      <p class="text-sm text-slate-400">Write it down, sort it later.</p>

      <form class="mt-4 flex gap-2" (ngSubmit)="capture()">
        <input
          class="lo-input"
          placeholder="Capture a thought…"
          [(ngModel)]="draft"
          name="draft"
          autocomplete="off"
        />
        <button type="submit" class="lo-btn px-4">Add</button>
      </form>

      <div class="mt-6 space-y-3">
        @for (item of inbox.items(); track item.id) {
          <div class="lo-card p-4">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm">{{ item.text }}</p>
              <span class="shrink-0 rounded-full bg-surface-800 px-2 py-0.5 text-[11px] text-slate-400">
                {{ item.source === 'telegram' ? '✈️ telegram' : '🖊 web' }}
              </span>
            </div>
            <div class="mt-1 text-[11px] text-slate-500">{{ item.capturedAt | date: 'short' }}</div>

            <!-- Triage -->
            <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-800 pt-3">
              <select class="lo-input max-w-44" [(ngModel)]="listChoice[item.id]" [name]="'list-' + item.id">
                <option [ngValue]="undefined" disabled>Pick list…</option>
                @for (l of tasks.lists(); track l.id) {
                  <option [ngValue]="l.id">{{ l.title }}</option>
                }
              </select>
              <button class="lo-btn-ghost border border-surface-700" (click)="toTask(item)">→ Task</button>

              <input class="lo-input max-w-40" type="date" [(ngModel)]="dateChoice[item.id]" [name]="'date-' + item.id" />
              <button class="lo-btn-ghost border border-surface-700" (click)="toEvent(item)">→ Event</button>

              <button class="lo-btn-ghost ml-auto text-slate-400" (click)="archive(item)">Archive</button>
            </div>
          </div>
        } @empty {
          @if (!inbox.loading()) {
            <p class="text-slate-500">Inbox zero. ✨</p>
          }
        }
      </div>
    </div>
  `,
})
export class InboxComponent implements OnInit {
  inbox = inject(InboxService);
  tasks = inject(TasksService);

  draft = '';
  listChoice: Record<string, string | undefined> = {};
  dateChoice: Record<string, string> = {};

  ngOnInit(): void {
    this.inbox.load();
    if (this.tasks.lists().length === 0) this.tasks.loadLists();
  }

  capture(): void {
    const text = this.draft.trim();
    if (!text) return;
    this.inbox.add(text);
    this.draft = '';
  }

  toTask(item: InboxItem): void {
    const listId = this.listChoice[item.id];
    if (!listId) return;
    this.inbox.convertTask(item.id, listId).subscribe(() => this.inbox.removeLocal(item.id));
  }

  toEvent(item: InboxItem): void {
    const date = this.dateChoice[item.id];
    if (!date) return;
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    this.inbox.convertEvent(item.id, date, ymd(next)).subscribe(() => this.inbox.removeLocal(item.id));
  }

  archive(item: InboxItem): void {
    this.inbox.archive(item.id).subscribe(() => this.inbox.removeLocal(item.id));
  }
}
