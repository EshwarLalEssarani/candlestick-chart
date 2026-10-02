/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { DataStore } from '../core/data-store';
import { FIB_COLORS, FIB_LEVELS } from '../core/fib';
import { clipLine } from '../core/geometry';
import { formatPrice } from '../core/ticks';
import { timeToIndex } from '../core/time';
import type { Viewport } from '../core/viewport';
import type { Anchor, DrawingTool, ResolvedOptions } from '../types';

type Ctx = CanvasRenderingContext2D;
type Point = { x: number; y: number };

export interface DrawHost {
  viewport: Viewport;
  options: ResolvedOptions;
  store: DataStore;
  priceStep: number;
}

const EXT_LEVELS = [0, 0.382, 0.5, 0.618, 1, 1.618, 2.618];

export function paintDrawing(
  ctx: Ctx,
  scene: DrawHost,
  anchors: readonly Anchor[],
  type: DrawingTool,
  selected: boolean,
  preview: boolean,
  text?: string,
): void {
  const color = selected ? scene.options.drawings.selectedColor : scene.options.drawings.color;
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const points = anchors.map((anchor) => project(scene, anchor));
  switch (type) {
    case 'horizontal-line':
      return strokeH(ctx, scene, points[0], true, anchors[0], preview);
    case 'horizontal-ray':
      return strokeH(ctx, scene, points[0], false, anchors[0], preview);
    case 'vertical-line':
      return strokeV(ctx, scene, points[0], selected);
    case 'cross-line':
      strokeH(ctx, scene, points[0], true, anchors[0], true);
      return strokeV(ctx, scene, points[0], selected);
    case 'trendline':
      return strokeSegment(ctx, points[0], points[1], selected, color);
    case 'arrow':
      return strokeArrow(ctx, points[0], points[1], selected, color);
    case 'ray':
      return strokeRay(ctx, scene, points[0], points[1], selected, color);
    case 'extended-line':
      return strokeExtended(ctx, scene, points[0], points[1], selected, color);
    case 'parallel-channel':
      return paintChannel(ctx, points, selected, color);
    case 'rectangle':
      return paintBox(ctx, points[0], points[1], color, false);
    case 'ellipse':
      return paintEllipse(ctx, points[0], points[1], color);
    case 'triangle':
      return paintPoly(ctx, points.slice(0, 3), color, selected);
    case 'brush':
      return paintPoly(ctx, points, color, false, false);
    case 'fibonacci':
      if (anchors[0] && anchors[1]) paintFib(ctx, scene, anchors[0], anchors[1], selected);
      return;
    case 'fib-extension':
      if (anchors[0] && anchors[1] && anchors[2]) paintFibExtension(ctx, scene, anchors[0], anchors[1], anchors[2]);
      else strokeSegment(ctx, points[0], points[1], false, color);
      return;
    case 'pitchfork':
      return paintPitchfork(ctx, scene, points, selected, color);
    case 'measure':
      return paintMeasure(ctx, scene, anchors, points, color);
    case 'long-position':
      return paintPosition(ctx, scene, anchors, 'long');
    case 'short-position':
      return paintPosition(ctx, scene, anchors, 'short');
    case 'text':
      return paintText(ctx, scene, points[0], text || 'Text', selected, color);
    case 'note':
      return paintNote(ctx, scene, points[0], text || 'Note', selected, color);
    case 'price-label':
      if (anchors[0] && points[0]) paintPriceTag(ctx, scene, points[0], anchors[0].price, color);
      return;
    default:
      return;
  }
}

function project(scene: DrawHost, anchor: Anchor): Point {
  const index = timeToIndex(scene.store.time, scene.store.length, anchor.time);
  return { x: scene.viewport.indexToX(index), y: scene.viewport.priceToY(anchor.price) };
}

function bounds(scene: DrawHost): { left: number; top: number; right: number; bottom: number } {
  const vp = scene.viewport;
  return { left: vp.plotLeft, top: vp.plotTop, right: vp.plotRight, bottom: vp.candleBottom };
}

function handle(ctx: Ctx, point: Point | undefined, color: string, selected: boolean): void {
  if (!selected || !point) return;
  ctx.fillStyle = color;
  ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
}

