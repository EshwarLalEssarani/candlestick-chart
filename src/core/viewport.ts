/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { ResolvedOptions } from '../types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Index at `x` stays fixed while bar spacing changes. */
export function anchorZoom(viewport: Viewport, x: number, factor: number): void {
  const index = viewport.xToIndex(x);
  const spacing = clamp(viewport.barSpacing * factor, viewport.minBarSpacing, viewport.maxBarSpacing);
  viewport.barSpacing = spacing;
  viewport.rightIndex = index + (viewport.plotRight - x) / spacing;
}

/**
 * Maps bar indexes and prices into the plot.
 * `rightIndex` is the fractional bar index that sits on the right edge of the plot.
 * Increasing it moves candles left (toward newer data and empty future space).
 */
export class Viewport {
  width = 0;
  height = 0;
  dpr = 1;
  plotLeft = 8;
  plotTop = 8;
  plotWidth = 1;
  plotHeight = 1;
  candleBottom = 1;
  volumeTop = 1;
  volumeBottom = 1;
  rsiTop = 1;
  rsiBottom = 1;
  studyTop = 1;
  studyBottom = 1;
  studyMin = 0;
  studyMax = 1;
  barSpacing = 8;
  minBarSpacing = 0.001;
  maxBarSpacing = 48;
  rightIndex = 0;
  priceMin = 0;
  priceMax = 1;
  volumeMax = 0;

  get plotRight(): number {
    return this.plotLeft + this.plotWidth;
  }

  get plotBottom(): number {
    return this.plotTop + this.plotHeight;
  }

  layout(
    width: number,
    height: number,
    dpr: number,
    priceScaleWidth: number,
    timeScaleHeight: number,
    volumeRatio: number,
    rsiRatio = 0,
    studyRatio = 0,
  ): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.plotLeft = 8;
    this.plotTop = 8;
    this.plotWidth = Math.max(1, width - 8 - priceScaleWidth);
    this.plotHeight = Math.max(1, height - 8 - timeScaleHeight);
    const bottom = this.plotTop + this.plotHeight;
    const rsiH = rsiRatio > 0 ? this.plotHeight * rsiRatio : 0;
    const studyH = studyRatio > 0 ? this.plotHeight * studyRatio : 0;
    const volH = volumeRatio > 0 ? this.plotHeight * volumeRatio : 0;
    this.rsiBottom = bottom;
    this.rsiTop = bottom - rsiH;
    this.studyBottom = this.rsiTop;
    this.studyTop = this.studyBottom - studyH;
    this.volumeBottom = this.studyTop;
    this.volumeTop = this.volumeBottom - volH;
    this.candleBottom = volH > 0 ? this.volumeTop - 4 : this.volumeTop;
  }

  applySpacing(options: ResolvedOptions): void {
    this.minBarSpacing = options.timeScale.minBarSpacing;
    this.maxBarSpacing = options.timeScale.maxBarSpacing;
    this.barSpacing = clamp(this.barSpacing, this.minBarSpacing, this.maxBarSpacing);
  }

  indexToX(index: number): number {
    return this.plotRight - (this.rightIndex - index) * this.barSpacing;
  }

  xToIndex(x: number): number {
    return this.rightIndex - (this.plotRight - x) / this.barSpacing;
  }

  priceToY(price: number): number {
    const span = this.priceMax - this.priceMin || 1;
    const height = this.candleBottom - this.plotTop || 1;
    return this.plotTop + ((this.priceMax - price) / span) * height;
  }

  yToPrice(y: number): number {
    const span = this.priceMax - this.priceMin || 1;
    const height = this.candleBottom - this.plotTop || 1;
    return this.priceMax - ((y - this.plotTop) / height) * span;
  }

  visibleRange(length: number): { from: number; to: number } {
    if (length <= 0) return { from: 0, to: -1 };
    let from = Math.floor(this.xToIndex(this.plotLeft));
    let to = Math.ceil(this.xToIndex(this.plotRight));
    if (from < 0) from = 0;
    if (to > length - 1) to = length - 1;
    if (from > to) return { from: 0, to: -1 };
    return { from, to };
  }

  clampRightIndex(length: number, rightOffset: number): void {
    if (length <= 0) {
      this.rightIndex = 0;
      return;
    }
    const last = length - 1;
    const span = this.plotWidth / this.barSpacing;
    const min = 0;
    const max = last + Math.max(rightOffset, span);
    if (this.rightIndex < min) this.rightIndex = min;
    if (this.rightIndex > max) this.rightIndex = max;
  }

  inPlot(x: number, y: number): boolean {
    return x >= this.plotLeft && x <= this.plotRight && y >= this.plotTop && y <= this.plotBottom;
  }

  inCandlePane(x: number, y: number): boolean {
    return x >= this.plotLeft && x <= this.plotRight && y >= this.plotTop && y <= this.candleBottom;
  }
}
