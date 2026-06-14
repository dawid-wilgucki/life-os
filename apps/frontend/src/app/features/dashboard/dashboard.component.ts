import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Tile {
  path: string;
  label: string;
  icon: string;
  blurb: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="mx-auto max-w-5xl p-6">
      <h1 class="text-2xl font-semibold">Dashboard</h1>
      <p class="mt-1 text-sm text-slate-400">Jump into a module.</p>

      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (tile of tiles; track tile.path) {
          <a [routerLink]="'/' + tile.path" class="lo-card group p-5 transition hover:border-indigo-500/60">
            <div class="flex items-center gap-3">
              <span class="text-2xl">{{ tile.icon }}</span>
              <span class="font-medium group-hover:text-white">{{ tile.label }}</span>
            </div>
            <p class="mt-2 text-sm text-slate-400">{{ tile.blurb }}</p>
          </a>
        }
      </div>
    </div>
  `,
})
export class DashboardComponent {
  tiles: Tile[] = [
    { path: 'tasks', label: 'Tasks', icon: '✅', blurb: 'Google Tasks, Keep-style.' },
    { path: 'calendar', label: 'Calendar', icon: '📅', blurb: 'Your Google Calendar.' },
    { path: 'inbox', label: 'Inbox', icon: '📥', blurb: 'Capture now, sort later.' },
    { path: 'investments', label: 'Investments', icon: '📈', blurb: 'Gold + GEM strategy.' },
    { path: 'wardrobe', label: 'Wardrobe', icon: '👕', blurb: 'Your clothing catalogue.' },
    { path: 'trips', label: 'Trips', icon: '🚆', blurb: 'Travel log & tickets.' },
    { path: 'maintenance', label: 'Maintenance', icon: '🔧', blurb: 'Home, garden & car.' },
    { path: 'habits', label: 'Habits', icon: '🔥', blurb: 'Streaks & daily check-ins.' },
  ];
}
