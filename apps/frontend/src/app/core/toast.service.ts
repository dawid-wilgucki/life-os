import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'success';
}

const TOAST_MS = 4000;

/** App-wide transient notifications, rendered by the shell above the bottom nav. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  error(text: string): void {
    this.show(text, 'error');
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  private show(text: string, kind: Toast['kind']): void {
    const id = this.nextId++;
    this.toasts.update((all) => [...all, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), TOAST_MS);
  }

  dismiss(id: number): void {
    this.toasts.update((all) => all.filter((t) => t.id !== id));
  }
}
