/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { Anchor, Drawing } from '../types';
import { pointsFor } from './draw-tools';
import { FIB_LEVELS } from './fib';
import { distToSegment, type Rect } from './geometry';

type Point = { x: number; y: number };

const EXT_LEVELS = [0, 0.382, 0.5, 0.618, 1, 1.618, 2.618];

export function hitTestDrawings(
  drawings: readonly Drawing[],
  x: number,
  y: number,
  project: (anchor: Anchor) => Point,
  rect: Rect,
  threshold = 6,
): string | null {
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i]!;
    if (hits(drawing, x, y, project, rect, threshold)) return drawing.id;
  }
  return null;
}

function hits(
  drawing: Drawing,
  x: number,
  y: number,
  project: (anchor: Anchor) => Point,
  rect: Rect,
  threshold: number,
): boolean {
  const points = drawing.anchors.map((anchor) => project(anchor));
  const a = points[0];
  const b = points[1];
  const c = points[2];
  switch (drawing.type) {
    case 'horizontal-line':
      return !!a && Math.abs(a.y - y) <= threshold && x >= rect.left - threshold && x <= rect.right + threshold;
    case 'cross-line':
      return !!a && (Math.abs(a.y - y) <= threshold || Math.abs(a.x - x) <= threshold);
    case 'horizontal-ray':
      return !!a && Math.abs(a.y - y) <= threshold && x >= a.x - threshold && x <= rect.right + threshold;
    case 'vertical-line':
      return !!a && Math.abs(a.x - x) <= threshold && y >= rect.top - threshold && y <= rect.bottom + threshold;
    case 'trendline':
    case 'arrow':
    case 'measure':
      return !!a && !!b && distToSegment(x, y, a.x, a.y, b.x, b.y) <= threshold;
    case 'ray':
      return !!a && !!b && nearRay(x, y, a, b, rect, threshold, false);
    case 'extended-line':
      return !!a && !!b && nearRay(x, y, a, b, rect, threshold, true);
    case 'parallel-channel':
      return !!a && !!b && (distToSegment(x, y, a.x, a.y, b.x, b.y) <= threshold || (!!c && nearChannel(x, y, a, b, c, threshold)));
    case 'rectangle':
    case 'long-position':
    case 'short-position':
      return !!a && !!b && inBox(x, y, a, b, threshold);
    case 'ellipse':
      return !!a && !!b && inEllipse(x, y, a, b, threshold);
    case 'triangle':
      return points.length >= 3 && inPolygon(x, y, points.slice(0, 3));
    case 'brush':
      return nearPath(x, y, points, threshold);
    case 'fibonacci':
      return nearFib(x, y, drawing, project, rect, threshold, FIB_LEVELS, false);
    case 'fib-extension':
      return nearFib(x, y, drawing, project, rect, threshold, EXT_LEVELS, true);
    case 'pitchfork':
      return !!a && !!b && !!c && nearPitchfork(x, y, a, b, c, rect, threshold);
    case 'text':
    case 'note':
    case 'price-label':
      return !!a && Math.hypot(a.x - x, a.y - y) <= 18;
    default:
      return pointsFor(drawing.type) > 0 && !!a && Math.hypot(a.x - x, a.y - y) <= threshold;
  }
}

function nearRay(x: number, y: number, a: Point, b: Point, rect: Rect, threshold: number, both: boolean): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const span = Math.max(rect.right - rect.left, rect.bottom - rect.top) * 8;
  const x1 = both ? a.x - (dx / len) * span : a.x;
  const y1 = both ? a.y - (dy / len) * span : a.y;
  const x2 = a.x + (dx / len) * span;
  const y2 = a.y + (dy / len) * span;
  return distToSegment(x, y, x1, y1, x2, y2) <= threshold;
}

function nearChannel(x: number, y: number, a: Point, b: Point, c: Point, threshold: number): boolean {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = ((c.x - a.x) * vx + (c.y - a.y) * vy) / len2;
  const ox = c.x - a.x - vx * t;
  const oy = c.y - a.y - vy * t;
  return distToSegment(x, y, a.x + ox, a.y + oy, b.x + ox, b.y + oy) <= threshold;
}

function inBox(x: number, y: number, a: Point, b: Point, pad: number): boolean {
  const left = Math.min(a.x, b.x) - pad;
  const right = Math.max(a.x, b.x) + pad;
  const top = Math.min(a.y, b.y) - pad;
  const bottom = Math.max(a.y, b.y) + pad;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function inEllipse(x: number, y: number, a: Point, b: Point, pad: number): boolean {
  const rx = Math.abs(b.x - a.x) / 2 + pad;
  const ry = Math.abs(b.y - a.y) / 2 + pad;
  if (rx < 1 || ry < 1) return false;
  const dx = x - (a.x + b.x) / 2;
  const dy = y - (a.y + b.y) / 2;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

function inPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i]!;
    const pj = points[j]!;
    const hit = (pi.y > y) !== (pj.y > y) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y || 1) + pi.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function nearPath(x: number, y: number, points: Point[], threshold: number): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= threshold) return true;
  }
  return false;
}

function nearFib(
  x: number,
  y: number,
  drawing: Drawing,
  project: (anchor: Anchor) => Point,
  rect: Rect,
  threshold: number,
  levels: readonly number[],
  extension: boolean,
): boolean {
  const start = drawing.anchors[0];
  const mid = drawing.anchors[1];
  const end = drawing.anchors[2];
  if (!start || !mid) return false;
  if (extension && !end) return false;
  const left = Math.min(project(start).x, project(mid).x);
  for (const level of levels) {
    const price = extension && end
      ? end.price + (mid.price - start.price) * level
      : start.price + (mid.price - start.price) * level;
    const py = project({ time: start.time, price }).y;
    if (Math.abs(py - y) <= threshold && x >= left - threshold && x <= rect.right + threshold) return true;
  }
  return false;
}

function nearPitchfork(x: number, y: number, a: Point, b: Point, c: Point, rect: Rect, threshold: number): boolean {
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  return nearRay(x, y, a, mid, rect, threshold, true)
    || nearRay(x, y, b, { x: b.x + (mid.x - a.x), y: b.y + (mid.y - a.y) }, rect, threshold, true)
    || distToSegment(x, y, b.x, b.y, c.x, c.y) <= threshold;
}
