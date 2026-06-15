import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'tasks',
        loadComponent: () => import('./features/tasks/tasks.component').then((m) => m.TasksComponent),
      },
      {
        path: 'calendar',
        loadComponent: () =>
          import('./features/calendar/calendar.component').then((m) => m.CalendarComponent),
      },
      {
        path: 'inbox',
        loadComponent: () => import('./features/inbox/inbox.component').then((m) => m.InboxComponent),
      },
      {
        path: 'investments',
        loadComponent: () =>
          import('./features/investments/investments.component').then((m) => m.InvestmentsComponent),
      },
      {
        path: 'wardrobe',
        loadComponent: () =>
          import('./features/wardrobe/wardrobe.component').then((m) => m.WardrobeComponent),
      },
      {
        path: 'trips',
        loadComponent: () => import('./features/trips/trips.component').then((m) => m.TripsComponent),
      },
      {
        path: 'maintenance',
        loadComponent: () =>
          import('./features/maintenance/maintenance.component').then((m) => m.MaintenanceComponent),
      },
      {
        path: 'habits',
        loadComponent: () =>
          import('./features/habits/habits.component').then((m) => m.HabitsComponent),
      },
      {
        path: 'subscriptions',
        loadComponent: () =>
          import('./features/subscriptions/subscriptions.component').then(
            (m) => m.SubscriptionsComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
