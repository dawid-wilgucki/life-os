import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Thin typed wrapper that prefixes the Worker base URL. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBase;

  get<T>(path: string, params?: Record<string, string | number | boolean>) {
    let httpParams = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      httpParams = httpParams.set(k, String(v));
    }
    return this.http.get<T>(this.base + path, { params: httpParams });
  }

  post<T>(path: string, body?: unknown) {
    return this.http.post<T>(this.base + path, body ?? {});
  }

  patch<T>(path: string, body?: unknown) {
    return this.http.patch<T>(this.base + path, body ?? {});
  }

  delete<T>(path: string) {
    return this.http.delete<T>(this.base + path);
  }
}
