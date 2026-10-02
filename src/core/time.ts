/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import { lowerBound } from './search';

/**
 * Accept seconds or milliseconds. Modern millisecond timestamps are >= 1e11
 * (about March 1973); second timestamps stay below that for centuries.
 */
export function normalizeTimeMs(time: number): number {
  if (!Number.isFinite(time)) return NaN;
  return Math.abs(time) < 1e11 ? time * 1000 : time;
}

export function indexToTime(times: ArrayLike<number>, length: number, index: number): number {
  if (length <= 0) return NaN;
  if (length === 1) return times[0]!;
  if (index <= 0) {
    const step = times[1]! - times[0]! || 1;
    return times[0]! + index * step;
  }
  if (index >= length - 1) {
    const step = times[length - 1]! - times[length - 2]! || 1;
    return times[length - 1]! + (index - (length - 1)) * step;
  }
  const i0 = Math.floor(index);
  const frac = index - i0;
  const t0 = times[i0]!;
  const t1 = times[i0 + 1]!;
  return t0 + (t1 - t0) * frac;
}

export function timeToIndex(times: ArrayLike<number>, length: number, timeMs: number): number {
  if (length <= 0) return 0;
  if (length === 1) return 0;
  const first = times[0]!;
  const last = times[length - 1]!;
  if (timeMs <= first) {
    const step = times[1]! - first || 1;
    return (timeMs - first) / step;
  }
  if (timeMs >= last) {
    const step = last - times[length - 2]! || 1;
    return length - 1 + (timeMs - last) / step;
  }
  const i1 = lowerBound(times, length, timeMs);
  if (times[i1] === timeMs) return i1;
  const i0 = i1 - 1;
  const span = times[i1]! - times[i0]! || 1;
  return i0 + (timeMs - times[i0]!) / span;
}
