import { Component, OnInit, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Task } from '@life-os/shared-types';
import { TasksService } from './tasks.service';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-6">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Tasks</h1>
          <p class="text-sm text-slate-400">Synced with Google Tasks.</p>
        </div>
        <button class="lo-btn-ghost" (click)="reload()">↻ Refresh</button>
      </div>

      @if (tasks.loading()) {
        <p class="text-slate-400">Loading…</p>
      } @else if (lists().length === 0) {
        <p class="text-slate-400">No task lists found in your Google account.</p>
      }

      <!-- Keep-style masonry columns -->
      <div class="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4 [&>*]:mb-4">
        @for (list of lists(); track list.id) {
          <section class="lo-card break-inside-avoid p-4">
            <header class="mb-2 flex items-center gap-2">
              @if (list.meta?.color) {
                <span class="h-3 w-3 rounded-full" [style.background]="list.meta?.color"></span>
              }
              <h2 class="font-medium">{{ list.title }}</h2>
              @if (list.meta?.pinned) { <span class="text-xs">📌</span> }
            </header>

            <!-- Add task -->
            <form class="mb-3 flex gap-2" (ngSubmit)="add(list.id)">
              <input
                class="lo-input"
                placeholder="Add a task…"
                [(ngModel)]="drafts[list.id]"
                name="draft-{{ list.id }}"
              />
              <button type="submit" class="lo-btn px-3">+</button>
            </form>

            <ul class="space-y-1">
              @for (task of open(list.id); track task.id) {
                <li class="group flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-surface-800">
                  <input
                    type="checkbox"
                    class="mt-1 accent-indigo-500"
                    [checked]="false"
                    (change)="tasks.toggleTask(list.id, task)"
                  />
                  <span class="flex-1 text-sm">
                    {{ task.title }}
                    @if (task.due) {
                      <span class="block text-xs text-slate-500">due {{ task.due | date: 'mediumDate' }}</span>
                    }
                  </span>
                  <button
                    class="invisible text-slate-500 hover:text-red-400 group-hover:visible"
                    (click)="tasks.deleteTask(list.id, task.id)"
                  >
                    ✕
                  </button>
                </li>
              }
            </ul>

            <!-- Completed -->
            @if (done(list.id).length) {
              <details class="mt-3">
                <summary class="cursor-pointer text-xs text-slate-500">
                  {{ done(list.id).length }} completed
                </summary>
                <ul class="mt-1 space-y-1">
                  @for (task of done(list.id); track task.id) {
                    <li class="flex items-center gap-2 px-2 py-1 text-sm text-slate-500">
                      <input
                        type="checkbox"
                        class="accent-indigo-500"
                        [checked]="true"
                        (change)="tasks.toggleTask(list.id, task)"
                      />
                      <span class="line-through">{{ task.title }}</span>
                    </li>
                  }
                </ul>
              </details>
            }
          </section>
        }
      </div>
    </div>
  `,
})
export class TasksComponent implements OnInit {
  tasks = inject(TasksService);
  lists = this.tasks.lists;
  drafts: Record<string, string> = {};

  private byList = computed(() => this.tasks.tasksByList());

  ngOnInit(): void {
    this.tasks.loadLists();
  }

  reload(): void {
    this.tasks.loadLists();
  }

  open(listId: string): Task[] {
    return (this.byList()[listId] ?? []).filter((t) => t.status !== 'completed');
  }

  done(listId: string): Task[] {
    return (this.byList()[listId] ?? []).filter((t) => t.status === 'completed');
  }

  add(listId: string): void {
    const title = (this.drafts[listId] ?? '').trim();
    if (!title) return;
    this.tasks.createTask(listId, title);
    this.drafts[listId] = '';
  }
}
