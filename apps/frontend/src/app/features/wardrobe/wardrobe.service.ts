import { Injectable, inject, signal } from '@angular/core';
import type { CreateWardrobeItemInput, Wardrobe, WardrobeItem, WardrobeSection } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WardrobeService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly wardrobe = signal<Wardrobe | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<Wardrobe>('/api/wardrobe').subscribe({
      next: (w) => this.wardrobe.set(this.withPhotoUrls(w)),
      error: () => {
        this.error.set('Nie udało się załadować garderoby. Czy plik JSON jest na Google Drive?');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  addItem(input: CreateWardrobeItemInput): void {
    this.saving.set(true);
    this.error.set(null);
    this.api.post<Wardrobe>('/api/wardrobe/item', input).subscribe({
      next: (w) => this.wardrobe.set(this.withPhotoUrls(w)),
      error: () => {
        this.error.set('Błąd podczas dodawania ubrania.');
        this.saving.set(false);
      },
      complete: () => this.saving.set(false),
    });
  }

  updateItem(section: WardrobeSection, index: number, nazwa: string): void {
    this.saving.set(true);
    this.error.set(null);
    this.api.patch<Wardrobe>(`/api/wardrobe/item/${section}/${index}`, { nazwa }).subscribe({
      next: (w) => this.wardrobe.set(this.withPhotoUrls(w)),
      error: () => {
        this.error.set('Błąd podczas edytowania ubrania.');
        this.saving.set(false);
      },
      complete: () => this.saving.set(false),
    });
  }

  deleteItem(section: WardrobeSection, index: number): void {
    this.saving.set(true);
    this.error.set(null);
    this.api.delete<Wardrobe>(`/api/wardrobe/item/${section}/${index}`).subscribe({
      next: (w) => this.wardrobe.set(this.withPhotoUrls(w)),
      error: () => {
        this.error.set('Błąd podczas usuwania ubrania.');
        this.saving.set(false);
      },
      complete: () => this.saving.set(false),
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
