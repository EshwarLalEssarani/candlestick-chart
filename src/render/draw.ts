/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { DataStore } from '../core/data-store';
import type { IndicatorEngine } from '../core/indicators';
import { formatPrice, formatTimeLabel, formatVolume, nicePriceStep, type PriceTick, type TimeTick } from '../core/ticks';
import { indexToTime } from '../core/time';
import type { Viewport } from '../core/viewport';
import type { Anchor, Drawing, DrawingTool, ResolvedOptions } from '../types';
import { paintDrawing } from './paint-drawing';

type Ctx = CanvasRenderingContext2D;

export interface DraftPreview {
  type: DrawingTool;
  anchors: Anchor[];
  hover: Anchor | null;
}

export interface LegendBar {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previous: number | null;
}

export interface StudyLabel {
  label: string;
  value: number;
  color: string;
}

export interface Scene {
  viewport: Viewport;
  options: ResolvedOptions;
  store: DataStore;
  indicators: IndicatorEngine;
  drawings: readonly Drawing[];
  selectedId: string | null;
  draft: DraftPreview | null;
  crosshair: { x: number; y: number } | null;
  legend: LegendBar | null;
  studies: readonly StudyLabel[];
  priceTicks: readonly PriceTick[];
  timeTicks: readonly TimeTick[];
  priceStep: number;
  timeStep: number;
  baseline: number;
}

export class DrawState {
  readonly upBody: number[] = [];
  readonly downBody: number[] = [];
  readonly upWick: number[] = [];
  readonly downWick: number[] = [];
  readonly upVol: number[] = [];
  readonly downVol: number[] = [];
  readonly index: number[] = [];

  reset(): void {
    this.upBody.length = 0;
    this.downBody.length = 0;
    this.upWick.length = 0;
    this.downWick.length = 0;
    this.upVol.length = 0;
    this.downVol.length = 0;
    this.index.length = 0;
  }
}

export function drawBackground(ctx: Ctx, scene: Scene): void {
  const { viewport: vp, options } = scene;
  ctx.fillStyle = options.layout.background;
  ctx.fillRect(0, 0, vp.width, vp.height);
  const dpr = vp.dpr;

  if (options.grid.visible && scene.store.length > 0) {
    ctx.strokeStyle = options.grid.color;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (const tick of scene.priceTicks) {
      if (tick.y < vp.plotTop || tick.y > vp.candleBottom) continue;
      const y = crisp(tick.y, dpr);
      ctx.moveTo(vp.plotLeft, y);
      ctx.lineTo(vp.plotRight, y);
    }
    for (const tick of scene.timeTicks) {
      const x = crisp(tick.x, dpr);
      ctx.moveTo(x, vp.plotTop);
      ctx.lineTo(x, vp.plotBottom);
    }
    ctx.stroke();
  }

  if (options.watermark && scene.store.length > 0) {
    ctx.font = `600 ${Math.round(Math.max(32, options.layout.fontSize * 4))}px ${options.layout.fontFamily}`;
    ctx.fillStyle = options.layout.watermarkColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(options.watermark, vp.plotLeft + vp.plotWidth / 2, (vp.plotTop + vp.candleBottom) / 2);
  }

  ctx.strokeStyle = options.layout.borderColor;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  ctx.moveTo(crisp(vp.plotRight, dpr), vp.plotTop);
  ctx.lineTo(crisp(vp.plotRight, dpr), vp.plotBottom);
  ctx.moveTo(vp.plotLeft, crisp(vp.plotBottom, dpr));
  ctx.lineTo(vp.plotRight, crisp(vp.plotBottom, dpr));
  if (options.volume.visible && vp.volumeTop > vp.candleBottom + 1) {
    const y = crisp(vp.candleBottom, dpr);
    ctx.moveTo(vp.plotLeft, y);
    ctx.lineTo(vp.plotRight, y);
  }
  if (vp.studyBottom - vp.studyTop > 8) {
    const y = crisp(vp.studyTop, dpr);
    ctx.moveTo(vp.plotLeft, y);
    ctx.lineTo(vp.plotRight, y);
  }
  if (vp.rsiBottom - vp.rsiTop > 8) {
    const y = crisp(vp.rsiTop, dpr);
    ctx.moveTo(vp.plotLeft, y);
    ctx.lineTo(vp.plotRight, y);
  }
  ctx.stroke();
  drawStudyScale(ctx, scene);

  if (vp.rsiBottom - vp.rsiTop > 20) {
    const band = vp.rsiBottom - vp.rsiTop;
    const yOf = (value: number): number => vp.rsiTop + (1 - value / 100) * band;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = options.grid.color;
    ctx.beginPath();
    for (const level of [30, 70]) {
      const y = crisp(yOf(level), dpr);
      ctx.moveTo(vp.plotLeft, y);
      ctx.lineTo(vp.plotRight, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.font = fontOf(options);
    ctx.fillStyle = options.layout.textColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const level of [20, 40, 60, 80]) ctx.fillText(String(level), vp.width - 8, yOf(level));
  }

  ctx.font = fontOf(options);
  ctx.fillStyle = options.layout.textColor;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const tick of scene.priceTicks) {
    if (tick.y < vp.plotTop + 8 || tick.y > vp.candleBottom - 8) continue;
    ctx.fillText(tick.label, vp.width - 8, tick.y);
  }
  ctx.textAlign = 'center';
  const timeY = vp.plotBottom + (vp.height - vp.plotBottom) * 0.55;
  for (const tick of scene.timeTicks) {
    ctx.fillText(tick.label, tick.x, timeY);
  }

  if (scene.store.length === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', vp.width / 2, vp.height / 2);
  }
}

