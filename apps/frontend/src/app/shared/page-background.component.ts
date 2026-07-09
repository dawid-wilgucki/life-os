import { Component, computed, effect, input } from '@angular/core';

export type BgTheme =
  | 'dashboard'
  | 'maintenance'
  | 'wardrobe'
  | 'investments'
  | 'trips'
  | 'habits'
  | 'inbox'
  | 'subscriptions'
  | 'chat'
  | 'job-search';

/** Subtle per-page accent (active states / flat buttons). Fonts stay uniform. */
const ACCENTS: Record<BgTheme, string> = {
  dashboard: '#c2453f',
  inbox: '#c2453f',
  maintenance: '#b8893f',
  wardrobe: '#b23b4a',
  investments: '#4d7ea8',
  trips: '#3aa0a0',
  habits: '#6f8f5a',
  subscriptions: '#3d8c5e',
  chat: '#5b68d4',
  'job-search': '#3b82f6',
};

/**
 * Publishes the page's accent colour as the CSS var --page-accent (used by flat
 * buttons / active states). The app uses a single global background
 * (see styles.css), so this component paints nothing itself.
 */
@Component({
  selector: 'app-page-background',
  standalone: true,
  template: '',
})
export class PageBackgroundComponent {
  theme = input.required<BgTheme>();
  accent = computed(() => ACCENTS[this.theme()]);

  constructor() {
    effect(() => {
      document.documentElement.style.setProperty('--page-accent', this.accent());
    });
  }
}
