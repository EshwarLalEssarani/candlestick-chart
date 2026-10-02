/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { BarData } from '../types';
import { normalizeTimeMs } from './time';

const BLOCK = 256;

export type MutationKind = 'set' | 'update' | 'append' | 'insert';

export interface Mutation {
  kind: MutationKind;
  index: number;
}

interface Extrema {
  min: number;
  max: number;
  maxVolume: number;
}

function isValidBar(bar: BarData): boolean {
  return (
    !!bar &&
    Number.isFinite(bar.time) &&
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close)
  );
}

function grow(src: Float64Array<ArrayBuffer>, length: number, cap: number): Float64Array<ArrayBuffer> {
  const next = new Float64Array(cap);
  next.set(src.subarray(0, length));
  return next;
}

/**
 * Column store of OHLCV bars. Times are milliseconds and strictly increasing.
 * Block minima/maxima make a full-range price query touch ~n/256 values.
 */
export class DataStore {
  time = new Float64Array(0);
  open = new Float64Array(0);
  high = new Float64Array(0);
  low = new Float64Array(0);
  close = new Float64Array(0);
  volume = new Float64Array(0);
  length = 0;
  generation = 0;

  private blockHigh = new Float64Array(0);
  private blockLow = new Float64Array(0);
  private blockVol = new Float64Array(0);
  private intervalMs = 60_000;

  setData(data: readonly BarData[]): Mutation {
    const src: BarData[] = [];
    for (let i = 0; i < data.length; i++) {
      const bar = data[i]!;
      if (isValidBar(bar)) src.push(bar);
    }
    src.sort((a, b) => normalizeTimeMs(a.time) - normalizeTimeMs(b.time));
    this.ensure(src.length);
    let w = 0;
    for (let i = 0; i < src.length; i++) {
      const bar = src[i]!;
      const time = normalizeTimeMs(bar.time);
      const high = Math.max(bar.high, bar.open, bar.close, bar.low);
      const low = Math.min(bar.low, bar.open, bar.close, bar.high);
      const volume = Number.isFinite(bar.volume) ? Math.max(0, bar.volume!) : 0;
      if (w > 0 && time === this.time[w - 1]) {
        this.write(w - 1, time, bar.open, high, low, bar.close, volume);
      } else {
        this.write(w, time, bar.open, high, low, bar.close, volume);
        w++;
      }
    }
    this.length = w;
    this.rebuildBlocks();
    this.recomputeInterval();
    this.generation++;
    return { kind: 'set', index: 0 };
  }

  updateBar(bar: BarData): Mutation {
    if (!isValidBar(bar)) return { kind: 'update', index: -1 };
    const time = normalizeTimeMs(bar.time);
    const high = Math.max(bar.high, bar.open, bar.close, bar.low);
    const low = Math.min(bar.low, bar.open, bar.close, bar.high);
    const volume = Number.isFinite(bar.volume) ? Math.max(0, bar.volume!) : 0;
    const index = this.findTime(time);
    if (index < this.length && this.time[index] === time) {
      this.write(index, time, bar.open, high, low, bar.close, volume);
      this.touchBlock(index);
      this.generation++;
      return { kind: 'update', index };
    }
    if (index === this.length) {
      this.appendRaw(time, bar.open, high, low, bar.close, volume);
      return { kind: 'append', index };
    }
    this.insertRaw(index, time, bar.open, high, low, bar.close, volume);
    return { kind: 'insert', index };
  }

  /**
   * Merge a trade into the bar that owns `timeMs`, or open a new bar when the
   * trade falls in a later bucket. `intervalMs` is the bar size.
   */
  appendTick(price: number, timeMs: number, volume: number, intervalMs: number): Mutation {
    if (!Number.isFinite(price)) return { kind: 'update', index: -1 };
    const interval = intervalMs > 0 ? intervalMs : this.intervalMs || 60_000;
    const vol = Number.isFinite(volume) ? Math.max(0, volume) : 0;
    if (this.length === 0) {
      this.appendRaw(timeMs, price, price, price, price, vol);
      return { kind: 'append', index: 0 };
    }
    const last = this.length - 1;
    const lastTime = this.time[last]!;
    if (timeMs >= lastTime && timeMs < lastTime + interval) {
      this.mergeTick(last, price, vol);
      return { kind: 'update', index: last };
    }
    if (timeMs >= lastTime + interval) {
      const steps = Math.max(1, Math.floor((timeMs - lastTime) / interval));
      this.appendRaw(lastTime + steps * interval, price, price, price, price, vol);
      return { kind: 'append', index: this.length - 1 };
    }
    const found = this.findTime(timeMs);
    const owner = found < this.length && this.time[found] === timeMs ? found : found - 1;
    if (owner >= 0 && timeMs >= this.time[owner]! && timeMs < this.time[owner]! + interval) {
      this.mergeTick(owner, price, vol);
      return { kind: 'update', index: owner };
    }
    return { kind: 'update', index: -1 };
  }

  private mergeTick(index: number, price: number, volume: number): void {
    this.high[index] = Math.max(this.high[index]!, price);
    this.low[index] = Math.min(this.low[index]!, price);
    this.close[index] = price;
    this.volume[index] = (this.volume[index] ?? 0) + volume;
    this.touchBlock(index);
    this.generation++;
  }

  getBar(index: number): BarData | null {
    if (index < 0 || index >= this.length) return null;
    return {
      time: this.time[index]!,
      open: this.open[index]!,
      high: this.high[index]!,
      low: this.low[index]!,
      close: this.close[index]!,
      volume: this.volume[index]!,
    };
  }