export function drawSeries(ctx: Ctx, scene: Scene, state: DrawState): void {
  const { viewport: vp, store, options } = scene;
  if (store.length === 0 || !(vp.barSpacing > 0)) return;
  let { from, to } = vp.visibleRange(store.length);
  if (to < from) return;
  from = Math.max(0, from - 1);
  to = Math.min(store.length - 1, to + 1);

  const dpr = vp.dpr;
  const spacing = vp.barSpacing;
  const plotRight = vp.plotRight;
  const rightIndex = vp.rightIndex;
  const priceMax = vp.priceMax;
  const span = priceMax - vp.priceMin || 1;
  const top = vp.plotTop;
  const candleH = vp.candleBottom - vp.plotTop || 1;
  const yOf = (price: number): number => top + ((priceMax - price) / span) * candleH;
  const xOf = (index: number): number => plotRight - (rightIndex - index) * spacing;
  const wantCandles = options.series.style === 'candlestick';
  const wantVolume = options.volume.visible && vp.volumeBottom - vp.volumeTop > 2;
  if (wantCandles || wantVolume) {
    state.reset();
    collect(store, from, to, spacing, plotRight, rightIndex, dpr, yOf, state);
    if (wantVolume) paintVolume(ctx, state, vp.volumeBottom, vp.volumeBottom - vp.volumeTop, options);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.plotLeft, vp.plotTop, vp.plotWidth, Math.max(1, vp.candleBottom - vp.plotTop));
  ctx.clip();

  if (wantCandles) paintCandles(ctx, state, dpr, options);
  else drawBaseline(ctx, store, from, to, xOf, yOf, scene.baseline, options, state);

  const visible = to - from + 1;
  const step = visible > vp.plotWidth * 2 ? Math.ceil(visible / (vp.plotWidth * 2)) : 1;
  for (const run of scene.indicators.list()) {
    if (run.kind === 'rsi' || run.pane === 'oscillator') continue;
    if (run.kind === 'bollinger') fillBand(ctx, run.upper, run.lower, from, to, step, xOf, yOf, run.fill, state);
    strokeRun(ctx, run.mid, from, to, step, xOf, yOf, run.color, run.lineWidth);
    if (run.kind === 'bollinger') {
      strokeRun(ctx, run.upper, from, to, step, xOf, yOf, run.color, 1);
      strokeRun(ctx, run.lower, from, to, step, xOf, yOf, run.color, 1);
    }
  }
  ctx.restore();
  drawRsi(ctx, scene, from, to);
  drawStudy(ctx, scene, from, to);
}

