import { Injectable, inject, signal } from '@angular/core';
import type { CalendarEvent, CreateEventInput } from '@life-os/shared-types';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';

export interface CalendarOwner {
  id: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private api = inject(ApiService);

  readonly events = signal<CalendarEvent[]>([]);
  readonly loading = signal(false);
  readonly owners = signal<CalendarOwner[]>([{ id: 'primary', label: 'Ja' }]);

  loadRange(startIso: string, endIso: string): void {
    this.loading.set(true);
    this.api.get<CalendarEvent[]>('/api/calendar/events', { start: startIso, end: endIso }).subscribe({
      next: (e) => this.events.set(e),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  loadOwners(): void {
    this.api.get<CalendarOwner[]>('/api/calendar/owners').subscribe({
      next: (o) => this.owners.set(o),
      error: () => {},
    });
  }

  create(input: CreateEventInput): Observable<CalendarEvent> {
    return this.api.post<CalendarEvent>('/api/calendar/events', input);
  }

  remove(id: string): Observable<unknown> {
    return this.api.delete(`/api/calendar/events/${id}`);
  }
}
