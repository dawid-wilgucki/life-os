import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { CreateSubscriptionInput } from '@life-os/shared-types';
import { SubscriptionsService, toMonthly } from './subscriptions.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

@Component({
  selector: 'app-subscriptions',
  standalone: true,
  imports: [FormsModule, DatePipe, DecimalPipe, PageBackgroundComponent],
  template: `
    <app-page-background theme="subscriptions" />
    <div class="relative mx-auto max-w-4xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Subskrypcje</h1>
          <p class="text-sm text-slate-400">Miesięczne wydatki na serwisy i usługi.</p>
        </div>
        <button class="lo-btn px-4" (click)="showForm.set(!showForm())">
          {{ showForm() ? '✕ Anuluj' : '+ Dodaj' }}
        </button>
      </div>

      <!-- Total monthly cost banner -->
      <div class="lo-card mb-6 flex items-center justify-between p-5">
        <div>
          <p class="text-xs text-slate-400 uppercase tracking-widest">Łącznie / miesiąc</p>
          <p class="mt-1 text-4xl font-bold text-white">
            {{ svc.monthlyTotal() | number: '1.2-2' }}
            <span class="text-xl font-normal text-slate-400">zł</span>
          </p>
        </div>
        <span class="text-5xl opacity-20">💳</span>
      </div>

      <!-- Add form -->
      @if (showForm()) {
        <form class="lo-card mb-6 grid gap-3 p-5 sm:grid-cols-2" (ngSubmit)="submit()">
          <div class="flex gap-2">
            <input class="lo-input w-16 text-center" placeholder="🎬" [(ngModel)]="f.icon" name="icon" maxlength="2" />
            <input class="lo-input flex-1" placeholder="Nazwa (np. Netflix)" [(ngModel)]="f.name" name="name" required />
          </div>
          <div class="flex items-center gap-2">
            <input
              class="lo-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Koszt (zł)"
              [(ngModel)]="f.cost"
              name="cost"
              required
            />
            <select class="lo-input" [(ngModel)]="f.cycle" name="cycle">
              <option value="monthly">/ miesiąc</option>
              <option value="yearly">/ rok</option>
              <option value="weekly">/ tydzień</option>
            </select>
          </div>
          <label class="text-xs text-slate-400 sm:col-span-2">
            Data odnowienia
            <input class="lo-input mt-1" type="date" [(ngModel)]="f.renewal" name="renewal" />
          </label>
          <button type="submit" class="lo-btn sm:col-span-2">Dodaj subskrypcję</button>
        </form>
      }

      <!-- Grid -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (s of svc.subs(); track s.id) {
          <div class="lo-card relative flex flex-col gap-2 p-4">
            <button
              class="absolute right-3 top-3 text-slate-600 transition hover:text-red-400"
              title="Usuń"
              (click)="remove(s.id, s.name)"
            >✕</button>

            <div class="flex items-center gap-3">
              <span class="text-3xl">{{ s.icon || '📦' }}</span>
              <div class="min-w-0">
                <p class="truncate font-medium">{{ s.name }}</p>
                <p class="text-[11px] text-slate-500">
                  {{ cycleLabel(s.billingCycle) }}
                  @if (s.billingCycle !== 'monthly') {
                    · {{ toMonthly(s.costPln, s.billingCycle) | number: '1.2-2' }} zł/mies
                  }
                </p>
              </div>
            </div>

            <p class="text-2xl font-semibold">
              {{ s.costPln | number: '1.2-2' }}
              <span class="text-sm font-normal text-slate-400">zł</span>
            </p>

            @if (s.renewalDate) {
              <p class="text-xs text-slate-500">
                Odnowienie: {{ s.renewalDate | date: 'd MMM yyyy' }}
                <span [class]="daysUntilClass(s.renewalDate)">
                  ({{ daysUntil(s.renewalDate) }} dni)
                </span>
              </p>
            }
          </div>
        } @empty {
          @if (!svc.loading()) {
            <p class="text-slate-500 sm:col-span-3">Brak subskrypcji. Dodaj pierwszą powyżej.</p>
          }
        }
      </div>
    </div>
  `,
})
export class SubscriptionsComponent implements OnInit {
  svc = inject(SubscriptionsService);
  showForm = signal(false);
  toMonthly = toMonthly;

  f: { name: string; icon: string; cost: number; cycle: 'monthly' | 'yearly' | 'weekly'; renewal: string } = {
    name: '', icon: '', cost: 0, cycle: 'monthly', renewal: '',
  };

  ngOnInit(): void {
    this.svc.load();
  }

  submit(): void {
    if (!this.f.name.trim()) return;
    const input: CreateSubscriptionInput = {
      name: this.f.name.trim(),
      icon: this.f.icon.trim() || undefined,
      costPln: this.f.cost ?? 0,
      billingCycle: this.f.cycle,
      renewalDate: this.f.renewal || undefined,
    };
    this.svc.add(input);
    this.f = { name: '', icon: '', cost: 0, cycle: 'monthly', renewal: '' };
    this.showForm.set(false);
  }

  remove(id: string, name: string): void {
    if (confirm(`Usuń "${name}"?`)) this.svc.remove(id);
  }

  cycleLabel(c: string): string {
    return c === 'yearly' ? 'roczna' : c === 'weekly' ? 'tygodniowa' : 'miesięczna';
  }

  daysUntil(date: string): number {
    return Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  }

  daysUntilClass(date: string): string {
    const d = this.daysUntil(date);
    if (d < 0) return 'text-red-400';
    if (d <= 7) return 'text-amber-400';
    return 'text-slate-500';
  }
}
