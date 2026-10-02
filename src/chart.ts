/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import { DataStore, type MutationKind } from './core/data-store';
import { pointsFor } from './core/draw-tools';
import { hitTestDrawings } from './core/hit';
import { IndicatorEngine } from './core/indicators';
import {
  buildPriceTicks,
  buildTimeTicks,
  chooseTimeStep,
  formatPrice,
  nicePriceStep,
  type PriceTick,
  type TimeTick,
} from './core/ticks';
import { indexToTime, normalizeTimeMs, timeToIndex } from './core/time';
import { anchorZoom, clamp, Viewport } from './core/viewport';
import {
  DrawState,
  drawBackground,
  drawDrawings,
  drawOverlay,
  drawSeries,
  type DraftPreview,
  type LegendBar,
  type Scene,
  type StudyLabel,
} from './render/draw';
import { LAYER_ALL, LAYER_BG, LAYER_DRAW, LAYER_OVERLAY, LAYER_SERIES, resolveDirty } from './render/layers';
import { mergeOptions, resolveOptions } from './theme';
import type {
  Anchor,
  BarData,
  ChartOptions,
  ChartStats,
  CrosshairMoveParam,
  Drawing,
  DrawingInput,
  DrawingTool,
  LogicalRange,
  OverlaySpec,
  ResolvedOptions,
  SeriesStyle,
  SetDataOptions,
  Tick,
  Tool,
  VisibleTimeRange,
} from './types';

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
  rightIndex: number;
  panning: boolean;
}

interface Pinch {
  dist: number;
  spacing: number;
  midIndex: number;
}

const STYLE_ID = 'cschart-styles';
const TIME_SCALE_HEIGHT = 28;

const STYLE_TEXT = `
.cschart-root,.cschart-root canvas{touch-action:none}
.cschart-root{position:relative;width:100%;height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;outline:none;overscroll-behavior:contain;cursor:crosshair}
.cschart-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.cschart-text{position:absolute;z-index:3;min-width:88px;padding:4px 6px;border:1px solid #3861fb;border-radius:4px;background:#0d1526;color:#e7eef8;font:12px ui-sans-serif,system-ui,sans-serif;outline:none}
.cschart-drawbar{position:absolute;z-index:4;display:flex;align-items:center;gap:4px;height:30px;padding:0 6px;border:1px solid #1c2a44;border-radius:8px;background:#0d1526;box-shadow:0 10px 24px rgba(0,0,0,.35)}
.cschart-drawbar[hidden]{display:none}
.cschart-swatch,.cschart-picker{width:16px;height:16px;padding:0;border:1px solid rgba(255,255,255,.45);border-radius:50%;cursor:pointer;background:transparent}
.cschart-swatch[aria-pressed="true"]{outline:2px solid #fff;outline-offset:1px}
.cschart-picker{overflow:hidden;display:grid;position:relative}
.cschart-picker input{position:absolute;inset:-6px;width:28px;height:28px;padding:0;border:0;background:transparent;cursor:pointer}
.cschart-delete{width:22px;height:22px;margin-left:2px;border:0;border-radius:4px;background:transparent;color:#e7eef8;display:grid;place-items:center;cursor:pointer}
.cschart-delete:hover{background:#f6465d;color:#fff}
`;

/**
 * Four stacked canvases:
 * 1. background — grid and scales, repainted when the viewport or price range moves
 * 2. series — candles, volume, baseline, and studies, backed by an OffscreenCanvas
 * 3. drawings — trendlines, rays, and Fibonacci levels in time/price space
 * 4. overlay — crosshair, last-price tag, and the bar legend
 *
 * A live tick repaints the series and overlay. Grid and drawings are left in
 * place when the scale and the scroll position do not change.
 */
