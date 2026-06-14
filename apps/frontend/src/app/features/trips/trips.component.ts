import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TripsService } from './trips.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

@Component({
  selector: 'app-trips',
  standalone: true,
  imports: [FormsModule, DatePipe, PageBackgroundComponent],
  template: `
    <app-page-background theme="trips" />
    <div class="relative mx-auto max-w-4xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Trips</h1>
        <button class="lo-btn-ghost border border-surface-700" [disabled]="trips.importing()" (click)="importEmail()">
          {{ trips.importing() ? 'Scanning…' : '✉️ Import from Gmail' }}
        </button>
      </div>

      @if (importMsg(); as m) {
        <div class="lo-card mb-4 p-3 text-sm text-slate-300">{{ m }}</div>
      }

      <!-- Manual entry -->
      <form class="lo-card grid gap-3 p-4 sm:grid-cols-2" (ngSubmit)="add()">
        <input class="lo-input" placeholder="From" [(ngModel)]="form.fromLoc" name="from" required />
        <input class="lo-input" placeholder="To" [(ngModel)]="form.toLoc" name="to" required />
        <label class="text-xs text-slate-400 sm:col-span-2">
          Departure
          <input class="lo-input mt-1" type="datetime-local" [(ngModel)]="form.departureAt" name="dep" required />
        </label>
        <input class="lo-input" placeholder="Carrier (e.g. PKP Intercity)" [(ngModel)]="form.carrier" name="carrier" />
        <input class="lo-input" placeholder="Train number" [(ngModel)]="form.trainNumber" name="train" />
        <input class="lo-input sm:col-span-2" placeholder="Seat (e.g. wagon 7, miejsce 42)" [(ngModel)]="form.seat" name="seat" />
        <button type="submit" class="lo-btn sm:col-span-2">Add trip</button>
      </form>

      <!-- List -->
      <div class="mt-6 space-y-3">
        @for (t of trips.trips(); track t.id) {
          <div class="lo-card flex items-center justify-between p-4">
            <div>
              <div class="font-medium">{{ t.fromLoc }} → {{ t.toLoc }}</div>
              <div class="text-sm text-slate-400">
                {{ t.departureAt | date: 'EEE d MMM, HH:mm' }}
                @if (t.trainNumber) { · {{ t.trainNumber }} }
                @if (t.seat) { · {{ t.seat }} }
              </div>
            </div>
            <span class="rounded-full bg-surface-800 px-2 py-0.5 text-[11px] text-slate-400">
              {{ t.source === 'gmail' ? '✉️ gmail' : '✍️ manual' }}
            </span>
          </div>
        } @empty {
          @if (!trips.loading()) { <p class="text-slate-500">No trips yet.</p> }
        }
      </div>
    </div>
  `,
})
export class TripsComponent implements OnInit {
  trips = inject(TripsService);
  importMsg = signal<string | null>(null);

  form = { fromLoc: '', toLoc: '', departureAt: '', carrier: '', trainNumber: '', seat: '' };

  ngOnInit(): void {
    this.trips.load();
  }

  add(): void {
    if (!this.form.fromLoc.trim() || !this.form.toLoc.trim() || !this.form.departureAt) return;
    this.trips.add({
      fromLoc: this.form.fromLoc.trim(),
      toLoc: this.form.toLoc.trim(),
      departureAt: new Date(this.form.departureAt).toISOString(),
      carrier: this.form.carrier.trim() || undefined,
      trainNumber: this.form.trainNumber.trim() || undefined,
      seat: this.form.seat.trim() || undefined,
    });
    this.form = { fromLoc: '', toLoc: '', departureAt: '', carrier: '', trainNumber: '', seat: '' };
  }

  importEmail(): void {
    this.importMsg.set(null);
    this.trips.importEmail((r) => {
      this.importMsg.set(`Scanned ${r.scanned} email(s): imported ${r.imported}, skipped ${r.skipped}.`);
    });
  }
}