export function drawDrawings(ctx: Ctx, scene: Scene): void {
  const { viewport: vp, store, options } = scene;
  if (store.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.plotLeft, vp.plotTop, vp.plotWidth, Math.max(1, vp.candleBottom - vp.plotTop));
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.font = fontOf(options, Math.max(10, options.layout.fontSize - 1));
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const drawing of scene.drawings) {
    const selected = drawing.id === scene.selectedId;
    paintDrawing(ctx, scene, drawing.anchors, drawing.type, selected, false, drawing.text, drawing.color);
  }
  ctx.restore();
}

export function drawOverlay(ctx: Ctx, scene: Scene): void {
  const { viewport: vp, options, store } = scene;
  const dpr = vp.dpr;
  if (scene.draft?.hover && store.length > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.plotLeft, vp.plotTop, vp.plotWidth, Math.max(1, vp.candleBottom - vp.plotTop));
    ctx.clip();
    ctx.setLineDash([5, 4]);
    const anchors = scene.draft.hover && scene.draft.type !== 'brush'
      ? [...scene.draft.anchors, scene.draft.hover]
      : scene.draft.anchors;
    paintDrawing(ctx, scene, anchors, scene.draft.type, false, true);
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (store.length > 0) {
    const last = store.length - 1;
    const price = store.close[last]!;
    const y = vp.priceToY(price);
    if (y >= vp.plotTop && y <= vp.candleBottom) {
      const rising = price >= store.open[last]!;
      const color = rising ? options.candle.upColor : options.candle.downColor;
      ctx.save();
      ctx.beginPath();
      ctx.rect(vp.plotLeft, vp.plotTop, vp.plotWidth, Math.max(1, vp.candleBottom - vp.plotTop));
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / dpr;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const py = crisp(y, dpr);
      ctx.moveTo(vp.plotLeft, py);
      ctx.lineTo(vp.plotRight, py);
      ctx.stroke();
      ctx.restore();
      drawTag(ctx, vp.plotRight, y, formatPrice(price, scene.priceStep), color, '#ffffff', options, 'left');
    }
  }

  const pointer = scene.crosshair;
  if (options.crosshair.visible && pointer && vp.inPlot(pointer.x, pointer.y) && store.length > 0) {
    ctx.save();
    ctx.strokeStyle = options.crosshair.color;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const x = crisp(pointer.x, dpr);
    ctx.moveTo(x, vp.plotTop);
    ctx.lineTo(x, vp.plotBottom);
    let priceY: number | null = null;
    if (vp.inCandlePane(pointer.x, pointer.y)) {
      priceY = crisp(pointer.y, dpr);
      ctx.moveTo(vp.plotLeft, priceY);
      ctx.lineTo(vp.plotRight, priceY);
    }
    ctx.stroke();
    ctx.restore();

    const index = vp.xToIndex(pointer.x);
    const time = store.length > 0 ? timeLabel(scene, index) : '';
    if (time) {
      drawTag(
        ctx,
        pointer.x,
        vp.plotBottom + (vp.height - vp.plotBottom) * 0.55,
        time,
        options.crosshair.labelBackground,
        options.crosshair.labelText,
        options,
        'center',
      );
    }
    if (priceY != null) {
      let tagY = pointer.y;
      if (store.length > 0) {
        const lastY = vp.priceToY(store.close[store.length - 1]!);
        if (Math.abs(lastY - tagY) < 20) tagY += tagY < lastY ? -20 : 20;
      }
      drawTag(
        ctx,
        vp.plotRight,
        tagY,
        formatPrice(vp.yToPrice(pointer.y), scene.priceStep),
        options.crosshair.labelBackground,
        options.crosshair.labelText,
        options,
        'left',
      );
    }
  }

  drawLegend(ctx, scene);
}

