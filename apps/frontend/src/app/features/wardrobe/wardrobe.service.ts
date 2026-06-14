import { Injectable, inject, signal } from '@angular/core';
import type { Wardrobe, WardrobeItem } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WardrobeService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly wardrobe = signal<Wardrobe | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<Wardrobe>('/api/wardrobe').subscribe({
      next: (w) => this.wardrobe.set(this.withPhotoUrls(w)),
      error: () => {
        this.error.set('Could not load wardrobe. Is the JSON present in Google Drive?');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  /** Turn relative photo paths into absolute, token-bearing URLs for <img>. */
  private withPhotoUrls(w: Wardrobe): Wardrobe {
    const token = encodeURIComponent(this.auth.token() ?? '');
    const fix = (items: WardrobeItem[]) =>
      items.map((it) => ({
        ...it,
        photoUrl: it.photoUrl ? `${environment.apiBase}${it.photoUrl}?token=${token}` : undefined,
      }));
    return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, fix(v)])) as Wardrobe;
  }
}
