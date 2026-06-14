import { Component, computed, input } from '@angular/core';

export type BgTheme = 'dashboard' | 'maintenance' | 'wardrobe' | 'investments';

interface ThemeCfg {
  bg: string;
  art: string;
  inner: string;
}

const THEMES: Record<BgTheme, ThemeCfg> = {
  // Solid, matte backgrounds. `art` = main silhouette, `inner` = embedded scene.
  dashboard: { bg: '#15151b', art: '#26262f', inner: '#34343f' }, // charcoal — shinigami
  maintenance: { bg: '#162033', art: '#26344f', inner: '#37496e' }, // slate blue — wolf medallion
  wardrobe: { bg: '#271315', art: '#3d1c20', inner: '#56292e' }, // dark crimson — mask
  investments: { bg: '#11221a', art: '#1d3a2b', inner: '#28523c' }, // hunter green — eyes
};

/**
 * Flat, minimalist vector wallpaper behind a page. Solid matte colour + one
 * large original silhouette (2-3 solid colours) anchored bottom-right, with a
 * tiny embedded scene inside it. No gradients, no glow.
 */
@Component({
  selector: 'app-page-background',
  standalone: true,
  template: `
    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" [style.background]="cfg().bg">
      <svg
        class="absolute -bottom-16 right-[-6vw] h-[95vh] max-w-[72vw]"
        viewBox="0 0 400 420"
        preserveAspectRatio="xMidYMax meet"
        aria-hidden="true"
      >
        @switch (theme()) {
          @case ('dashboard') {
            <!-- Winged shinigami silhouette + two figures facing each other -->
            <g [attr.fill]="cfg().art">
              <path d="M200 120 L70 70 L110 165 L40 185 L120 230 L60 300 L150 270 L200 360 Z" />
              <path d="M200 120 L330 70 L290 165 L360 185 L280 230 L340 300 L250 270 L200 360 Z" />
              <path d="M188 110 q12 -46 24 0 l-3 150 q-9 22 -18 0 Z" />
            </g>
            <g [attr.fill]="cfg().inner">
              <circle cx="178" cy="296" r="7" />
              <rect x="172" y="304" width="12" height="26" rx="2" />
              <circle cx="222" cy="296" r="7" />
              <rect x="216" y="304" width="12" height="26" rx="2" />
            </g>
          }
          @case ('maintenance') {
            <!-- Geometric wolf medallion + tiny rider through forest -->
            <g [attr.fill]="cfg().art">
              <circle cx="200" cy="200" r="165" fill="none" [attr.stroke]="cfg().art" stroke-width="14" />
              <path d="M120 150 L150 78 L182 150 Z" />
              <path d="M280 150 L250 78 L218 150 Z" />
              <path d="M118 150 Q200 178 282 150 L200 320 Z" />
            </g>
            <g [attr.fill]="cfg().bg">
              <path d="M165 175 l24 4 l-14 22 Z" />
              <path d="M235 175 l-24 4 l14 22 Z" />
            </g>
            <g [attr.fill]="cfg().inner">
              <polygon points="150,250 158,228 166,250" />
              <polygon points="246,250 254,228 262,250" />
              <path d="M188 248 q12 -10 24 0 l4 10 l-8 0 l0 8 l-4 0 l0 -8 l-8 0 l0 8 l-4 0 l0 -8 l-8 0 Z" />
              <rect x="205" y="232" width="5" height="8" />
            </g>
          }
          @case ('wardrobe') {
            <!-- Ghoul-style half mask + power lines and a standing figure -->
            <g [attr.fill]="cfg().art">
              <path d="M120 90 Q200 60 280 90 Q320 200 270 320 Q200 370 130 320 Q80 200 120 90 Z" />
            </g>
            <g [attr.fill]="cfg().bg">
              <path d="M150 170 Q185 150 215 170 L205 192 Q185 182 162 192 Z" />
              <line x1="158" y1="150" x2="208" y2="150" [attr.stroke]="cfg().bg" stroke-width="4" />
              <line x1="160" y1="210" x2="206" y2="210" [attr.stroke]="cfg().bg" stroke-width="4" />
            </g>
            <g [attr.fill]="cfg().inner" [attr.stroke]="cfg().inner" stroke-width="2">
              <line x1="170" y1="250" x2="170" y2="300" />
              <line x1="155" y1="258" x2="185" y2="258" />
              <line x1="225" y1="250" x2="225" y2="300" />
              <line x1="210" y1="258" x2="240" y2="258" />
              <line x1="170" y1="258" x2="225" y2="262" fill="none" />
              <circle cx="200" cy="280" r="6" stroke="none" />
              <rect x="194" y="287" width="12" height="22" rx="2" stroke="none" />
            </g>
          }
          @case ('investments') {
            <!-- Stylised eyes over a city skyline -->
            <g [attr.fill]="cfg().art">
              <path d="M60 150 Q130 100 200 150 Q130 200 60 150 Z" />
              <path d="M200 150 Q270 100 340 150 Q270 200 200 150 Z" />
            </g>
            <g [attr.fill]="cfg().inner">
              <circle cx="130" cy="150" r="22" />
              <circle cx="270" cy="150" r="22" />
              <rect x="90" y="250" width="26" height="90" />
              <rect x="124" y="225" width="30" height="115" />
              <rect x="162" y="265" width="22" height="75" />
              <rect x="210" y="240" width="28" height="100" />
              <rect x="246" y="270" width="20" height="70" />
              <rect x="274" y="220" width="32" height="120" />
            </g>
          }
        }
      </svg>
    </div>
  `,
})
export class PageBackgroundComponent {
  theme = input.required<BgTheme>();
  cfg = computed(() => THEMES[this.theme()]);
}