function strokeH(
  ctx: Ctx,
  scene: DrawHost,
  point: Point | undefined,
  full: boolean,
  anchor: Anchor | undefined,
  preview: boolean,
): void {
  if (!point) return;
  const vp = scene.viewport;
  ctx.beginPath();
  ctx.moveTo(full ? vp.plotLeft : Math.max(vp.plotLeft, point.x), point.y);
  ctx.lineTo(vp.plotRight, point.y);
  ctx.stroke();
  if (!preview && anchor) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatPrice(anchor.price, scene.priceStep), (full ? vp.plotLeft : point.x) + 6, point.y - 2);
  }
}

function strokeV(ctx: Ctx, scene: DrawHost, point: Point | undefined, selected: boolean): void {
  if (!point) return;
  const vp = scene.viewport;
  ctx.beginPath();
  ctx.moveTo(point.x, vp.plotTop);
  ctx.lineTo(point.x, vp.candleBottom);
  ctx.stroke();
  handle(ctx, point, ctx.strokeStyle as string, selected);
}

function strokeSegment(ctx: Ctx, a: Point | undefined, b: Point | undefined, selected: boolean, color: string): void {
  if (!a || !b) return;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  handle(ctx, a, color, selected);
  handle(ctx, b, color, selected);
}

function strokeArrow(ctx: Ctx, a: Point | undefined, b: Point | undefined, selected: boolean, color: string): void {
  if (!a || !b) return;
  strokeSegment(ctx, a, b, selected, color);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const size = 10;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - size * Math.cos(angle - 0.4), b.y - size * Math.sin(angle - 0.4));
  ctx.lineTo(b.x - size * Math.cos(angle + 0.4), b.y - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function strokeRay(ctx: Ctx, scene: DrawHost, a: Point | undefined, b: Point | undefined, selected: boolean, color: string): void {
  if (!a || !b) return;
  const far = extend(a, b, scene);
  const clipped = clipLine(a.x, a.y, far.x, far.y, bounds(scene));
  if (!clipped) return;
  ctx.beginPath();
  ctx.moveTo(clipped[0], clipped[1]);
  ctx.lineTo(clipped[2], clipped[3]);
  ctx.stroke();
  handle(ctx, a, color, selected);
  handle(ctx, b, color, selected);
}

function strokeExtended(ctx: Ctx, scene: DrawHost, a: Point | undefined, b: Point | undefined, selected: boolean, color: string): void {
  if (!a || !b) return;
  const back = extend(b, a, scene);
  const fore = extend(a, b, scene);
  const clipped = clipLine(back.x, back.y, fore.x, fore.y, bounds(scene));
  if (!clipped) return;
  ctx.beginPath();
  ctx.moveTo(clipped[0], clipped[1]);
  ctx.lineTo(clipped[2], clipped[3]);
  ctx.stroke();
  handle(ctx, a, color, selected);
  handle(ctx, b, color, selected);
}

function extend(from: Point, through: Point, scene: DrawHost): Point {
  const dx = through.x - from.x;
  const dy = through.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const span = Math.max(scene.viewport.plotWidth, scene.viewport.candleBottom - scene.viewport.plotTop) * 8;
  return { x: from.x + (dx / len) * span, y: from.y + (dy / len) * span };
}

function paintChannel(ctx: Ctx, points: Point[], selected: boolean, color: string): void {
  const a = points[0];
  const b = points[1];
  const c = points[2];
  if (!a || !b) return;
  const off = c ? offsetOf(a, b, c) : perpendicular(a, b, 40);
  const a2 = { x: a.x + off.x, y: a.y + off.y };
  const b2 = { x: b.x + off.x, y: b.y + off.y };
  ctx.fillStyle = hexAlpha(color, 0.12);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.lineTo(a2.x, a2.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.moveTo(a2.x, a2.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.stroke();
  handle(ctx, a, color, selected);
  handle(ctx, b, color, selected);
  if (c) handle(ctx, c, color, selected);
}

function offsetOf(a: Point, b: Point, c: Point): Point {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = ((c.x - a.x) * vx + (c.y - a.y) * vy) / len2;
  return { x: c.x - a.x - vx * t, y: c.y - a.y - vy * t };
}

function perpendicular(a: Point, b: Point, px: number): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (-(b.y - a.y) / len) * px, y: ((b.x - a.x) / len) * px };
}

function paintBox(ctx: Ctx, a: Point | undefined, b: Point | undefined, color: string, selected: boolean): void {
  if (!a || !b) return;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.fillStyle = hexAlpha(color, 0.12);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, w, h);
  handle(ctx, a, color, selected);
  handle(ctx, b, color, selected);
}

