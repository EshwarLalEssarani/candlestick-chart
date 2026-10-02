/** Eshwar Lal — https://github.com/EshwarLalEssarani */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const BOTTOM = 4;
const TOP = 8;

function code(x: number, y: number, rect: Rect): number {
  let bits = INSIDE;
  if (x < rect.left) bits |= LEFT;
  else if (x > rect.right) bits |= RIGHT;
  if (y < rect.top) bits |= TOP;
  else if (y > rect.bottom) bits |= BOTTOM;
  return bits;
}

/** Cohen–Sutherland clip. Returns null when the segment misses the rectangle. */
export function clipLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
): [number, number, number, number] | null {
  let c1 = code(x1, y1, rect);
  let c2 = code(x2, y2, rect);
  for (let guard = 0; guard < 12; guard++) {
    if ((c1 | c2) === 0) return [x1, y1, x2, y2];
    if ((c1 & c2) !== 0) return null;
    const out = c1 !== 0 ? c1 : c2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let x = 0;
    let y = 0;
    if (out & TOP) {
      x = dy === 0 ? x1 : x1 + (dx * (rect.top - y1)) / dy;
      y = rect.top;
    } else if (out & BOTTOM) {
      x = dy === 0 ? x1 : x1 + (dx * (rect.bottom - y1)) / dy;
      y = rect.bottom;
    } else if (out & RIGHT) {
      y = dx === 0 ? y1 : y1 + (dy * (rect.right - x1)) / dx;
      x = rect.right;
    } else {
      y = dx === 0 ? y1 : y1 + (dy * (rect.left - x1)) / dx;
      x = rect.left;
    }
    if (out === c1) {
      x1 = x;
      y1 = y;
      c1 = code(x1, y1, rect);
    } else {
      x2 = x;
      y2 = y;
      c2 = code(x2, y2, rect);
    }
  }
  return null;
}

export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(px - x, py - y);
}