function collect(
  store: DataStore,
  from: number,
  to: number,
  spacing: number,
  plotRight: number,
  rightIndex: number,
  dpr: number,
  yOf: (price: number) => number,
  state: DrawState,
): void {
  const openA = store.open;
  const highA = store.high;
  const lowA = store.low;
  const closeA = store.close;
  const volumeA = store.volume;
  const minH = 1 / dpr;
  const xAt = (index: number): number => plotRight - (rightIndex - index) * spacing;

  if (spacing >= 1.5) {
    const bodyW = Math.max(minH, Math.min(spacing * 0.8, spacing - minH));
    for (let i = from; i <= to; i++) {
      pushBar(
        state,
        closeA[i]! >= openA[i]!,
        xAt(i),
        highA[i]!,
        lowA[i]!,
        openA[i]!,
        closeA[i]!,
        volumeA[i]!,
        bodyW,
        yOf,
        dpr,
        minH,
      );
    }
    return;
  }

  let i = from;
  const width = Math.max(minH, 1);
  while (i <= to) {
    const col = Math.floor(xAt(i));
    let open = openA[i]!;
    let close = closeA[i]!;
    let high = highA[i]!;
    let low = lowA[i]!;
    let volume = volumeA[i]!;
    i++;
    while (i <= to && Math.floor(xAt(i)) === col) {
      if (highA[i]! > high) high = highA[i]!;
      if (lowA[i]! < low) low = lowA[i]!;
      close = closeA[i]!;
      volume += volumeA[i]!;
      i++;
    }
    pushBar(state, close >= open, col + 0.5, high, low, open, close, volume, width, yOf, dpr, minH);
  }
}

function pushBar(
  state: DrawState,
  rising: boolean,
  x: number,
  high: number,
  low: number,
  open: number,
  close: number,
  volume: number,
  width: number,
  yOf: (price: number) => number,
  dpr: number,
  minH: number,
): void {
  const yHigh = yOf(high);
  const yLow = yOf(low);
  let bodyTop = yOf(Math.max(open, close));
  let bodyBot = yOf(Math.min(open, close));
  if (bodyBot - bodyTop < minH) {
    const mid = (bodyTop + bodyBot) / 2;
    bodyTop = mid - minH / 2;
    bodyBot = mid + minH / 2;
  }
  const body = rising ? state.upBody : state.downBody;
  const left = Math.round((x - width / 2) * dpr) / dpr;
  body.push(left, bodyTop, Math.max(minH, width), bodyBot - bodyTop);
  if (Math.abs(yLow - yHigh) >= minH) {
    const wick = rising ? state.upWick : state.downWick;
    wick.push(x, yHigh, yLow);
  }
  const vol = rising ? state.upVol : state.downVol;
  vol.push(left, Math.max(minH, width), volume);
}

function paintCandles(ctx: Ctx, state: DrawState, dpr: number, options: ResolvedOptions): void {
  paintWicks(ctx, state.upWick, options.candle.wickUpColor, dpr);
  paintWicks(ctx, state.downWick, options.candle.wickDownColor, dpr);
  paintRects(ctx, state.upBody, options.candle.upColor);
  paintRects(ctx, state.downBody, options.candle.downColor);
}

function paintVolume(ctx: Ctx, state: DrawState, plotBottom: number, height: number, options: ResolvedOptions): void {
  let max = 0;
  for (let i = 2; i < state.upVol.length; i += 3) if (state.upVol[i]! > max) max = state.upVol[i]!;
  for (let i = 2; i < state.downVol.length; i += 3) if (state.downVol[i]! > max) max = state.downVol[i]!;
  if (!(max > 0) || !(height > 0)) return;
  const head = max * 1.25;
  paintVol(ctx, state.upVol, plotBottom, height, head, options.volume.upColor);
  paintVol(ctx, state.downVol, plotBottom, height, head, options.volume.downColor);
}

function paintVol(ctx: Ctx, coords: number[], plotBottom: number, height: number, max: number, color: string): void {
  if (coords.length === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < coords.length; i += 3) {
    const barH = (coords[i + 2]! / max) * height;
    ctx.rect(coords[i]!, plotBottom - barH, coords[i + 1]!, barH);
  }
  ctx.fill();
}

function paintRects(ctx: Ctx, coords: number[], color: string): void {
  if (coords.length === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < coords.length; i += 4) ctx.rect(coords[i]!, coords[i + 1]!, coords[i + 2]!, coords[i + 3]!);
  ctx.fill();
}