function paintEllipse(ctx: Ctx, a: Point | undefined, b: Point | undefined, color: string): void {
  if (!a || !b) return;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  ctx.fillStyle = hexAlpha(color, 0.12);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();
}

function paintPoly(ctx: Ctx, points: Point[], color: string, selected: boolean, close = true): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  if (close && points.length >= 3) {
    ctx.closePath();
    ctx.fillStyle = hexAlpha(color, 0.12);
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.stroke();
  if (selected) for (const point of points) handle(ctx, point, color, true);
}

function paintFib(ctx: Ctx, scene: DrawHost, a: Anchor, b: Anchor, selected: boolean): void {
  const vp = scene.viewport;
  const p1 = project(scene, a);
  const p2 = project(scene, b);
  const x1 = Math.max(vp.plotLeft, Math.min(p1.x, p2.x));
  const rows = FIB_LEVELS.map((level, index) => ({
    level,
    price: a.price + (b.price - a.price) * level,
    y: vp.priceToY(a.price + (b.price - a.price) * level),
    color: FIB_COLORS[index]!,
  }));
  const ordered = rows.slice().sort((left, right) => left.y - right.y);
  for (let i = 0; i < ordered.length - 1; i++) {
    const top = ordered[i]!;
    const bot = ordered[i + 1]!;
    ctx.fillStyle = hexAlpha(top.color, 0.14);
    ctx.fillRect(x1, top.y, vp.plotRight - x1, bot.y - top.y);
  }
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(186, 198, 220, 0.75)';
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
  ctx.font = `11px ${scene.options.layout.fontFamily}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const row of rows) {
    ctx.strokeStyle = row.color;
    ctx.beginPath();
    ctx.moveTo(x1, row.y);
    ctx.lineTo(vp.plotRight, row.y);
    ctx.stroke();
    const name = row.level === 0 || row.level === 1 || row.level === 0.5 ? String(row.level) : row.level.toFixed(3);
    ctx.fillStyle = row.color;
    ctx.fillText(`${name} (${formatPrice(row.price, scene.priceStep)})`, vp.plotRight - 6, row.y);
  }
  handle(ctx, p1, scene.options.drawings.selectedColor, selected);
  handle(ctx, p2, scene.options.drawings.selectedColor, selected);
}

function paintFibExtension(ctx: Ctx, scene: DrawHost, a: Anchor, b: Anchor, c: Anchor): void {
  const vp = scene.viewport;
  const start = project(scene, a);
  ctx.font = `11px ${scene.options.layout.fontFamily}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  EXT_LEVELS.forEach((level, index) => {
    const price = c.price + (b.price - a.price) * level;
    const y = vp.priceToY(price);
    const color = FIB_COLORS[index % FIB_COLORS.length]!;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(Math.max(vp.plotLeft, start.x), y);
    ctx.lineTo(vp.plotRight, y);
    ctx.stroke();
    const name = Number.isInteger(level) ? String(level) : level.toFixed(3);
    ctx.fillStyle = color;
    ctx.fillText(`${name} (${formatPrice(price, scene.priceStep)})`, vp.plotRight - 6, y);
  });
}

function paintPitchfork(ctx: Ctx, scene: DrawHost, points: Point[], selected: boolean, color: string): void {
  const a = points[0];
  const b = points[1];
  const c = points[2];
  if (!a || !b) return;
  if (!c) {
    strokeSegment(ctx, a, b, selected, color);
    return;
  }
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  strokeExtended(ctx, scene, a, mid, false, color);
  const dir = { x: mid.x - a.x, y: mid.y - a.y };
  strokeExtended(ctx, scene, b, { x: b.x + dir.x, y: b.y + dir.y }, false, color);
  strokeExtended(ctx, scene, c, { x: c.x + dir.x, y: c.y + dir.y }, false, color);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
  handle(ctx, a, color, selected);
  handle(ctx, b, color, selected);
  handle(ctx, c, color, selected);
}