export class Chart {
  private readonly container: HTMLElement;
  private readonly store = new DataStore();
  private readonly indicators = new IndicatorEngine();
  private readonly viewport = new Viewport();
  private readonly drawState = new DrawState();
  private options: ResolvedOptions;
  private root!: HTMLDivElement;
  private layers!: { bg: Layer; series: Layer; draw: Layer; overlay: Layer };
  private layerList: Layer[] = [];
  private buffer: OffscreenCanvas | HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private bufferW = 0;
  private bufferH = 0;
  private bitmapW = 0;
  private bitmapH = 0;
  private priceScaleWidth = 64;
  private rightOffset: number;
  private following = true;
  private tool: Tool = 'crosshair';
  private magnet = false;
  private drawingsLocked = false;
  private drawingsVisible = true;
  private drawings: Drawing[] = [];
  private selectedId: string | null = null;
  private draft: DraftPreview | null = null;
  private brush: Anchor[] | null = null;
  private drawSeq = 1;
  private crosshair: { x: number; y: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: Drag | null = null;
  private drawbar: HTMLElement | null = null;
  private edit: {
    id: string;
    /** Anchor index, or -1 when the whole drawing moves. */
    index: number;
    pointerId: number;
    origin: Anchor[];
    grab: Anchor;
    active: boolean;
  } | null = null;
  private pinch: Pinch | null = null;
  private suppressTap = false;
  private manual: { min: number; max: number } | null = null;
  private observer: ResizeObserver | null = null;
  private raf = 0;
  private rendering = false;
  private dirty = 0;
  private dataPaint = false;
  private dataIndex = -1;
  private pendingFit = false;
  private rangeStamp = '';
  private priceTicks: PriceTick[] = [];
  private timeTicks: TimeTick[] = [];
  private priceStep = 1;
  private timeStep = 60_000;
  private paintedRight = Number.NaN;
  private paintedSpacing = Number.NaN;
  private paintedMin = Number.NaN;
  private paintedMax = Number.NaN;
  private paintedPlotW = Number.NaN;
  private paintedPlotH = Number.NaN;
  private lastRenderMs = 0;
  private crosshairEmitPending = false;
  private lastRange: { from: number; to: number; spacing: number } | null = null;
  private readonly legendBar: LegendBar = {
    index: -1,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    previous: null,
  };
  private studyLabels: StudyLabel[] = [];
  private readonly crosshairSubs = new Set<(param: CrosshairMoveParam) => void>();
  private readonly seriesSubs = new Set<(bar: BarData | null) => void>();
  private readonly rangeSubs = new Set<(range: LogicalRange) => void>();
  private readonly toolSubs = new Set<(tool: Tool) => void>();
  private destroyed = false;

  constructor(container: HTMLElement | string, options?: ChartOptions) {
    this.options = resolveOptions(options);
    this.container = resolveContainer(container);
    this.rightOffset = this.options.timeScale.rightOffset;
    this.viewport.minBarSpacing = this.options.timeScale.minBarSpacing;
    this.viewport.maxBarSpacing = this.options.timeScale.maxBarSpacing;
    this.viewport.barSpacing = this.options.timeScale.barSpacing;
    this.mount();
    this.markDirty(LAYER_ALL);
  }

  setData(data: readonly BarData[], behavior: SetDataOptions = {}): void {
    this.store.setData(data);
    this.indicators.recompute(this.store.close, this.store.length, this.store);
    if (behavior.resetView !== false) {
      this.viewport.barSpacing = this.options.timeScale.barSpacing;
      this.rightOffset = this.options.timeScale.rightOffset;
      this.viewport.applySpacing(this.options);
      this.pinRealtime();
    } else {
      this.viewport.clampRightIndex(this.store.length, this.rightOffset);
      this.syncFollowing();
    }
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
    this.emitSeries();
  }

  /** Replace the bar with this timestamp, or insert it so the series stays ordered. */
  updateBar(bar: BarData): void {
    const mutation = this.store.updateBar(bar);
    if (mutation.index < 0) return;
    if (mutation.kind === 'insert' && mutation.index <= this.viewport.rightIndex) this.viewport.rightIndex += 1;
    if (mutation.kind === 'append' && this.following) this.pinRealtime();
    this.syncIndicators(mutation.index, mutation.kind);
    this.noteData(mutation.index);
    this.emitSeries();
  }

  /**
   * Merge a trade into the current bar, or open the next bar when `time` crosses
   * the interval. Pass a price, or `{ price, time?, volume? }`.
   */
  appendTick(tickOrPrice: Tick | number, time?: number, volume?: number): void {
    const tick: Tick = typeof tickOrPrice === 'number' ? { price: tickOrPrice, time, volume } : tickOrPrice;
    if (!Number.isFinite(tick.price)) return;
    const timeMs = tick.time == null ? Date.now() : normalizeTimeMs(tick.time);
    const mutation = this.store.appendTick(tick.price, timeMs, tick.volume ?? 0, this.barIntervalMs());
    if (mutation.index < 0) return;
    if (mutation.kind === 'append' && this.following) this.pinRealtime();
    this.syncIndicators(mutation.index, mutation.kind);
    this.noteData(mutation.index);
    this.emitSeries();
  }

  addOverlay(spec: OverlaySpec): string {
    const run = this.indicators.add(spec);
    this.indicators.recompute(this.store.close, this.store.length, this.store);
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
    return run.id;
  }

  removeOverlay(id: string): void {
    if (!this.indicators.remove(id)) return;
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  clearOverlays(): void {
    this.indicators.clear();
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  setSeriesStyle(style: SeriesStyle): void {
    this.applyOptions({ series: { style } });
  }

  setTool(tool: Tool): void {
    const changed = this.tool !== tool;
    this.tool = tool;
    this.draft = null;
    this.options.crosshair.visible = tool !== 'cursor';
    this.root.style.cursor = tool === 'cursor' ? 'default' : 'crosshair';
    this.markDirty(LAYER_OVERLAY);
    if (changed) this.emitTool();
  }

  /** Snap new drawing points to the nearest open, high, low, or close. */
  setMagnet(enabled: boolean): void {
    this.magnet = enabled;
  }

  /** Block new drawings and deletion while leaving existing ones on screen. */
  setDrawingsLocked(locked: boolean): void {
    this.drawingsLocked = locked;
    if (locked) this.draft = null;
    this.markDirty(LAYER_OVERLAY);
  }

  setDrawingsVisible(visible: boolean): void {
    this.drawingsVisible = visible;
    if (!visible) this.draft = null;
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
  }

  getTool(): Tool {
    return this.tool;
  }

  addDrawing(input: DrawingInput): string {
    const needed = input.type === 'brush' ? 2 : pointsFor(input.type);
    if (input.anchors.length < needed) return '';
    const anchors: Anchor[] = [];
    for (let i = 0; i < needed; i++) {
      const anchor = input.anchors[i]!;
      const time = normalizeTimeMs(anchor.time);
      if (!Number.isFinite(time) || !Number.isFinite(anchor.price)) return '';
      anchors.push({ time, price: anchor.price });
    }
    const drawing: Drawing = {
      id: `d${this.drawSeq++}`,
      type: input.type,
      anchors,
      text: input.text,
      color: input.color,
    };
    this.drawings.push(drawing);
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
    return drawing.id;
  }

  removeDrawing(id: string): void {
    if (this.drawingsLocked) return;
    const index = this.drawings.findIndex((drawing) => drawing.id === id);
    if (index < 0) return;
    this.drawings.splice(index, 1);
    if (this.selectedId === id) this.selectedId = null;
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
  }

  clearDrawings(): void {
    if (this.drawingsLocked) return;
    if (this.drawings.length === 0 && this.draft == null) return;
    this.drawings = [];
    this.selectedId = null;
    this.draft = null;
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
  }

  getDrawings(): Drawing[] {
    return this.drawings.map((drawing) => ({
      id: drawing.id,
      type: drawing.type,
      anchors: drawing.anchors.map((anchor) => ({ time: anchor.time, price: anchor.price })),
      text: drawing.text,
      color: drawing.color,
    }));
  }

  fitContent(): void {
    this.layoutViewport();
    if (this.viewport.plotWidth < 2 || this.store.length === 0) {
      this.pendingFit = true;
      this.markDirty(LAYER_ALL);
      return;
    }
    this.applyFit();
    this.following = false;
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  scrollToRealtime(): void {
    this.pinRealtime();
    this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    this.markDirty(LAYER_ALL);
  }

  /** Move the view by a number of bars. Positive values head toward newer data. */
  scrollBy(bars: number): void {
    if (!Number.isFinite(bars) || bars === 0) return;
    this.viewport.rightIndex += bars;
    this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    this.syncFollowing();
    this.markDirty(LAYER_ALL);
  }

  /** Multiply bar spacing. `anchorX` is a CSS x inside the plot; the center is used when omitted. */
  zoomBy(factor: number, anchorX?: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const x = anchorX ?? this.viewport.plotLeft + this.viewport.plotWidth / 2;
    anchorZoom(this.viewport, x, factor);
    this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    this.syncFollowing();
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  setVisibleRange(from: number, to: number): void {
    if (this.store.length === 0) return;
    const left = timeToIndex(this.store.time, this.store.length, normalizeTimeMs(from));
    const right = timeToIndex(this.store.time, this.store.length, normalizeTimeMs(to));
    const span = Math.max(1e-6, Math.abs(right - left));
    this.layoutViewport();
    this.viewport.barSpacing = clamp(
      this.viewport.plotWidth / span,
      this.viewport.minBarSpacing,
      this.viewport.maxBarSpacing,
    );
    this.viewport.rightIndex = Math.max(left, right);
    this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    this.following = false;
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  getVisibleRange(): VisibleTimeRange | null {
    if (this.store.length === 0 || this.viewport.plotWidth < 2) return null;
    return {
      from: indexToTime(this.store.time, this.store.length, this.viewport.xToIndex(this.viewport.plotLeft)),
      to: indexToTime(this.store.time, this.store.length, this.viewport.xToIndex(this.viewport.plotRight)),
    };
  }

  timeToCoordinate(time: number): number | null {
    if (this.store.length === 0) return null;
    return this.viewport.indexToX(timeToIndex(this.store.time, this.store.length, normalizeTimeMs(time)));
  }

  priceToCoordinate(price: number): number | null {
    if (this.store.length === 0 || !Number.isFinite(price)) return null;
    return this.viewport.priceToY(price);
  }

  coordinateToTime(x: number): number | null {
    if (this.store.length === 0 || x < this.viewport.plotLeft || x > this.viewport.plotRight) return null;
    return indexToTime(this.store.time, this.store.length, this.viewport.xToIndex(x));
  }

  coordinateToPrice(y: number): number | null {
    if (this.store.length === 0 || y < this.viewport.plotTop || y > this.viewport.candleBottom) return null;
    return this.viewport.yToPrice(y);
  }

  setPriceRange(min: number, max: number): void {
    if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return;
    this.manual = { min, max };
    this.options = mergeOptions(this.options, { priceScale: { autoScale: false } });
    this.markDirty(LAYER_ALL);
  }

  setAutoScale(auto: boolean): void {
    this.options = mergeOptions(this.options, { priceScale: { autoScale: auto } });
    if (auto) this.manual = null;
    else if (this.manual == null) this.manual = { min: this.viewport.priceMin, max: this.viewport.priceMax };
    this.markDirty(LAYER_ALL);
  }

  subscribeCrosshairMove(handler: (param: CrosshairMoveParam) => void): () => void {
    this.crosshairSubs.add(handler);
    return () => this.crosshairSubs.delete(handler);
  }

  subscribeSeriesChange(handler: (bar: BarData | null) => void): () => void {
    this.seriesSubs.add(handler);
    return () => this.seriesSubs.delete(handler);
  }

  subscribeVisibleLogicalRangeChange(handler: (range: LogicalRange) => void): () => void {
    this.rangeSubs.add(handler);
    return () => this.rangeSubs.delete(handler);
  }

  /** Fires when the active tool changes, including after a drawing is finished. */
  subscribeToolChange(handler: (tool: Tool) => void): () => void {
    this.toolSubs.add(handler);
    return () => this.toolSubs.delete(handler);
  }

  applyOptions(patch: ChartOptions): void {
    if (patch.theme) {
      const next = resolveOptions({ theme: patch.theme });
      next.watermark = this.options.watermark;
      next.interval = this.options.interval;
      next.width = this.options.width;
      next.height = this.options.height;
      next.series.style = this.options.series.style;
      next.series.baselineValue = this.options.series.baselineValue;
      next.timeScale = { ...this.options.timeScale };
      next.priceScale = { ...this.options.priceScale };
      next.header = { ...this.options.header };
      next.volume.visible = this.options.volume.visible;
      next.volume.ratio = this.options.volume.ratio;
      next.grid.visible = this.options.grid.visible;
      next.crosshair.visible = this.options.crosshair.visible;
      this.options = mergeOptions(next, patch);
    } else {
      this.options = mergeOptions(this.options, patch);
    }
    this.viewport.minBarSpacing = this.options.timeScale.minBarSpacing;
    this.viewport.maxBarSpacing = this.options.timeScale.maxBarSpacing;
    this.viewport.barSpacing = patch.timeScale?.barSpacing != null
      ? this.options.timeScale.barSpacing
      : clamp(this.viewport.barSpacing, this.viewport.minBarSpacing, this.viewport.maxBarSpacing);
    this.rightOffset = this.options.timeScale.rightOffset;
    if (patch.width != null) this.container.style.width = `${patch.width}px`;
    if (patch.height != null) this.container.style.height = `${patch.height}px`;
    if (!this.options.priceScale.autoScale && this.manual == null) {
      this.manual = { min: this.viewport.priceMin, max: this.viewport.priceMax };
    }
    if (this.options.priceScale.autoScale) this.manual = null;
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  resize(width?: number, height?: number): void {
    this.applyOptions({
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    });
  }

  getStats(): ChartStats {
    const { from, to } = this.viewport.visibleRange(this.store.length);
    return {
      barCount: this.store.length,
      visibleBars: to >= from ? to - from + 1 : 0,
      lastRenderMs: this.lastRenderMs,
      barSpacing: this.viewport.barSpacing,
      following: this.following,
    };
  }

  takeScreenshot(): HTMLCanvasElement {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.dirty) this.renderFrame();
    const canvas = document.createElement('canvas');
    canvas.width = this.bitmapW;
    canvas.height = this.bitmapH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    for (const layer of this.layerList) ctx.drawImage(layer.canvas, 0, 0);
    return canvas;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.detach();
    this.root.remove();
    this.crosshairSubs.clear();
    this.seriesSubs.clear();
    this.rangeSubs.clear();
    this.toolSubs.clear();
  }

  private mount(): void {
    installStyles();
    if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
    if (this.options.width != null) this.container.style.width = `${this.options.width}px`;
    if (this.options.height != null) this.container.style.height = `${this.options.height}px`;
    else if (this.container.getBoundingClientRect().height < 2) this.container.style.height = '480px';

    this.root = document.createElement('div');
    this.root.className = 'cschart-root';
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', 'Candlestick chart');
    const bg = makeLayer(false);
    const series = makeLayer(true);
    const draw = makeLayer(true);
    const overlay = makeLayer(true);
    this.layers = { bg, series, draw, overlay };
    this.layerList = [bg, series, draw, overlay];
    this.root.append(bg.canvas, series.canvas, draw.canvas, overlay.canvas);
    this.container.append(this.root);
    this.mountDrawbar();
    this.attach();
    this.observer = new ResizeObserver(() => this.markDirty(LAYER_ALL));
    this.observer.observe(this.container);
  }

  private attach(): void {
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.root.addEventListener('pointerleave', this.onPointerLeave);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    this.root.addEventListener('dblclick', this.onDoubleClick);
    this.root.addEventListener('keydown', this.onKeyDown);
    this.root.addEventListener('contextmenu', this.onContextMenu);
  }

  private detach(): void {
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('pointercancel', this.onPointerUp);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.root.removeEventListener('wheel', this.onWheel);
    this.root.removeEventListener('dblclick', this.onDoubleClick);
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.destroyed) return;
    if (event.button === 1) event.preventDefault();
    if (event.button === 2) {
      this.draft = null;
      this.markDirty(LAYER_OVERLAY);
      return;
    }
    this.root.focus({ preventScroll: true });
    const point = this.localPoint(event);
    this.pointers.set(event.pointerId, point);
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic and already-released pointers cannot be captured.
    }
    if (this.pointers.size >= 2) {
      this.drag = null;
      this.startPinch();
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && !this.isDrawingTool() && this.beginEdit(event.pointerId, point)) return;
    if (event.button === 0 && this.isDrawingTool()) {
      if (this.tool === 'brush') {
        const anchor = this.anchorFrom(point);
        this.brush = anchor ? [anchor] : [];
      }
      return;
    }
    this.drag = {
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      rightIndex: this.viewport.rightIndex,
      panning: event.button === 1,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);
    if (this.edit && this.edit.pointerId === event.pointerId) {
      this.applyEdit(point);
      return;
    }
    if (this.brush) {
      const anchor = this.anchorFrom(point);
      const last = this.brush[this.brush.length - 1];
      if (anchor && (!last || this.brushMoved(last, anchor))) {
        this.brush.push(anchor);
        this.draft = { type: 'brush', anchors: this.brush.slice(), hover: null };
        this.markDirty(LAYER_OVERLAY);
      }
      this.trackPointer(point);
      return;
    }
    if (this.pinch && this.pointers.size >= 2) {
      this.movePinch();
      this.trackPointer(point);
      return;
    }
    if (this.drag && this.drag.pointerId === event.pointerId) {
      const dx = point.x - this.drag.x;
      const dy = point.y - this.drag.y;
      if (!this.drag.panning && Math.hypot(dx, dy) > 4) {
        this.drag.panning = true;
        this.root.style.cursor = 'grabbing';
      }
      if (this.drag.panning) {
        this.viewport.rightIndex = this.drag.rightIndex - dx / this.viewport.barSpacing;
        this.viewport.clampRightIndex(this.store.length, this.rightOffset);
        this.markDirty(LAYER_ALL);
      }
    }
    this.trackPointer(point);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.edit && this.edit.pointerId === event.pointerId) {
      this.edit = null;
      this.root.style.cursor = this.tool === 'cursor' ? 'default' : 'crosshair';
      this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
      return;
    }
    if (this.brush && event.button === 0) {
      if (this.brush.length >= 2) {
        const id = this.addDrawing({ type: 'brush', anchors: this.brush });
        if (id) this.selectedId = id;
      }
      this.brush = null;
      this.draft = null;
      this.releaseTool();
      this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
      return;
    }
    if (this.drag && this.drag.pointerId === event.pointerId) {
      if (!this.drag.panning && event.button === 0 && !this.suppressTap) this.handleTap(point);
      else if (this.drag.panning) this.syncFollowing();
      this.drag = null;
      this.root.style.cursor = this.tool === 'cursor' ? 'default' : 'crosshair';
    } else if (event.button === 0 && this.isDrawingTool() && !this.suppressTap) {
      this.handleTap(point);
    }
    if (this.pointers.size === 1) this.armRemainingPointer();
    else this.suppressTap = false;
  };

  private onPointerLeave = (): void => {
    if (this.pointers.size > 0) return;
    this.crosshair = null;
    if (this.draft) this.draft.hover = null;
    this.crosshairEmitPending = true;
    this.markDirty(LAYER_OVERLAY);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.localPoint(event);
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (event.shiftKey) {
      this.viewport.rightIndex += delta / this.viewport.barSpacing;
      this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    } else {
      anchorZoom(this.viewport, point.x, Math.exp(-delta * 0.0012));
      this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    }
    this.syncFollowing();
    this.rangeStamp = '';
    this.trackPointer(point);
    this.markDirty(LAYER_ALL);
  };

  private onDoubleClick = (event: MouseEvent): void => {
    event.preventDefault();
    const point = this.localPoint(event);
    const id = this.hitDrawing(point.x, point.y);
    const drawing = id ? this.drawings.find((item) => item.id === id) : undefined;
    if (drawing && (drawing.type === 'text' || drawing.type === 'note') && !this.drawingsLocked) {
      this.selectedId = drawing.id;
      this.editText(drawing.id);
      return;
    }
    this.fitContent();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key === 'ArrowLeft') {
      event.preventDefault();
      this.scrollBy(-3);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      this.scrollBy(3);
    } else if (key === 'ArrowUp' || key === '+' || key === '=') {
      event.preventDefault();
      this.zoomBy(1.15);
    } else if (key === 'ArrowDown' || key === '-') {
      event.preventDefault();
      this.zoomBy(1 / 1.15);
    } else if (key === 'Escape') {
      this.draft = null;
      this.selectedId = null;
      this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
    } else if ((key === 'Delete' || key === 'Backspace') && this.selectedId && !this.drawingsLocked) {
      event.preventDefault();
      this.removeDrawing(this.selectedId);
    } else if (key === 'End') {
      this.scrollToRealtime();
    } else if (key === 'Home') {
      this.fitContent();
    }
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private handleTap(point: { x: number; y: number }): void {
    const anchor = this.anchorFrom(point);
    const tool = this.tool;
    if (this.drawingsLocked && tool !== 'crosshair' && tool !== 'cursor') return;
    if (!anchor || tool === 'crosshair' || tool === 'cursor' || tool === 'brush') {
      this.selectedId = anchor && tool !== 'brush' ? this.hitDrawing(point.x, point.y) : this.selectedId;
      this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
      return;
    }
    const needed = pointsFor(tool);
    if (needed === 1) {
      this.commitDrawing(tool, [anchor]);
      return;
    }
    if (!this.draft || this.draft.type !== tool) {
      this.draft = { type: tool, anchors: [anchor], hover: anchor };
      this.markDirty(LAYER_OVERLAY);
      return;
    }
    this.draft.anchors.push(anchor);
    this.draft.hover = anchor;
    if (this.draft.anchors.length >= needed) {
      this.commitDrawing(tool, this.draft.anchors);
      this.draft = null;
    }
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
  }

  private commitDrawing(tool: DrawingTool, anchors: Anchor[]): void {
    const text = tool === 'text' ? 'Text' : tool === 'note' ? 'Note' : undefined;
    const id = this.addDrawing({ type: tool, anchors, text });
    if (!id) return;
    this.selectedId = id;
    if (tool === 'text' || tool === 'note') this.editText(id);
    this.releaseTool();
  }

  /** One drawing per tool click. The next shape needs the tool chosen again. */
  private releaseTool(): void {
    if (!this.isDrawingTool()) return;
    this.setTool('crosshair');
  }

  private beginEdit(pointerId: number, point: { x: number; y: number }): boolean {
    if (this.drawingsLocked || !this.drawingsVisible) return false;
    const handle = this.hitHandle(point.x, point.y);
    const id = handle?.id ?? this.hitDrawing(point.x, point.y);
    if (!id) return false;
    const drawing = this.drawings.find((item) => item.id === id);
    const grab = this.anchorFrom(point, false);
    if (!drawing || !grab) return false;
    this.selectedId = id;
    this.edit = {
      id,
      index: handle && handle.id === id ? handle.index : -1,
      pointerId,
      origin: drawing.anchors.map((anchor) => ({ time: anchor.time, price: anchor.price })),
      grab,
      active: false,
    };
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
    return true;
  }

  private applyEdit(point: { x: number; y: number }): void {
    const edit = this.edit;
    if (!edit) return;
    const drawing = this.drawings.find((item) => item.id === edit.id);
    const next = this.anchorFrom(point, edit.index >= 0 && this.magnet);
    if (!drawing || !next) return;
    const dx = point.x - this.viewport.indexToX(timeToIndex(this.store.time, this.store.length, edit.grab.time));
    const dy = point.y - this.viewport.priceToY(edit.grab.price);
    if (!edit.active && Math.hypot(dx, dy) <= 4) return;
    edit.active = true;
    this.root.style.cursor = 'grabbing';
    if (edit.index >= 0) {
      const src = edit.origin[edit.index];
      if (!src) return;
      let time = next.time;
      let price = next.price;
      if (drawing.type === 'horizontal-line') time = src.time;
      if (drawing.type === 'vertical-line') price = src.price;
      drawing.anchors[edit.index] = { time, price };
    } else {
      const dTime = next.time - edit.grab.time;
      const dPrice = next.price - edit.grab.price;
      drawing.anchors = edit.origin.map((anchor) => ({ time: anchor.time + dTime, price: anchor.price + dPrice }));
    }
    this.markDirty(LAYER_DRAW | LAYER_OVERLAY);
  }

  private hitHandle(x: number, y: number): { id: string; index: number } | null {
    if (!this.selectedId) return null;
    const drawing = this.drawings.find((item) => item.id === this.selectedId);
    if (!drawing) return null;
    let nearest = -1;
    let best = 8;
    for (let i = 0; i < drawing.anchors.length; i++) {
      const anchor = drawing.anchors[i]!;
      const px = this.viewport.indexToX(timeToIndex(this.store.time, this.store.length, anchor.time));
      const py = this.viewport.priceToY(anchor.price);
      const dist = Math.hypot(px - x, py - y);
      if (dist <= best) {
        best = dist;
        nearest = i;
      }
    }
    return nearest < 0 ? null : { id: drawing.id, index: nearest };
  }

  private editText(id: string): void {
    const drawing = this.drawings.find((item) => item.id === id);
    const anchor = drawing?.anchors[0];
    if (!drawing || !anchor) return;
    const index = timeToIndex(this.store.time, this.store.length, anchor.time);
    const x = this.viewport.indexToX(index);
    const y = this.viewport.priceToY(anchor.price);
    const input = document.createElement('input');
    input.className = 'cschart-text';
    input.value = drawing.text ?? '';
    input.style.left = `${x}px`;
    input.style.top = `${y - 28}px`;
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    const finish = (save: boolean): void => {
      if (save) drawing.text = input.value.trim() || drawing.text || 'Text';
      input.remove();
      this.markDirty(LAYER_DRAW);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.root.append(input);
    input.focus();
    input.select();
  }

  private isDrawingTool(): boolean {
    return this.tool !== 'cursor' && this.tool !== 'crosshair';
  }

  private brushMoved(last: Anchor, next: Anchor): boolean {
    const span = this.viewport.priceMax - this.viewport.priceMin || 1;
    const height = this.viewport.candleBottom - this.viewport.plotTop || 1;
    const dx = (timeToIndex(this.store.time, this.store.length, next.time)
      - timeToIndex(this.store.time, this.store.length, last.time)) * this.viewport.barSpacing;
    const dy = ((last.price - next.price) / span) * height;
    return Math.hypot(dx, dy) >= 2.5;
  }

  private startPinch(): void {
    const pair = this.pointerPair();
    if (!pair) return;
    const dist = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
    const midX = (pair[0].x + pair[1].x) / 2;
    this.pinch = {
      dist: Math.max(1, dist),
      spacing: this.viewport.barSpacing,
      midIndex: this.viewport.xToIndex(midX),
    };
    this.suppressTap = true;
    this.following = false;
  }

  private movePinch(): void {
    if (!this.pinch) return;
    const pair = this.pointerPair();
    if (!pair) return;
    const dist = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
    const midX = (pair[0].x + pair[1].x) / 2;
    const spacing = clamp(
      this.pinch.spacing * (dist / this.pinch.dist),
      this.viewport.minBarSpacing,
      this.viewport.maxBarSpacing,
    );
    this.viewport.barSpacing = spacing;
    this.viewport.rightIndex = this.pinch.midIndex + (this.viewport.plotRight - midX) / spacing;
    this.viewport.clampRightIndex(this.store.length, this.rightOffset);
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  private armRemainingPointer(): void {
    const entry = this.firstPointer();
    if (!entry) return;
    this.drag = {
      pointerId: entry[0],
      x: entry[1].x,
      y: entry[1].y,
      rightIndex: this.viewport.rightIndex,
      panning: false,
    };
  }

  private trackPointer(point: { x: number; y: number }): void {
    this.crosshair = point;
    this.crosshairEmitPending = true;
    if (this.draft) this.draft.hover = this.anchorFrom(point);
    this.markDirty(LAYER_OVERLAY);
  }

  private anchorFrom(point: { x: number; y: number }, snap = this.magnet): Anchor | null {
    if (this.store.length === 0 || !this.viewport.inCandlePane(point.x, point.y)) return null;
    const index = this.viewport.xToIndex(point.x);
    if (snap) {
      const bar = Math.max(0, Math.min(this.store.length - 1, Math.round(index)));
      const price = this.viewport.yToPrice(point.y);
      const choices = [this.store.open[bar]!, this.store.high[bar]!, this.store.low[bar]!, this.store.close[bar]!];
      let nearest = choices[0]!;
      for (const choice of choices) {
        if (Math.abs(choice - price) < Math.abs(nearest - price)) nearest = choice;
      }
      return { time: this.store.time[bar]!, price: nearest };
    }
    return {
      time: indexToTime(this.store.time, this.store.length, index),
      price: this.viewport.yToPrice(point.y),
    };
  }

  private hitDrawing(x: number, y: number): string | null {
    if (!this.drawingsVisible || this.store.length === 0) return null;
    const vp = this.viewport;
    return hitTestDrawings(
      this.drawings,
      x,
      y,
      (anchor) => ({
        x: vp.indexToX(timeToIndex(this.store.time, this.store.length, anchor.time)),
        y: vp.priceToY(anchor.price),
      }),
      { left: vp.plotLeft, top: vp.plotTop, right: vp.plotRight, bottom: vp.candleBottom },
    );
  }

  private localPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private pointerPair(): [{ x: number; y: number }, { x: number; y: number }] | null {
    let first: { x: number; y: number } | null = null;
    for (const point of this.pointers.values()) {
      if (!first) first = point;
      else return [first, point];
    }
    return null;
  }

  private firstPointer(): [number, { x: number; y: number }] | null {
    for (const entry of this.pointers) return entry;
    return null;
  }

  private syncIndicators(index: number, kind: MutationKind): void {
    const last = this.store.length - 1;
    if (kind === 'insert' || index < last) this.indicators.recompute(this.store.close, this.store.length, this.store);
    else this.indicators.patchLast(this.store.close, this.store.length, this.store);
  }

  private noteData(index: number): void {
    this.dataPaint = true;
    this.dataIndex = index;
    this.rangeStamp = '';
    this.markDirty(LAYER_ALL);
  }

  private pinRealtime(): void {
    const last = Math.max(0, this.store.length - 1);
    this.viewport.rightIndex = last + this.rightOffset;
    this.following = true;
  }

  private applyFit(): void {
    const last = Math.max(0, this.store.length - 1);
    const slots = Math.max(1, last + this.rightOffset);
    let spacing = this.viewport.plotWidth / slots;
    if (spacing > this.viewport.maxBarSpacing) spacing = this.viewport.maxBarSpacing;
    this.viewport.barSpacing = spacing;
    this.viewport.rightIndex = last + this.rightOffset;
    this.viewport.clampRightIndex(this.store.length, this.rightOffset);
  }

  private syncFollowing(): void {
    const last = this.store.length - 1;
    if (last < 0) {
      this.following = true;
      return;
    }
    this.following = Math.abs(this.viewport.rightIndex - (last + this.rightOffset)) <= 0.5;
  }

  private barIntervalMs(): number {
    if (this.options.interval != null && this.options.interval > 0) return this.options.interval * 1000;
    return this.store.medianIntervalMs();
  }

  private baselineLevel(): number {
    const custom = this.options.series.baselineValue;
    if (custom != null && Number.isFinite(custom)) return custom;
    return this.store.length > 0 ? this.store.close[0]! : 0;
  }

  private markDirty(mask: number): void {
    this.dirty |= mask;
    if (this.rendering || this.raf !== 0 || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderFrame();
    });
  }

  private renderFrame(): void {
    if (this.destroyed) return;
    this.rendering = true;
    const started = performance.now();
    try {
      this.paint();
    } finally {
      this.rendering = false;
      this.lastRenderMs = performance.now() - started;
      if (this.dirty !== 0) this.markDirty(0);
    }
  }

  private paint(): void {
    if (!this.syncViewport()) return;
    if (this.pendingFit && this.viewport.plotWidth >= 2 && this.store.length > 0) {
      this.pendingFit = false;
      this.applyFit();
      this.following = false;
      this.dirty = LAYER_ALL;
      this.rangeStamp = '';
    }
    const needsScale = (this.dirty & (LAYER_BG | LAYER_SERIES | LAYER_DRAW)) !== 0 || this.dataPaint;
    const target = Math.max(2, Math.floor((this.viewport.candleBottom - this.viewport.plotTop) / 48));
    if (needsScale) {
      this.updatePriceRange();
      this.priceStep = nicePriceStep(this.viewport.priceMin, this.viewport.priceMax, target);
      if (this.adjustPriceGutter()) {
        this.layoutViewport();
        this.rangeStamp = '';
        this.updatePriceRange();
        this.priceStep = nicePriceStep(this.viewport.priceMin, this.viewport.priceMax, target);
      }
    } else {
      this.priceStep = nicePriceStep(this.viewport.priceMin, this.viewport.priceMax, target);
    }
    const viewChanged = this.viewChanged();
    const scaleChanged = this.viewport.priceMin !== this.paintedMin || this.viewport.priceMax !== this.paintedMax;
    const visible = this.viewport.visibleRange(this.store.length);
    const dirty = resolveDirty(
      this.dirty,
      this.dataPaint,
      this.dataIndex,
      viewChanged,
      scaleChanged,
      visible.from - 1,
      visible.to + 1,
    );
    this.timeStep = chooseTimeStep(this.viewport.barSpacing, this.barIntervalMs());
    if (dirty & LAYER_BG) this.refreshTicks(target);
    const scene = this.makeScene();
    if (dirty & LAYER_BG) {
      this.prepare(this.layers.bg.ctx, false);
      drawBackground(this.layers.bg.ctx, scene);
    }
    if (dirty & LAYER_SERIES) this.redrawSeries(scene);
    if (dirty & LAYER_DRAW) {
      this.prepare(this.layers.draw.ctx, true);
      drawDrawings(this.layers.draw.ctx, scene);
    }
    if (dirty & LAYER_OVERLAY) {
      const index = this.legendIndex();
      this.fillStudies(index);
      scene.studies = this.studyLabels;
      scene.legend = this.legendFor(index);
      this.prepare(this.layers.overlay.ctx, true);
      drawOverlay(this.layers.overlay.ctx, scene);
    }
    this.dirty = 0;
    this.dataPaint = false;
    this.dataIndex = -1;
    this.syncDrawbar();
    this.capturePainted();
    if (this.crosshairEmitPending) {
      this.crosshairEmitPending = false;
      this.emitCrosshair();
    }
    this.emitRange();
  }

  private syncViewport(): boolean {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.layoutViewport(width, height, dpr);
    if (width < 2 || height < 2) return false;
    const bitmapW = Math.max(1, Math.round(width * dpr));
    const bitmapH = Math.max(1, Math.round(height * dpr));
    if (bitmapW !== this.bitmapW || bitmapH !== this.bitmapH) {
      this.bitmapW = bitmapW;
      this.bitmapH = bitmapH;
      for (const layer of this.layerList) {
        layer.canvas.width = bitmapW;
        layer.canvas.height = bitmapH;
      }
      this.buffer = null;
      this.dirty = LAYER_ALL;
    }
    return true;
  }

  private layoutViewport(
    width = this.root.clientWidth,
    height = this.root.clientHeight,
    dpr = window.devicePixelRatio || 1,
  ): void {
    const volumeRatio = this.options.volume.visible ? this.options.volume.ratio : 0;
    const runs = this.indicators.list();
    const rsiRatio = runs.some((run) => run.kind === 'rsi') ? 0.16 : 0;
    const studyRatio = runs.some((run) => run.kind === 'script' && run.pane === 'oscillator') ? 0.16 : 0;
    this.viewport.layout(width, height, dpr, this.priceScaleWidth, TIME_SCALE_HEIGHT, volumeRatio, rsiRatio, studyRatio);
  }

  private updatePriceRange(): void {
    const visible = this.viewport.visibleRange(this.store.length);
    this.viewport.studyMin = 0;
    this.viewport.studyMax = 1;
    if (visible.to >= visible.from) {
      const pane = this.indicators.oscillatorRange(visible.from, visible.to);
      if (pane) {
        const pad = (pane.max - pane.min) * 0.1 || Math.abs(pane.max) * 0.1 || 1;
        this.viewport.studyMin = pane.min - pad;
        this.viewport.studyMax = pane.max + pad;
      }
    }
    if (!this.options.priceScale.autoScale && this.manual) {
      this.viewport.priceMin = this.manual.min;
      this.viewport.priceMax = this.manual.max;
      this.viewport.volumeMax = visible.to >= visible.from ? this.store.extrema(visible.from, visible.to).maxVolume : 0;
      return;
    }
    const base = this.baselineLevel();
    const stamp = [
      visible.from,
      visible.to,
      this.store.generation,
      this.indicators.generation,
      this.options.priceScale.padding,
      this.options.series.style,
      base,
    ].join('|');
    if (stamp === this.rangeStamp) return;
    this.rangeStamp = stamp;
    if (visible.to < visible.from) {
      this.viewport.priceMin = 0;
      this.viewport.priceMax = 1;
      this.viewport.volumeMax = 0;
      return;
    }
    const ext = this.store.extrema(visible.from, visible.to);
    let min = ext.min;
    let max = ext.max;
    const studies = this.indicators.range(visible.from, visible.to);
    if (studies) {
      if (studies.min < min) min = studies.min;
      if (studies.max > max) max = studies.max;
    }
    if (this.options.series.style === 'baseline') {
      if (base < min) min = base;
      if (base > max) max = base;
    }
    const span = max - min;
    const pad = span > 0 ? span * this.options.priceScale.padding : (Math.abs(max) || 1) * 0.05;
    this.viewport.priceMin = (span > 0 ? min : max) - pad;
    this.viewport.priceMax = max + pad;
    this.viewport.volumeMax = ext.maxVolume;
  }

  private adjustPriceGutter(): boolean {
    const ctx = this.layers.bg.ctx;
    ctx.font = `${this.options.layout.fontSize}px ${this.options.layout.fontFamily}`;
    const low = ctx.measureText(formatPrice(this.viewport.priceMin, this.priceStep || 1)).width;
    const high = ctx.measureText(formatPrice(this.viewport.priceMax, this.priceStep || 1)).width;
    const next = Math.max(64, Math.min(148, Math.ceil(Math.max(low, high) + 22)));
    if (Math.abs(next - this.priceScaleWidth) < 1) return false;
    this.priceScaleWidth = next;
    return true;
  }

  private refreshTicks(target: number): void {
    this.priceTicks = buildPriceTicks(
      this.viewport.priceMin,
      this.viewport.priceMax,
      (price) => this.viewport.priceToY(price),
      target,
    );
    const visible = this.viewport.visibleRange(this.store.length);
    this.timeTicks = buildTimeTicks(
      this.store.time,
      this.store.length,
      visible.from,
      visible.to,
      (index) => this.viewport.indexToX(index),
      this.viewport.barSpacing,
      this.barIntervalMs(),
      this.viewport.plotLeft,
      this.viewport.plotRight,
    );
  }

  private makeScene(): Scene {
    return {
      viewport: this.viewport,
      options: this.options,
      store: this.store,
      indicators: this.indicators,
      drawings: this.drawingsVisible ? this.drawings : [],
      selectedId: this.selectedId,
      draft: this.draft,
      crosshair: this.crosshair,
      legend: null,
      studies: this.studyLabels,
      priceTicks: this.priceTicks,
      timeTicks: this.timeTicks,
      priceStep: this.priceStep,
      timeStep: this.timeStep,
      baseline: this.baselineLevel(),
    };
  }

  private legendIndex(): number {
    if (this.crosshair && this.viewport.inPlot(this.crosshair.x, this.crosshair.y) && this.store.length > 0) {
      const index = Math.round(this.viewport.xToIndex(this.crosshair.x));
      if (index >= 0 && index < this.store.length) return index;
    }
    return this.store.length - 1;
  }

  private legendFor(index: number): LegendBar | null {
    if (index < 0 || index >= this.store.length) return null;
    const bar = this.legendBar;
    bar.index = index;
    bar.open = this.store.open[index]!;
    bar.high = this.store.high[index]!;
    bar.low = this.store.low[index]!;
    bar.close = this.store.close[index]!;
    bar.volume = this.store.volume[index]!;
    bar.previous = index > 0 ? this.store.close[index - 1]! : null;
    return bar;
  }

  private fillStudies(index: number): void {
    const values = this.indicators.valuesAt(index);
    this.studyLabels = values.map((value) => ({ label: value.label, value: value.value, color: value.color }));
  }

  private viewChanged(): boolean {
    const vp = this.viewport;
    return (
      vp.rightIndex !== this.paintedRight ||
      vp.barSpacing !== this.paintedSpacing ||
      vp.plotWidth !== this.paintedPlotW ||
      vp.plotHeight !== this.paintedPlotH
    );
  }

  private capturePainted(): void {
    this.paintedRight = this.viewport.rightIndex;
    this.paintedSpacing = this.viewport.barSpacing;
    this.paintedMin = this.viewport.priceMin;
    this.paintedMax = this.viewport.priceMax;
    this.paintedPlotW = this.viewport.plotWidth;
    this.paintedPlotH = this.viewport.plotHeight;
  }

  private prepare(ctx: CanvasRenderingContext2D, clear: boolean): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) ctx.clearRect(0, 0, this.bitmapW, this.bitmapH);
    ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
  }

  private redrawSeries(scene: Scene): void {
    const ctx = this.ensureBuffer();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.bufferW, this.bufferH);
    ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
    drawSeries(ctx, scene, this.drawState);
    const view = this.layers.series.ctx;
    view.setTransform(1, 0, 0, 1, 0, 0);
    view.clearRect(0, 0, this.bitmapW, this.bitmapH);
    view.drawImage(this.buffer as CanvasImageSource, 0, 0);
  }

  private ensureBuffer(): CanvasRenderingContext2D {
    if (this.buffer && this.bufferCtx && this.bufferW === this.bitmapW && this.bufferH === this.bitmapH) {
      return this.bufferCtx;
    }
    this.bufferW = this.bitmapW;
    this.bufferH = this.bitmapH;
    if (typeof OffscreenCanvas !== 'undefined') this.buffer = new OffscreenCanvas(this.bitmapW, this.bitmapH);
    else {
      const canvas = document.createElement('canvas');
      canvas.width = this.bitmapW;
      canvas.height = this.bitmapH;
      this.buffer = canvas;
    }
    const ctx = this.buffer.getContext('2d');
    if (!ctx) throw new Error('CandlestickChart: 2D canvas is not available');
    this.bufferCtx = ctx as CanvasRenderingContext2D;
    return this.bufferCtx;
  }

  private emitCrosshair(): void {
    const point = this.crosshair;
    let param: CrosshairMoveParam;
    if (!point || !this.viewport.inPlot(point.x, point.y) || this.store.length === 0) {
      param = { point: null, time: null, price: null, index: null, bar: null };
    } else {
      const raw = Math.round(this.viewport.xToIndex(point.x));
      const inside = raw >= 0 && raw < this.store.length;
      param = {
        point: { x: point.x, y: point.y },
        time: indexToTime(this.store.time, this.store.length, this.viewport.xToIndex(point.x)),
        price: this.viewport.inCandlePane(point.x, point.y) ? this.viewport.yToPrice(point.y) : null,
        index: inside ? raw : null,
        bar: inside ? this.store.getBar(raw) : null,
      };
    }
    for (const handler of this.crosshairSubs) {
      try {
        handler(param);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private mountDrawbar(): void {
    const colors = ['#42a5f5', '#f6465d', '#0ecb81', '#f5c542', '#c084fc', '#e7eef8'];
    const bar = document.createElement('div');
    bar.className = 'cschart-drawbar';
    bar.hidden = true;
    const stop = (event: Event): void => event.stopPropagation();
    bar.addEventListener('pointerdown', stop);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('keydown', stop);
    const paint = (color: string): void => {
      const drawing = this.drawings.find((item) => item.id === this.selectedId);
      if (!drawing || this.drawingsLocked) return;
      drawing.color = color;
      this.markDirty(LAYER_DRAW);
    };
    for (const color of colors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cschart-swatch';
      button.title = 'Color';
      button.style.background = color;
      button.dataset.color = color;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        paint(color);
      });
      bar.append(button);
    }
    const picker = document.createElement('label');
    picker.className = 'cschart-picker';
    picker.title = 'Custom color';
    picker.style.background = 'conic-gradient(#f6465d, #f5c542, #0ecb81, #42a5f5, #c084fc, #f6465d)';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#42a5f5';
    input.addEventListener('input', () => paint(input.value));
    picker.append(input);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cschart-delete';
    remove.title = 'Delete';
    remove.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.selectedId) this.removeDrawing(this.selectedId);
    });
    bar.append(picker, remove);
    this.root.append(bar);
    this.drawbar = bar;
  }

  private syncDrawbar(): void {
    const bar = this.drawbar;
    if (!bar) return;
    const drawing = this.selectedId && this.drawingsVisible && !this.drawingsLocked
      ? this.drawings.find((item) => item.id === this.selectedId)
      : undefined;
    if (!drawing || drawing.anchors.length === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const ink = (drawing.color || this.options.drawings.color).toLowerCase();
    for (const button of bar.querySelectorAll<HTMLButtonElement>('.cschart-swatch')) {
      button.setAttribute('aria-pressed', button.dataset.color === ink ? 'true' : 'false');
    }
    let x = drawing.anchors[0]!.time;
    let y = Infinity;
    let anchorX = 0;
    for (const anchor of drawing.anchors) {
      const py = this.viewport.priceToY(anchor.price);
      if (py < y) {
        y = py;
        x = anchor.time;
        anchorX = this.viewport.indexToX(timeToIndex(this.store.time, this.store.length, x));
      }
    }
    const width = bar.offsetWidth || 168;
    const left = Math.min(Math.max(this.viewport.plotLeft, anchorX - width / 2), this.viewport.plotRight - width);
    let top = y - 38;
    if (top < this.viewport.plotTop) top = Math.min(y + 14, this.viewport.candleBottom - 34);
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  private emitTool(): void {
    for (const handler of this.toolSubs) {
      try {
        handler(this.tool);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private emitSeries(): void {
    const bar = this.store.getBar(this.store.length - 1);
    this.root.setAttribute('aria-label', bar ? `Candlestick chart, last ${bar.close}` : 'Candlestick chart');
    for (const handler of this.seriesSubs) {
      try {
        handler(bar);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private emitRange(): void {
    if (this.rangeSubs.size === 0 || this.store.length === 0) return;
    const from = this.viewport.xToIndex(this.viewport.plotLeft);
    const to = this.viewport.xToIndex(this.viewport.plotRight);
    if (
      this.lastRange &&
      Math.abs(this.lastRange.from - from) < 1e-4 &&
      Math.abs(this.lastRange.to - to) < 1e-4 &&
      Math.abs(this.lastRange.spacing - this.viewport.barSpacing) < 1e-6
    ) {
      return;
    }
    this.lastRange = { from, to, spacing: this.viewport.barSpacing };
    const range = { from, to };
    for (const handler of this.rangeSubs) {
      try {
        handler(range);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

function makeLayer(alpha: boolean): Layer {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha });
  if (!ctx) throw new Error('CandlestickChart: 2D canvas is not available');
  return { canvas, ctx };
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.head.append(style);
}

function resolveContainer(container: HTMLElement | string): HTMLElement {
  if (typeof container === 'string') {
    const found = document.querySelector(container);
    if (!(found instanceof HTMLElement)) throw new Error(`CandlestickChart: container not found: ${container}`);
    return found;
  }
  if (!(container instanceof HTMLElement)) throw new Error('CandlestickChart: container is required');
  return container;
}

export function create(container: HTMLElement | string, options?: ChartOptions): Chart {
  return new Chart(container, options);
}

export const createChart = create;