function paintWicks(ctx: Ctx, coords: number[], color: string, dpr: number): void {
  if (coords.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  for (let i = 0; i < coords.length; i += 3) {
    const x = crisp(coords[i]!, dpr);
    ctx.moveTo(x, coords[i + 1]!);
    ctx.lineTo(x, coords[i + 2]!);
  }
  ctx.stroke();
}

function drawBaseline(
  ctx: Ctx,
  store: DataStore,
  from: number,
  to: number,
  xOf: (index: number) => number,
  yOf: (price: number) => number,
  baseline: number,
  options: ResolvedOptions,
  state: DrawState,
): void {
  const yBase = yOf(baseline);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = options.layout.borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const left = xOf(from);
  const right = xOf(to);
  ctx.moveTo(left, yBase);
  ctx.lineTo(right, yBase);
  ctx.stroke();
  ctx.restore();

  const visible = to - from + 1;
  const step = visible > 2000 ? Math.ceil(visible / 2000) : 1;
  state.index.length = 0;
  for (let i = from; i <= to; i += step) state.index.push(i);
  if (state.index[state.index.length - 1] !== to) state.index.push(to);
  const indexes = state.index;
  const close = store.close;
  for (let n = 1; n < indexes.length; n++) {
    const i0 = indexes[n - 1]!;
    const i1 = indexes[n]!;
    const x1 = xOf(i0);
    const y1 = yOf(close[i0]!);
    const x2 = xOf(i1);
    const y2 = yOf(close[i1]!);
    const above1 = close[i0]! >= baseline;
    const above2 = close[i1]! >= baseline;
    if (above1 === above2) {
      fillQuad(ctx, x1, y1, x2, y2, yBase, above1 ? options.series.topFill : options.series.bottomFill);
    } else {
      const denom = y2 - y1;
      const t = denom === 0 ? 0 : (yBase - y1) / denom;
      const xc = x1 + (x2 - x1) * t;
      fillQuad(ctx, x1, y1, xc, yBase, yBase, above1 ? options.series.topFill : options.series.bottomFill);
      fillQuad(ctx, xc, yBase, x2, y2, yBase, above2 ? options.series.topFill : options.series.bottomFill);
    }
    ctx.strokeStyle = above2 ? options.series.topLine : options.series.bottomLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function fillQuad(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, yBase: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2, yBase);
  ctx.lineTo(x1, yBase);
  ctx.closePath();
  ctx.fill();
}

function strokeRun(
  ctx: Ctx,
  values: Float64Array,
  from: number,
  to: number,
  step: number,
  xOf: (index: number) => number,
  yOf: (price: number) => number,
  color: string,
  lineWidth: number,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let started = false;
  for (let i = from; i <= to; i += step) {
    const value = values[i];
    if (value === undefined || !Number.isFinite(value)) {
      started = false;
      continue;
    }
    const x = xOf(i);
    const y = yOf(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  if (started) ctx.stroke();
}

function fillBand(
  ctx: Ctx,
  upper: Float64Array,
  lower: Float64Array,
  from: number,
  to: number,
  step: number,
  xOf: (index: number) => number,
  yOf: (price: number) => number,
  color: string,
  state: DrawState,
): void {
  state.index.length = 0;
  const flush = (): void => {
    const indexes = state.index;
    if (indexes.length < 2) {
      indexes.length = 0;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(xOf(indexes[0]!), yOf(upper[indexes[0]!]!));
    for (let n = 1; n < indexes.length; n++) ctx.lineTo(xOf(indexes[n]!), yOf(upper[indexes[n]!]!));
    for (let n = indexes.length - 1; n >= 0; n--) ctx.lineTo(xOf(indexes[n]!), yOf(lower[indexes[n]!]!));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    indexes.length = 0;
  };
  for (let i = from; i <= to; i += step) {
    const hi = upper[i];
    const lo = lower[i];
    if (hi === undefined || lo === undefined || !Number.isFinite(hi) || !Number.isFinite(lo)) flush();
    else state.index.push(i);
  }
  flush();
}

function drawStudyScale(ctx: Ctx, scene: Scene): void {
  const vp = scene.viewport;
  const height = vp.studyBottom - vp.studyTop;
  if (height < 20) return;
  const span = vp.studyMax - vp.studyMin || 1;
  const yOf = (value: number): number => vp.studyTop + ((vp.studyMax - value) / span) * height;
  const step = nicePriceStep(vp.studyMin, vp.studyMax, 3);
  ctx.font = fontOf(scene.options);
  ctx.fillStyle = scene.options.layout.textColor;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const first = Math.ceil(vp.studyMin / step) * step;
  for (let value = first; value < vp.studyMax; value += step) {
    const y = yOf(value);
    if (y < vp.studyTop + 8 || y > vp.studyBottom - 8) continue;
    ctx.fillText(formatPrice(value, step), vp.width - 8, y);
  }
}

function drawStudy(ctx: Ctx, scene: Scene, from: number, to: number): void {
  const vp = scene.viewport;
  const height = vp.studyBottom - vp.studyTop;
  if (height < 8 || to < from) return;
  const runs = scene.indicators.list().filter((run) => run.kind === 'script' && run.pane === 'oscillator');
  if (runs.length === 0) return;
  const span = vp.studyMax - vp.studyMin || 1;
  const yOf = (value: number): number => vp.studyTop + ((vp.studyMax - value) / span) * height;
  const xOf = (index: number): number => vp.plotRight - (vp.rightIndex - index) * vp.barSpacing;
  const visible = to - from + 1;
  const step = visible > vp.plotWidth * 2 ? Math.ceil(visible / (vp.plotWidth * 2)) : 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.plotLeft, vp.studyTop, vp.plotWidth, height);
  ctx.clip();
  for (const run of runs) strokeRun(ctx, run.mid, from, to, step, xOf, yOf, run.color, run.lineWidth);
  ctx.restore();
}

function drawRsi(ctx: Ctx, scene: Scene, from: number, to: number): void {
  const vp = scene.viewport;
  const height = vp.rsiBottom - vp.rsiTop;
  if (height < 8 || to < from) return;
  const runs = scene.indicators.list().filter((run) => run.kind === 'rsi');
  if (runs.length === 0) return;
  const yOf = (value: number): number => vp.rsiTop + (1 - value / 100) * height;
  const xOf = (index: number): number => vp.plotRight - (vp.rightIndex - index) * vp.barSpacing;
  const visible = to - from + 1;
  const step = visible > vp.plotWidth * 2 ? Math.ceil(visible / (vp.plotWidth * 2)) : 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.plotLeft, vp.rsiTop, vp.plotWidth, height);
  ctx.clip();
  for (const run of runs) strokeRun(ctx, run.mid, from, to, step, xOf, yOf, run.color, run.lineWidth);
  ctx.restore();
}

function drawLegend(ctx: Ctx, scene: Scene): void {
  const legend = scene.legend;
  if (!legend) return;
  const { viewport: vp, options } = scene;
  const branded = options.header.symbol.length > 0;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const labelColor = options.layout.textColor;
  const priceColor = legend.close >= legend.open ? options.candle.upColor : options.candle.downColor;
  const y = vp.plotTop + 14;
  let x = vp.plotLeft + 8;
  if (branded) {
    const title = [options.header.symbol, options.header.interval, options.header.exchange].filter(Boolean).join(' · ');
    ctx.font = `600 ${options.layout.fontSize}px ${options.layout.fontFamily}`;
    ctx.fillStyle = strongInk(options.layout.background);
    ctx.fillText(title, x, y);
    x += ctx.measureText(title).width + 14;
  }
  ctx.font = fontOf(options);
  const items: Array<readonly [string, string, string]> = [
    ['O', formatPrice(legend.open, scene.priceStep), labelColor],
    ['H', formatPrice(legend.high, scene.priceStep), labelColor],
    ['L', formatPrice(legend.low, scene.priceStep), labelColor],
    ['C', formatPrice(legend.close, scene.priceStep), branded ? strongInk(options.layout.background) : priceColor],
  ];
  if (!branded) items.push(['V', formatVolume(legend.volume), labelColor]);
  for (const [name, value, color] of items) {
    ctx.fillStyle = labelColor;
    ctx.fillText(name, x, y);
    x += ctx.measureText(`${name} `).width;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    x += ctx.measureText(value).width + 10;
  }
  if (branded && legend.previous != null && legend.previous !== 0) {
    const delta = legend.close - legend.previous;
    const pct = (delta / Math.abs(legend.previous)) * 100;
    const sign = delta > 0 ? '+' : '';
    const text = `${sign}${formatPrice(delta, scene.priceStep)} (${sign}${pct.toFixed(2)}%)`;
    ctx.fillStyle = delta >= 0 ? options.candle.upColor : options.candle.downColor;
    ctx.fillText(text, x, y);
  }
  if (branded) {
    ctx.fillStyle = labelColor;
    ctx.fillText(`Volume  ${formatVolume(legend.volume)}`, vp.plotLeft + 8, y + 16);
    let sx = vp.plotLeft + 8;
    const sy = y + 32;
    for (const run of scene.indicators.list()) {
      if (run.kind !== 'script' || run.pane === 'oscillator' || legend.index < 0) continue;
      const value = run.mid[legend.index];
      if (value === undefined || !Number.isFinite(value)) continue;
      const text = `${run.label}  ${formatPrice(value, scene.priceStep)}`;
      ctx.fillStyle = run.color;
      ctx.fillText(text, sx, sy);
      sx += ctx.measureText(text).width + 12;
    }
  }
  if (!branded && scene.studies.length > 0) {
    let sx = vp.plotLeft + 8;
    const sy = y + 16;
    for (const study of scene.studies) {
      const text = `${study.label} ${formatPrice(study.value, scene.priceStep)}`;
      ctx.fillStyle = study.color;
      ctx.fillText(text, sx, sy);
      sx += ctx.measureText(text).width + 12;
    }
  }
  const rsiHeight = vp.rsiBottom - vp.rsiTop;
  if (rsiHeight >= 16 && legend.index >= 0) {
    let rx = vp.plotLeft + 8;
    const ry = vp.rsiTop + 13;
    for (const run of scene.indicators.list()) {
      if (run.kind !== 'rsi') continue;
      const value = run.mid[legend.index];
      const text = value !== undefined && Number.isFinite(value) ? `${run.label}  ${value.toFixed(2)}` : run.label;
      ctx.fillStyle = run.color;
      ctx.fillText(text, rx, ry);
      rx += ctx.measureText(text).width + 12;
    }
  }
  const studyHeight = vp.studyBottom - vp.studyTop;
  if (studyHeight < 16 || legend.index < 0) return;
  let ox = vp.plotLeft + 8;
  const oy = vp.studyTop + 13;
  for (const run of scene.indicators.list()) {
    if (run.kind !== 'script' || run.pane !== 'oscillator') continue;
    const value = run.mid[legend.index];
    const step = value !== undefined && Math.abs(value) >= 100 ? 1 : value !== undefined && Math.abs(value) >= 1 ? 0.01 : 0.0001;
    const text = value !== undefined && Number.isFinite(value)
      ? `${run.label}  ${formatPrice(value, step)}`
      : run.label;
    ctx.fillStyle = run.color;
    ctx.fillText(text, ox, oy);
    ox += ctx.measureText(text).width + 12;
  }
}

function strongInk(background: string): string {
  if (background.startsWith('#') && background.length >= 7) {
    const red = parseInt(background.slice(1, 3), 16);
    if (red > 180) return '#131722';
  }
  return '#e7eef8';
}

function drawTag(
  ctx: Ctx,
  x: number,
  y: number,
  text: string,
  background: string,
  color: string,
  options: ResolvedOptions,
  align: 'left' | 'center',
): void {
  ctx.font = fontOf(options);
  const width = ctx.measureText(text).width + 12;
  const height = 18;
  const left = align === 'center' ? x - width / 2 : x;
  const top = y - height / 2;
  ctx.fillStyle = background;
  roundRect(ctx, left, top, width, height, 3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + width / 2, top + height / 2);
}

function timeLabel(scene: Scene, index: number): string {
  const { store } = scene;
  if (store.length === 0) return '';
  return formatTimeLabel(indexToTime(store.time, store.length, index), scene.timeStep);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function crisp(value: number, dpr: number): number {
  return (Math.floor(value * dpr) + 0.5) / dpr;
}

function fontOf(options: ResolvedOptions, size = options.layout.fontSize): string {
  return `${size}px ${options.layout.fontFamily}`;
}
