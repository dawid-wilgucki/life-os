import { Injectable, inject, signal, computed } from '@angular/core';
import type { Subscription, CreateSubscriptionInput, BillingCycle } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private api = inject(ApiService);

  readonly subs = signal<Subscription[]>([]);
  readonly loading = signal(false);

  /** Monthly-equivalent total across all billing cycles. */
  readonly monthlyTotal = computed(() =>
    this.subs().reduce((sum, s) => sum + toMonthly(s.costPln, s.billingCycle), 0),
  );

  load(): void {
    this.loading.set(true);
    this.api.get<Subscription[]>('/api/subscriptions').subscribe({
      next: (s) => this.subs.set(s),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  add(input: CreateSubscriptionInput): void {
    this.api.post<Subscription>('/api/subscriptions', input).subscribe((s) =>
      this.subs.update((arr) => [...arr, s]),
    );
  }

  remove(id: string): void {
    this.api.delete(`/api/subscriptions/${id}`).subscribe(() =>
      this.subs.update((arr) => arr.filter((s) => s.id !== id)),
    );
  }
}

export function toMonthly(cost: number, cycle: BillingCycle): number {
  if (cycle === 'yearly') return cost / 12;
  if (cycle === 'weekly') return (cost * 52) / 12;
  return cost;
}