  /** First index with `time >= timeMs`, or `length` if the series ends earlier. */
  findTime(timeMs: number): number {
    let lo = 0;
    let hi = this.length;
    const times = this.time;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid]! < timeMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  medianIntervalMs(): number {
    return this.intervalMs;
  }

  extrema(from: number, to: number): Extrema {
    if (this.length === 0 || to < from) return { min: 0, max: 1, maxVolume: 0 };
    const start = Math.max(0, from);
    const end = Math.min(this.length - 1, to);
    const acc: Extrema = { min: Infinity, max: -Infinity, maxVolume: 0 };
    let cursor = start;
    while (cursor <= end) {
      const blockStart = Math.floor(cursor / BLOCK) * BLOCK;
      const blockEnd = blockStart + BLOCK - 1;
      if (cursor === blockStart && blockEnd <= end) {
        const b = blockStart / BLOCK;
        const hi = this.blockHigh[b]!;
        const lo = this.blockLow[b]!;
        const vo = this.blockVol[b]!;
        if (hi > acc.max) acc.max = hi;
        if (lo < acc.min) acc.min = lo;
        if (vo > acc.maxVolume) acc.maxVolume = vo;
        cursor = blockEnd + 1;
      } else {
        const stop = Math.min(end, blockEnd);
        this.accumulate(cursor, stop, acc);
        cursor = stop + 1;
      }
    }
    if (!Number.isFinite(acc.min) || !Number.isFinite(acc.max)) return { min: 0, max: 1, maxVolume: 0 };
    return acc;
  }

  private appendRaw(time: number, open: number, high: number, low: number, close: number, volume: number): void {
    const index = this.length;
    this.ensure(index + 1);
    this.write(index, time, open, high, low, close, volume);
    this.length = index + 1;
    this.touchBlock(index);
    this.generation++;
    if (index > 0) {
      const delta = time - this.time[index - 1]!;
      if (delta > 0) this.intervalMs = delta;
    }
  }

  private insertRaw(index: number, time: number, open: number, high: number, low: number, close: number, volume: number): void {
    this.ensure(this.length + 1);
    this.time.copyWithin(index + 1, index, this.length);
    this.open.copyWithin(index + 1, index, this.length);
    this.high.copyWithin(index + 1, index, this.length);
    this.low.copyWithin(index + 1, index, this.length);
    this.close.copyWithin(index + 1, index, this.length);
    this.volume.copyWithin(index + 1, index, this.length);
    this.write(index, time, open, high, low, close, volume);
    this.length++;
    this.rebuildBlocks();
    this.recomputeInterval();
    this.generation++;
  }

  private write(index: number, time: number, open: number, high: number, low: number, close: number, volume: number): void {
    this.time[index] = time;
    this.open[index] = open;
    this.high[index] = high;
    this.low[index] = low;
    this.close[index] = close;
    this.volume[index] = volume;
  }

  private ensure(count: number): void {
    if (count <= this.time.length) return;
    let cap = this.time.length || 256;
    while (cap < count) cap *= 2;
    const n = this.length;
    this.time = grow(this.time, n, cap);
    this.open = grow(this.open, n, cap);
    this.high = grow(this.high, n, cap);
    this.low = grow(this.low, n, cap);
    this.close = grow(this.close, n, cap);
    this.volume = grow(this.volume, n, cap);
  }

  private ensureBlocks(count: number): void {
    if (count <= this.blockHigh.length) return;
    let cap = this.blockHigh.length || 4;
    while (cap < count) cap *= 2;
    const high = new Float64Array(cap);
    const low = new Float64Array(cap);
    const vol = new Float64Array(cap);
    high.set(this.blockHigh);
    low.set(this.blockLow);
    vol.set(this.blockVol);
    this.blockHigh = high;
    this.blockLow = low;
    this.blockVol = vol;
  }

  private rebuildBlocks(): void {
    const blocks = Math.ceil(this.length / BLOCK);
    this.ensureBlocks(blocks);
    for (let b = 0; b < blocks; b++) this.rescanBlock(b);
  }

  private touchBlock(index: number): void {
    const b = Math.floor(index / BLOCK);
    this.ensureBlocks(b + 1);
    this.rescanBlock(b);
  }

  private rescanBlock(block: number): void {
    const start = block * BLOCK;
    const end = Math.min(this.length - 1, start + BLOCK - 1);
    let hi = -Infinity;
    let lo = Infinity;
    let vo = 0;
    for (let i = start; i <= end; i++) {
      if (this.high[i]! > hi) hi = this.high[i]!;
      if (this.low[i]! < lo) lo = this.low[i]!;
      if (this.volume[i]! > vo) vo = this.volume[i]!;
    }
    this.blockHigh[block] = hi;
    this.blockLow[block] = lo;
    this.blockVol[block] = vo;
  }

  private accumulate(from: number, to: number, acc: Extrema): void {
    for (let i = from; i <= to; i++) {
      if (this.high[i]! > acc.max) acc.max = this.high[i]!;
      if (this.low[i]! < acc.min) acc.min = this.low[i]!;
      if (this.volume[i]! > acc.maxVolume) acc.maxVolume = this.volume[i]!;
    }
  }

  private recomputeInterval(): void {
    const n = Math.min(this.length, 48);
    if (n < 2) {
      this.intervalMs = 60_000;
      return;
    }
    const deltas: number[] = [];
    const start = this.length - n;
    for (let i = start + 1; i < this.length; i++) {
      const delta = this.time[i]! - this.time[i - 1]!;
      if (delta > 0) deltas.push(delta);
    }
    if (deltas.length === 0) {
      this.intervalMs = 60_000;
      return;
    }
    deltas.sort((a, b) => a - b);
    this.intervalMs = deltas[deltas.length >> 1] ?? 60_000;
  }
}
