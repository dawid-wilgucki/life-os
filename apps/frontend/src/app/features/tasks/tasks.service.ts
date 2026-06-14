import { Injectable, inject, signal } from '@angular/core';
import type { Task, TaskListWithMeta } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class TasksService {
  private api = inject(ApiService);

  readonly lists = signal<TaskListWithMeta[]>([]);
  readonly tasksByList = signal<Record<string, Task[]>>({});
  readonly loading = signal(false);

  loadLists(): void {
    this.loading.set(true);
    this.api.get<TaskListWithMeta[]>('/api/tasks/lists').subscribe({
      next: (lists) => {
        this.lists.set(lists);
        lists.forEach((l) => this.loadTasks(l.id));
      },
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  loadTasks(listId: string): void {
    this.api.get<Task[]>(`/api/tasks/lists/${listId}`).subscribe((tasks) => {
      this.tasksByList.update((m) => ({ ...m, [listId]: tasks }));
    });
  }

  createTask(listId: string, title: string): void {
    this.api.post<Task>(`/api/tasks/lists/${listId}`, { title }).subscribe((task) => {
      this.tasksByList.update((m) => ({ ...m, [listId]: [task, ...(m[listId] ?? [])] }));
    });
  }

  toggleTask(listId: string, task: Task): void {
    const status = task.status === 'completed' ? 'needsAction' : 'completed';
    this.api.patch<Task>(`/api/tasks/lists/${listId}/${task.id}`, { status }).subscribe((updated) => {
      this.tasksByList.update((m) => ({
        ...m,
        [listId]: (m[listId] ?? []).map((t) => (t.id === updated.id ? updated : t)),
      }));
    });
  }

  deleteTask(listId: string, taskId: string): void {
    this.api.delete(`/api/tasks/lists/${listId}/${taskId}`).subscribe(() => {
      this.tasksByList.update((m) => ({
        ...m,
        [listId]: (m[listId] ?? []).filter((t) => t.id !== taskId),
      }));
    });
  }
}
