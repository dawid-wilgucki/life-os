import { ApplicationConfig, LOCALE_ID, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { registerLocaleData } from '@angular/common';
import localePl from '@angular/common/locales/pl';

import { routes } from './app.routes';
import { jwtInterceptor } from './core/jwt.interceptor';

// Polish dates/numbers app-wide (DatePipe, DecimalPipe, toLocale* defaults).
registerLocaleData(localePl);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    { provide: LOCALE_ID, useValue: 'pl' },
    // App-shell caching for fast repeat loads on mobile (prod builds only).
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
