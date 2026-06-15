import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-screen">
      <!-- Sidebar (drawer on mobile, fixed on lg+) -->
      <aside
        class="fixed inset-y-0 left-0 z-30 w-60 transform border-r border-surface-800
               bg-surface-900 transition-transform lg:static lg:translate-x-0"
        [class.translate-x-0]="sidebarOpen()"
        [class.-translate-x-full]="!sidebarOpen()"
      >
        <div class="flex h-14 items-center gap-2 border-b border-surface-800 px-4">
          <span class="text-lg">🧭</span>
          <span class="font-semibold tracking-tight">Life.OS</span>
        </div>
        <nav class="flex flex-col gap-1 p-3">
          @for (item of nav; track item.path) {
            <a
              [routerLink]="'/' + item.path"
              [routerLinkActive]="'bg-surface-800 text-white'"
              [routerLinkActiveOptions]="{ exact: item.path === '' }"
              (click)="sidebarOpen.set(false)"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300
                     transition hover:bg-surface-800 hover:text-white"
            >
              <span class="text-base">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
        <div class="absolute inset-x-0 bottom-0 p-3">
          <button class="lo-btn-ghost w-full justify-start" (click)="logout()">
            <span>🚪</span><span>Sign out</span>
          </button>
        </div>
      </aside>

      <!-- Backdrop on mobile -->
      @if (sidebarOpen()) {
        <div class="fixed inset-0 z-20 bg-black/50 lg:hidden" (click)="sidebarOpen.set(false)"></div>
      }

      <!-- Main -->
      <div class="flex min-w-0 flex-1 flex-col">
        <header
          class="flex h-14 items-center gap-3 border-b border-surface-800 bg-surface-950/80
                 px-4 backdrop-blur lg:hidden"
        >
          <button class="lo-btn-ghost px-2" (click)="toggleSidebar()">☰</button>
          <span class="font-semibold">Life.OS</span>
        </header>
        <main class="min-w-0 flex-1">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class ShellComponent {
  private auth = inject(AuthService);
  sidebarOpen = signal(false);

  nav: NavItem[] = [
    { path: '', label: 'Dashboard', icon: '🏠' },
    { path: 'tasks', label: 'Tasks', icon: '✅' },
    { path: 'calendar', label: 'Calendar', icon: '📅' },
    { path: 'inbox', label: 'Inbox', icon: '📥' },
    { path: 'investments', label: 'Investments', icon: '📈' },
    { path: 'wardrobe', label: 'Wardrobe', icon: '👕' },
    { path: 'trips', label: 'Trips', icon: '🚆' },
    { path: 'maintenance', label: 'Maintenance', icon: '🔧' },
    { path: 'habits', label: 'Habits', icon: '🔥' },
    { path: 'subscriptions', label: 'Subscriptions', icon: '💳' },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  logout(): void {
    this.auth.logout();
  }
}