function paintMeasure(ctx: Ctx, scene: DrawHost, anchors: readonly Anchor[], points: Point[], color: string): void {
  const a = anchors[0];
  const b = anchors[1];
  const p1 = points[0];
  const p2 = points[1];
  if (!a || !b || !p1 || !p2) return;
  ctx.save();
  ctx.setLineDash([4, 3]);
  strokeSegment(ctx, p1, p2, false, color);
  ctx.restore();
  const i1 = timeToIndex(scene.store.time, scene.store.length, a.time);
  const i2 = timeToIndex(scene.store.time, scene.store.length, b.time);
  const bars = Math.max(0, Math.round(Math.abs(i2 - i1)));
  const delta = b.price - a.price;
  const pct = a.price !== 0 ? (delta / Math.abs(a.price)) * 100 : 0;
  const sign = delta > 0 ? '+' : '';
  const label = `${sign}${formatPrice(delta, scene.priceStep)} (${sign}${pct.toFixed(2)}%)   ${bars} bars`;
  labelBox(ctx, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, label, color, scene);
}

function paintPosition(ctx: Ctx, scene: DrawHost, anchors: readonly Anchor[], side: 'long' | 'short'): void {
  const a = anchors[0];
  const b = anchors[1];
  if (!a || !b) return;
  const vp = scene.viewport;
  const dist = Math.abs(b.price - a.price) || Math.abs(a.price) * 0.002;
  const profit = side === 'long' ? a.price + dist : a.price - dist;
  const stop = side === 'long' ? a.price - dist : a.price + dist;
  const x1 = project(scene, a).x;
  const x2 = project(scene, b).x;
  const left = Math.min(x1, x2);
  const width = Math.max(8, Math.abs(x2 - x1));
  const yEntry = vp.priceToY(a.price);
  const yProfit = vp.priceToY(profit);
  const yStop = vp.priceToY(stop);
  ctx.fillStyle = 'rgba(14, 203, 129, 0.18)';
  ctx.fillRect(left, Math.min(yEntry, yProfit), width, Math.abs(yProfit - yEntry));
  ctx.fillStyle = 'rgba(246, 70, 93, 0.18)';
  ctx.fillRect(left, Math.min(yEntry, yStop), width, Math.abs(yStop - yEntry));
  ctx.strokeStyle = 'rgba(186, 198, 220, 0.8)';
  ctx.strokeRect(left, Math.min(yProfit, yStop), width, Math.abs(yStop - yProfit));
  const pct = a.price !== 0 ? (dist / Math.abs(a.price)) * 100 : 0;
  labelBox(ctx, left + width / 2, (yEntry + yProfit) / 2, `Target ${pct.toFixed(2)}%`, '#0ecb81', scene);
  labelBox(ctx, left + width / 2, (yEntry + yStop) / 2, `Stop ${pct.toFixed(2)}%`, '#f6465d', scene);
}

function paintText(ctx: Ctx, scene: DrawHost, point: Point | undefined, text: string, selected: boolean, color: string): void {
  if (!point) return;
  ctx.font = `13px ${scene.options.layout.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  ctx.fillText(text, point.x + 4, point.y - 2);
  handle(ctx, point, color, selected);
}

function paintNote(ctx: Ctx, scene: DrawHost, point: Point | undefined, text: string, selected: boolean, color: string): void {
  if (!point) return;
  ctx.font = `12px ${scene.options.layout.fontFamily}`;
  const width = ctx.measureText(text).width + 16;
  const height = 24;
  ctx.fillStyle = hexAlpha(scene.options.layout.background, 0.92);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.roundRect(point.x, point.y - height, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, point.x + 8, point.y - height / 2);
  handle(ctx, point, color, selected);
}

function paintPriceTag(ctx: Ctx, scene: DrawHost, point: Point, price: number, color: string): void {
  labelBox(ctx, point.x, point.y, formatPrice(price, scene.priceStep), color, scene);
}

function labelBox(ctx: Ctx, x: number, y: number, text: string, color: string, scene: DrawHost): void {
  ctx.font = `12px ${scene.options.layout.fontFamily}`;
  const width = ctx.measureText(text).width + 12;
  const height = 18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function hexAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
