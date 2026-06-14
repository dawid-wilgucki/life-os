import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'lo_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);
  private _token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  readonly token = this._token.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token());

  /** After OAuth redirect the Worker sends `#token=...`; capture and store it. */
  captureTokenFromUrl(): void {
    const match = window.location.hash.match(/token=([^&]+)/);
    if (!match) return;
    this.setToken(decodeURIComponent(match[1]));
    history.replaceState(null, '', window.location.pathname);
    this.router.navigateByUrl('/');
  }

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this._token.set(token);
  }

  login(): void {
    window.location.href = `${environment.apiBase}/auth/google`;
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this._token.set(null);
    this.router.navigateByUrl('/login');
  }
}
