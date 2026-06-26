import { Component, OnInit, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { JobSearchService } from './job-search.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

@Component({
  selector: 'app-job-search',
  standalone: true,
  imports: [DecimalPipe, PageBackgroundComponent],
  template: `
    <app-page-background theme="job-search" />
    <div class="relative mx-auto max-w-4xl p-6">

      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Oferty pracy</h1>
          <p class="text-sm text-slate-400">Angular · junior/mid · Kraków lub remote</p>
        </div>
        <button
          class="lo-btn px-4"
          (click)="svc.fetchNew()"
          [disabled]="svc.fetching()"
        >
          {{ svc.fetching() ? '⏳ Pobieranie…' : '↻ Odśwież' }}
        </button>
      </div>

      <!-- Loading state -->
      @if (svc.loading()) {
        <p class="text-slate-500">Ładowanie ofert…</p>
      }

      <!-- Offer cards -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (offer of svc.offers(); track offer.id) {
          <div class="lo-card flex flex-col gap-3 p-4">

            <!-- Company + source badge -->
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-xs font-medium uppercase tracking-widest text-slate-400">
                  {{ offer.company }}
                </p>
                <p class="mt-0.5 font-semibold leading-tight">{{ offer.title }}</p>
              </div>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                [class]="offer.source === 'justjoin'
                  ? 'bg-pink-900/60 text-pink-300'
                  : 'bg-sky-900/60 text-sky-300'"
              >
                {{ offer.source === 'justjoin' ? 'JustJoin' : 'NoFluffJobs' }}
              </span>
            </div>

            <!-- Salary -->
            <p class="text-lg font-bold">
              @if (offer.salary_from || offer.salary_to) {
                {{ offer.salary_from | number }} – {{ offer.salary_to | number }}
                <span class="text-sm font-normal text-slate-400">{{ offer.currency ?? 'PLN' }}</span>
              } @else {
                <span class="text-sm font-normal text-slate-500">brak danych o wynagrodzeniu</span>
              }
            </p>

            <!-- Location + remote -->
            <div class="flex items-center gap-2 text-xs text-slate-400">
              @if (offer.remote) {
                <span class="rounded bg-emerald-900/50 px-1.5 py-0.5 text-emerald-400 font-medium">remote</span>
              }
              @if (offer.location) {
                <span>📍 {{ offer.location }}</span>
              }
            </div>

            <!-- Actions -->
            <div class="mt-auto flex gap-2 pt-1">
              <a
                [href]="offer.url"
                target="_blank"
                rel="noopener noreferrer"
                class="lo-btn flex-1 text-center text-sm"
              >
                Otwórz ↗
              </a>
              <button
                class="lo-btn-ghost px-3 text-sm text-slate-400 hover:text-red-400"
                title="Odrzuć ofertę"
                (click)="svc.dismiss(offer.id)"
              >
                Odrzuć
              </button>
            </div>

          </div>
        } @empty {
          @if (!svc.loading()) {
            <div class="sm:col-span-2 lg:col-span-3">
              <p class="text-slate-500">Brak ofert. Kliknij "Odśwież" żeby pobrać nowe.</p>
            </div>
          }
        }
      </div>

    </div>
  `,
})
export class JobSearchComponent implements OnInit {
  svc = inject(JobSearchService);

  ngOnInit(): void {
    this.svc.load();
  }
}
