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
      <div class="mb-4 flex items-center justify-between">
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

      <!-- DB error banner -->
      @if (svc.loadError()) {
        <div class="mb-4 rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">
          ⚠ {{ svc.loadError() }}
        </div>
      }

      <!-- Fetch result with per-source details -->
      @if (svc.fetchResult(); as r) {
        <div class="mb-4 rounded-lg border p-4 text-sm"
          [class]="r.fetched > 0
            ? 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
            : 'border-slate-700 bg-slate-800/40 text-slate-400'"
        >
          @if (r.fetched > 0) {
            <p class="font-medium">✓ Znaleziono {{ r.fetched }} ofert, dodano {{ r.saved }} nowych.</p>
          } @else {
            <p class="font-medium">ℹ Scraper nie znalazł pasujących ofert.</p>
          }
          <p class="mt-1 text-xs opacity-70">
            JustJoin.IT: {{ r.sources.justjoin }} &nbsp;·&nbsp; NoFluffJobs: {{ r.sources.nofluffjobs }}
          </p>
        </div>
      }

      <!-- Loading -->
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
                <span class="rounded bg-emerald-900/50 px-1.5 py-0.5 font-medium text-emerald-400">remote</span>
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
          @if (!svc.loading() && !svc.loadError()) {
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
