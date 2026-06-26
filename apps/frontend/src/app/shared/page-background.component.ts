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

interface ThemeCfg {
  /** Asset path (served from apps/frontend/assets via angular.json). */
  img: string;
  /** background-position — landscapes use center, character art uses a side. */
  position: string;
  /** Subtle per-page accent (active states / flat buttons). Fonts stay uniform. */
  accent: string;
}

const A = 'assets/';

// 6 wallpapers across 7 views (Dashboard + Inbox share the Death Note art).
const THEMES: Record<BgTheme, ThemeCfg> = {
  dashboard: { img: A + 'vector-art-of-death-note-l-sb6g7xhxrv07jiho.jpg', position: 'right center', accent: '#c2453f' },
  inbox: { img: A + 'vector-art-of-death-note-l-sb6g7xhxrv07jiho.jpg', position: 'right center', accent: '#c2453f' },
  maintenance: { img: A + 'the-witcher-3-wild-hunt-minimalist-05.jpg', position: 'center', accent: '#b8893f' },
  wardrobe: { img: A + 'e09dd11042aa799ece289bb55065b94c.jpg', position: 'right center', accent: '#b23b4a' },
  investments: { img: A + 'minimalist-star-wars-display-isxi8qx4rmm2eex2.jpg', position: 'center', accent: '#4d7ea8' },
  trips: { img: A + '1353023.png', position: 'center', accent: '#3aa0a0' },
  habits: { img: A + 'attack-on-titans-trio-minimalist-anime-t4rkd9q550lrcc6j.jpg', position: 'center', accent: '#6f8f5a' },
  // Subscriptions reuses the Star Wars art — "dark side" money flows.
  subscriptions: { img: A + 'minimalist-star-wars-display-isxi8qx4rmm2eex2.jpg', position: 'center', accent: '#3d8c5e' },
  chat: { img: A + 'vector-art-of-death-note-l-sb6g7xhxrv07jiho.jpg', position: 'right center', accent: '#5b68d4' },
  'job-search': { img: A + 'minimalist-star-wars-display-isxi8qx4rmm2eex2.jpg', position: 'center', accent: '#3b82f6' },
};

/**
 * Publishes the page's accent colour as the CSS var --page-accent (used by flat
 * buttons / active states). The app now uses a single global background
 * (see styles.css), so this component no longer paints a per-page wallpaper.
 */
@Component({
  selector: 'app-page-background',
  standalone: true,
  template: '',
})
export class PageBackgroundComponent {
  theme = input.required<BgTheme>();
  cfg = computed(() => THEMES[this.theme()]);

  constructor() {
    effect(() => {
      document.documentElement.style.setProperty('--page-accent', this.cfg().accent);
    });
  }
}
