import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <div class="flex min-h-screen items-center justify-center p-6">
      <div class="lo-card w-full max-w-sm p-8 text-center">
        <div class="text-4xl">🧭</div>
        <h1 class="mt-3 text-2xl font-semibold">Life.OS</h1>
        <p class="mt-1 text-sm text-slate-400">Your personal command center.</p>
        <button class="lo-btn mt-6 w-full" (click)="login()">Sign in with Google</button>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  login(): void {
    this.auth.login();
  }
}
