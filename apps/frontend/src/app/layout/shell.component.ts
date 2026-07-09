import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { InboxService } from '../features/inbox/inbox.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
    <div class="flex min-h-screen">
      <!-- Sidebar (drawer on mobile, fixed on lg+) -->
      <aside
        class="fixed inset-y-0 left-0 z-50 flex w-60 transform flex-col border-r border-surface-800
               bg-surface-900 transition-transform lg:static lg:translate-x-0"
        [class.translate-x-0]="sidebarOpen()"
        [class.-translate-x-full]="!sidebarOpen()"
      >
        <div class="flex h-14 shrink-0 items-center gap-2 border-b border-surface-800 px-4">
          <svg width="22" height="22" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M150 366 C150 232 252 150 384 150 C384 284 282 366 150 366 Z" fill="#FF6B2B"/>
          </svg>
          <span class="font-semibold tracking-tight">Life.OS</span>
        </div>
        <nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
          @for (item of nav; track item.path) {
            <a
              [routerLink]="'/' + item.path"
              [routerLinkActive]="'bg-surface-800 text-white'"
              [routerLinkActiveOptions]="{ exact: item.path === '' }"
              (click)="sidebarOpen.set(false)"
              class="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300
                     transition hover:bg-surface-800 hover:text-white"
            >
              <span class="text-base">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
        <div class="shrink-0 border-t border-surface-800 p-3">
          <button class="lo-btn-ghost w-full justify-start" (click)="logout()">
            <span>🚪</span><span>Wyloguj</span>
          </button>
        </div>
      </aside>

      <!-- Backdrop on mobile -->
      @if (sidebarOpen()) {
        <div class="fixed inset-0 z-40 bg-black/50 lg:hidden" (click)="sidebarOpen.set(false)"></div>
      }

      <!-- Main -->
      <div class="flex min-w-0 flex-1 flex-col">
        <!-- Always-visible top bar on mobile (fixed; padded past the notch in standalone PWA mode) -->
        <header
          class="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-surface-800
                 bg-surface-950/90 px-4 backdrop-blur lg:hidden"
          style="height: var(--top-bar-h); padding-top: env(safe-area-inset-top, 0px)"
        >
          <button class="lo-btn-ghost px-2 py-2" (click)="toggleSidebar()" aria-label="Menu">☰</button>
          <svg width="20" height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M150 366 C150 232 252 150 384 150 C384 284 282 366 150 366 Z" fill="#FF6B2B"/>
          </svg>
          <span class="font-semibold">Life.OS</span>
        </header>
        <main
          class="min-w-0 flex-1 overflow-x-hidden"
          style="padding-top: var(--top-bar-h); padding-bottom: var(--bottom-nav-h)"
        >
          <router-outlet />
        </main>
      </div>

      <!-- Bottom tab bar (mobile only) -->
      <nav
        class="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-surface-800
               bg-surface-950/90 backdrop-blur lg:hidden"
        style="height: var(--bottom-nav-h); padding-bottom: env(safe-area-inset-bottom, 0px)"
      >
        @for (item of bottomNav; track item.path) {
          <a
            [routerLink]="'/' + item.path"
            [routerLinkActive]="'text-white'"
            [routerLinkActiveOptions]="{ exact: item.path === '' }"
            class="flex flex-1 flex-col items-center justify-center gap-0.5 text-slate-400"
          >
            <span class="text-xl leading-none">{{ item.icon }}</span>
            <span class="text-[10px]">{{ item.label }}</span>
          </a>
        }
        <button
          class="flex flex-1 flex-col items-center justify-center gap-0.5 text-slate-400"
          (click)="toggleSidebar()"
        >
          <span class="text-xl leading-none">☰</span>
          <span class="text-[10px]">Więcej</span>
        </button>
      </nav>

      <!-- FAB: quick capture to inbox (mobile only; hidden where a capture input already exists) -->
      @if (showFab()) {
        <button
          class="lo-btn fixed right-4 z-40 h-14 w-14 rounded-full text-2xl shadow-lg lg:hidden"
          style="bottom: calc(var(--bottom-nav-h) + 1rem)"
          (click)="openQuickAdd()"
          aria-label="Szybki zapis do inboxa"
        >+</button>
      }

      <!-- Quick capture bottom sheet -->
      @if (quickAddOpen()) {
        <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/60" (click)="closeQuickAdd()">
          <div
            class="w-full max-w-md rounded-t-2xl border border-surface-800 bg-surface-900 p-4"
            style="padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px))"
            (click)="$event.stopPropagation()"
          >
            <h2 class="mb-3 text-sm font-medium text-slate-300">📥 Szybki zapis do inboxa</h2>
            <form (ngSubmit)="submitQuickAdd()">
              <textarea
                class="lo-input resize-none"
                rows="3"
                placeholder="Zapisz myśl…"
                [(ngModel)]="quickText"
                name="quick-text"
                autofocus
              ></textarea>
              <div class="mt-3 flex justify-end gap-2">
                <button type="button" class="lo-btn-ghost" (click)="closeQuickAdd()">Anuluj</button>
                <button type="submit" class="lo-btn px-4" [disabled]="quickSaving() || !quickText.trim()">
                  {{ quickSaving() ? 'Zapisuję…' : 'Dodaj' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Toasts (above the bottom nav) -->
      @if (toastSvc.toasts().length) {
        <div
          class="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
          style="bottom: calc(var(--bottom-nav-h) + 0.75rem)"
        >
          @for (t of toastSvc.toasts(); track t.id) {
            <button
              class="pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-left text-sm shadow-lg"
              [class.bg-red-950]="t.kind === 'error'"
              [class.text-red-200]="t.kind === 'error'"
              [class.border]="true"
              [class.border-red-800]="t.kind === 'error'"
              [class.bg-emerald-950]="t.kind === 'success'"
              [class.text-emerald-200]="t.kind === 'success'"
              [class.border-emerald-800]="t.kind === 'success'"
              (click)="toastSvc.dismiss(t.id)"
            >
              {{ t.text }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class ShellComponent {
  private auth = inject(AuthService);
  private inbox = inject(InboxService);
  private router = inject(Router);
  toastSvc = inject(ToastService);
  sidebarOpen = signal(false);

  // ── Quick capture (FAB → bottom sheet → inbox) ────────────────────────────

  private currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Chat and Inbox already have their own capture inputs the FAB would cover. */
  showFab = computed(() => {
    const url = this.currentUrl();
    return !url.startsWith('/chat') && !url.startsWith('/inbox');
  });

  quickAddOpen = signal(false);
  quickSaving = signal(false);
  quickText = '';

  openQuickAdd(): void {
    this.quickAddOpen.set(true);
  }

  closeQuickAdd(): void {
    this.quickAddOpen.set(false);
  }

  submitQuickAdd(): void {
    const text = this.quickText.trim();
    if (!text || this.quickSaving()) return;
    this.quickSaving.set(true);
    this.inbox.add(text).subscribe({
      next: () => {
        this.quickSaving.set(false);
        this.quickText = '';
        this.quickAddOpen.set(false);
        this.toastSvc.success('Dodano do inboxa.');
      },
      error: () => {
        this.quickSaving.set(false);
        this.toastSvc.error('Nie udało się zapisać. Spróbuj ponownie.');
      },
    });
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.quickAddOpen()) this.closeQuickAdd();
    else if (this.sidebarOpen()) this.sidebarOpen.set(false);
  }

  nav: NavItem[] = [
    { path: '', label: 'Pulpit', icon: '🏠' },
    { path: 'tasks', label: 'Listy', icon: '✅' },
    { path: 'calendar', label: 'Kalendarz', icon: '📅' },
    { path: 'inbox', label: 'Inbox', icon: '📥' },
    { path: 'investments', label: 'Inwestycje', icon: '📈' },
    { path: 'wardrobe', label: 'Garderoba', icon: '👕' },
    { path: 'trips', label: 'Podróże', icon: '🚆' },
    { path: 'maintenance', label: 'Konserwacja', icon: '🔧' },
    { path: 'habits', label: 'Nawyki', icon: '🔥' },
    { path: 'subscriptions', label: 'Subskrypcje', icon: '💳' },
    { path: 'job-search', label: 'Oferty pracy', icon: '💼' },
    { path: 'chat', label: 'Asystent AI', icon: '✨' },
    { path: 'profile', label: 'O mnie', icon: '👤' },
  ];

  /** The 4 most-used destinations; everything else lives behind "Więcej". */
  bottomNav: NavItem[] = [
    { path: '', label: 'Pulpit', icon: '🏠' },
    { path: 'tasks', label: 'Listy', icon: '✅' },
    { path: 'calendar', label: 'Kalendarz', icon: '📅' },
    { path: 'chat', label: 'Asystent', icon: '✨' },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  logout(): void {
    this.auth.logout();
  }
}
