import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';

/** One column of the chart. `value: null` = no data (no bar is drawn). */
export interface BarDatum {
  key: string;
  /** Short axis label (shown sparsely). */
  label: string;
  /** Full label for the tooltip. */
  tooltipLabel: string;
  value: number | null;
  /** Drawn in the recessive step (e.g. history imported from the cloud). */
  muted?: boolean;
  /** Background band behind the column (e.g. a break period). */
  shaded?: boolean;
  /** Extra note for the tooltip. */
  note?: string;
}

const PAD_LEFT = 40;
const PAD_RIGHT = 6;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const MAX_BAR = 24;
const GAP = 2;

/** Round up to 1 / 2 / 2.5 / 5 × 10^k so the axis gets clean ticks. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= v) return m * base;
  return 10 * base;
}

/**
 * Minimal single-series column chart in inline SVG (no chart library).
 * Columns ≤ 24 px with a 4 px rounded data-end, 2 px gaps, hairline grid,
 * per-column hover/focus tooltip; renders at the container's real pixel width.
 */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host { display: block; position: relative; min-width: 0; }
      svg { max-width: 100%; }
      .hit { outline: none; cursor: default; }
    `,
  ],
  template: `
    <svg
      [attr.width]="width()"
      [attr.height]="height()"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      role="img"
      [attr.aria-label]="ariaLabel()"
      class="block select-none"
      (mouseleave)="hovered.set(null)"
    >
      <!-- break bands -->
      @for (b of geometry().bands; track b.x) {
        <rect [attr.x]="b.x" [attr.y]="padTop" [attr.width]="b.w" [attr.height]="geometry().plotH" fill="rgba(148,163,184,0.09)" />
      }
      <!-- grid + y ticks -->
      @for (t of geometry().ticks; track t.y) {
        <line [attr.x1]="padLeft" [attr.x2]="width() - padRight" [attr.y1]="t.y" [attr.y2]="t.y" stroke="rgba(148,163,184,0.16)" stroke-width="1" shape-rendering="crispEdges" />
        <text [attr.x]="padLeft - 6" [attr.y]="t.y + 3" text-anchor="end" font-size="10" fill="#64748b" style="font-variant-numeric: tabular-nums">{{ t.label }}</text>
      }
      <!-- bars -->
      @for (bar of geometry().bars; track bar.key) {
        @if (bar.d) {
          <path [attr.d]="bar.d" [attr.fill]="barFill(bar.muted, hovered() === bar.i)" />
        }
      }
      <!-- x labels -->
      @for (l of geometry().labels; track l.x) {
        <text [attr.x]="l.x" [attr.y]="height() - 5" text-anchor="middle" font-size="10" fill="#64748b">{{ l.text }}</text>
      }
      <!-- hit targets (bigger than the marks) -->
      @for (bar of geometry().bars; track bar.key) {
        <rect
          class="hit"
          [attr.x]="bar.slotX"
          [attr.y]="padTop"
          [attr.width]="bar.slotW"
          [attr.height]="geometry().plotH"
          fill="transparent"
          tabindex="0"
          [attr.aria-label]="bar.aria"
          (mouseenter)="hovered.set(bar.i)"
          (focus)="hovered.set(bar.i)"
          (blur)="hovered.set(null)"
        />
      }
    </svg>

    @if (tooltip(); as tip) {
      <div
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-white/10 bg-slate-900/95 px-2 py-1 text-xs shadow-lg"
        [style.left.px]="tip.x"
        [style.top.px]="tip.y - 6"
      >
        <div class="font-semibold text-slate-100">
          @if (tip.value === null) {
            brak danych
          } @else {
            {{ tip.value | number: '1.0-' + decimals() }} {{ unit() }}
          }
        </div>
        <div class="text-slate-400">{{ tip.label }}</div>
        @if (tip.note) {
          <div class="text-slate-500">{{ tip.note }}</div>
        }
      </div>
    }
  `,
})
export class BarChartComponent implements OnInit, OnDestroy {
  data = input.required<BarDatum[]>();
  unit = input<string>('');
  decimals = input<number>(1);
  /** Show every n-th x label. */
  labelEvery = input<number>(1);
  height = input<number>(170);
  ariaLabel = input<string>('Wykres słupkowy');

  readonly padLeft = PAD_LEFT;
  readonly padRight = PAD_RIGHT;
  readonly padTop = PAD_TOP;

  readonly width = signal(320);
  readonly hovered = signal<number | null>(null);

  private host = inject(ElementRef<HTMLElement>);
  private observer?: ResizeObserver;

  ngOnInit(): void {
    const el = this.host.nativeElement as HTMLElement;
    this.width.set(Math.max(200, Math.floor(el.clientWidth) || 320));
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const w = Math.floor(entries[0]?.contentRect.width ?? 0);
        if (w > 0 && w !== this.width()) this.width.set(Math.max(200, w));
      });
      this.observer.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  readonly geometry = computed(() => {
    const data = this.data();
    const w = this.width();
    const h = this.height();
    const plotW = Math.max(1, w - PAD_LEFT - PAD_RIGHT);
    const plotH = Math.max(1, h - PAD_TOP - PAD_BOTTOM);
    const base = PAD_TOP + plotH;
    const n = Math.max(1, data.length);
    const slotW = plotW / n;
    const barW = Math.max(1, Math.min(MAX_BAR, slotW - GAP));
    const maxVal = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
    const dec = this.decimals();
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.min(2, Math.max(1, dec))));

    const ticks = [0, maxVal / 2, maxVal].map((v) => ({ y: base - (v / maxVal) * plotH, label: fmt(v) }));

    const bars = data.map((d, i) => {
      const slotX = PAD_LEFT + i * slotW;
      const x = slotX + (slotW - barW) / 2;
      let path: string | null = null;
      if (d.value !== null && d.value > 0) {
        const bh = Math.max(1, (d.value / maxVal) * plotH);
        const top = base - bh;
        const r = Math.min(4, barW / 2, bh);
        path =
          `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} ` +
          `H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
      }
      const valueTxt = d.value === null ? 'brak danych' : `${d.value.toFixed(dec)} ${this.unit()}`;
      return {
        key: d.key,
        i,
        d: path,
        muted: Boolean(d.muted),
        slotX,
        slotW,
        cx: slotX + slotW / 2,
        top: d.value ? base - Math.max(1, (d.value / maxVal) * plotH) : base,
        aria: `${d.tooltipLabel}: ${valueTxt}${d.note ? ` (${d.note})` : ''}`,
      };
    });

    // Merge adjacent shaded columns into continuous bands.
    const bands: Array<{ x: number; w: number }> = [];
    data.forEach((d, i) => {
      if (!d.shaded) return;
      const x = PAD_LEFT + i * slotW;
      const last = bands[bands.length - 1];
      if (last && Math.abs(last.x + last.w - x) < 0.5) last.w += slotW;
      else bands.push({ x, w: slotW });
    });

    const every = Math.max(1, this.labelEvery());
    const labels = data
      .map((d, i) => ({ x: PAD_LEFT + i * slotW + slotW / 2, text: d.label, i }))
      .filter((l) => l.i % every === 0 && l.text);

    return { bars, bands, ticks, labels, plotH };
  });

  readonly tooltip = computed(() => {
    const i = this.hovered();
    if (i === null) return null;
    const d = this.data()[i];
    const bar = this.geometry().bars[i];
    if (!d || !bar) return null;
    const x = Math.min(Math.max(bar.cx, 60), this.width() - 60);
    return { x, y: bar.top, value: d.value, label: d.tooltipLabel, note: d.note };
  });

  barFill(muted: boolean, hovered: boolean): string {
    if (muted) return hovered ? '#256abf' : '#1c5cab';
    return hovered ? '#5598e7' : '#3987e5';
  }
}
