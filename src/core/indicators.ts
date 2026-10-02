/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { IndicatorBars, IndicatorCompute, OverlayKind, OverlayPane, OverlaySpec, OverlayValue } from '../types';

interface Run {
  id: string;
  kind: OverlayKind;
  period: number;
  mult: number;
  color: string;
  lineWidth: number;
  fill: string;
  label: string;
  pane: OverlayPane;
  compute: IndicatorCompute | null;
  mid: Float64Array;
  upper: Float64Array;
  lower: Float64Array;
}

export interface IndicatorSource {
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  volume: ArrayLike<number>;
}

const KIND_COLORS: Record<OverlayKind, string[]> = {
  sma: ['#f5c542', '#5ec8ff', '#c084fc', '#81c784'],
  ema: ['#f5c542', '#5ec8ff', '#c084fc', '#4dd0e1'],
  bollinger: ['#42a5f5', '#7e57c2', '#26c6da', '#8d6e63'],
  rsi: ['#a78bfa', '#5ec8ff', '#f5c542', '#f06292'],
  script: ['#f5c542', '#5ec8ff', '#2ebd85', '#f06292', '#ffb74d'],
};

function ensure(src: Float64Array, length: number): Float64Array {
  if (src.length >= length) return src;
  let cap = src.length || 256;
  while (cap < length) cap *= 2;
  const next = new Float64Array(cap);
  next.fill(NaN);
  next.set(src);
  return next;
}

function labelFor(kind: OverlayKind, period: number, custom?: string): string {
  const named = custom?.trim();
  if (named) return named;
  if (kind === 'sma') return `SMA ${period}`;
  if (kind === 'ema') return `EMA ${period}`;
  if (kind === 'rsi') return `RSI (${period})`;
  if (kind === 'script') return 'Script';
  return `BB ${period}`;
}

function isSeparatePane(run: Run): boolean {
  return run.kind === 'rsi' || run.pane === 'oscillator';
}

export class IndicatorEngine {
  private runs: Run[] = [];
  private seq = 1;
  private counts: Record<OverlayKind, number> = { sma: 0, ema: 0, bollinger: 0, rsi: 0, script: 0 };
  generation = 0;
  private seriesLength = 0;

  add(spec: OverlaySpec): Run {
    const period = Math.max(1, Math.floor(spec.period) || 1);
    const kind = spec.kind;
    const color = spec.color ?? KIND_COLORS[kind][this.counts[kind] % KIND_COLORS[kind].length]!;
    this.counts[kind]++;
    const run: Run = {
      id: `o${this.seq++}`,
      kind,
      period,
      mult: spec.mult && spec.mult > 0 ? spec.mult : 2,
      color,
      lineWidth: spec.lineWidth && spec.lineWidth > 0 ? spec.lineWidth : kind === 'bollinger' ? 1 : 1.5,
      fill: spec.fill ?? hexAlpha(color, 0.08),
      label: labelFor(kind, period, spec.label),
      pane: spec.pane === 'oscillator' ? 'oscillator' : 'price',
      compute: kind === 'script' && typeof spec.compute === 'function' ? spec.compute : null,
      mid: new Float64Array(0),
      upper: new Float64Array(0),
      lower: new Float64Array(0),
    };
    this.runs.push(run);
    this.generation++;
    return run;
  }

  remove(id: string): boolean {
    const index = this.runs.findIndex((run) => run.id === id);
    if (index < 0) return false;
    this.runs.splice(index, 1);
    this.generation++;
    return true;
  }

  clear(): void {
    if (this.runs.length === 0) return;
    this.runs = [];
    this.counts = { sma: 0, ema: 0, bollinger: 0, rsi: 0, script: 0 };
    this.generation++;
  }

  list(): readonly Run[] {
    return this.runs;
  }

  recompute(close: Float64Array, length: number, source?: IndicatorSource): void {
    this.seriesLength = length;
    for (const run of this.runs) {
      this.prepare(run, length);
      this.fill(run, close, length, source, false);
    }
    this.generation++;
  }

  /** Recompute only the newest point. Earlier values stay valid for an in-place last-bar edit or an append. */
  patchLast(close: Float64Array, length: number, source?: IndicatorSource): void {
    this.seriesLength = length;
    const index = length - 1;
    if (index < 0) return;
    for (const run of this.runs) {
      this.prepare(run, length);
      this.fill(run, close, length, source, true);
    }
    this.generation++;
  }

  range(from: number, to: number): { min: number; max: number } | null {
    if (this.runs.length === 0 || to < from) return null;
    let min = Infinity;
    let max = -Infinity;
    let any = false;
    const start = Math.max(0, from);
    const end = Math.min(this.seriesLength - 1, to);
    for (const run of this.runs) {
      if (isSeparatePane(run)) continue;
      const arrays = run.kind === 'bollinger' ? [run.upper, run.lower] : [run.mid];
      for (const values of arrays) {
        for (let i = start; i <= end; i++) {
          const value = values[i]!;
          if (!Number.isFinite(value)) continue;
          any = true;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    return any ? { min, max } : null;
  }

  valuesAt(index: number): OverlayValue[] {
    if (index < 0 || index >= this.seriesLength) return [];
    const out: OverlayValue[] = [];
    for (const run of this.runs) {
      if (isSeparatePane(run)) continue;
      const value = run.mid[index];
      if (value === undefined || !Number.isFinite(value)) continue;
      out.push({ id: run.id, label: run.label, value, color: run.color });
    }
    return out;
  }

  /** Visible range of oscillator-pane scripts. RSI keeps its own 0–100 scale. */
  oscillatorRange(from: number, to: number): { min: number; max: number } | null {
    if (to < from) return null;
    let min = Infinity;
    let max = -Infinity;
    let any = false;
    const start = Math.max(0, from);
    const end = Math.min(this.seriesLength - 1, to);
    for (const run of this.runs) {
      if (run.kind !== 'script' || run.pane !== 'oscillator') continue;
      for (let i = start; i <= end; i++) {
        const value = run.mid[i]!;
        if (!Number.isFinite(value)) continue;
        any = true;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    return any ? { min, max } : null;
  }

  private fill(run: Run, close: Float64Array, length: number, source: IndicatorSource | undefined, lastOnly: boolean): void {
    if (run.kind === 'script') {
      fillScript(run, source, length);
      return;
    }
    if (run.kind === 'ema') {
      if (lastOnly) emaPoint(run, close, length - 1);
      else fillEma(run, close, length);
      return;
    }
    if (run.kind === 'rsi') {
      fillRsi(run, close, length);
      return;
    }
    if (lastOnly) windowPoint(run, close, length - 1);
    else fillWindow(run, close, length);
  }

  private prepare(run: Run, length: number): void {
    run.mid = ensure(run.mid, length);
    if (run.kind === 'bollinger') {
      run.upper = ensure(run.upper, length);
      run.lower = ensure(run.lower, length);
    }
  }
}

function fillScript(run: Run, source: IndicatorSource | undefined, length: number): void {
  if (!run.compute || !source || length <= 0) {
    run.mid.fill(NaN, 0, length);
    return;
  }
  const bars: IndicatorBars = {
    open: source.open,
    high: source.high,
    low: source.low,
    close: source.close,
    volume: source.volume,
    length,
  };
  let values: ArrayLike<number> | number;
  try {
    values = run.compute(bars);
  } catch {
    run.mid.fill(NaN, 0, length);
    return;
  }
  if (typeof values === 'number') {
    const flat = Number.isFinite(values) ? values : NaN;
    run.mid.fill(flat, 0, length);
    return;
  }
  for (let i = 0; i < length; i++) {
    const value = values?.[i];
    run.mid[i] = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }
}

function fillWindow(run: Run, close: Float64Array, length: number): void {
  const period = run.period;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < length; i++) {
    const price = close[i]!;
    sum += price;
    sumSq += price * price;
    if (i >= period) {
      const old = close[i - period]!;
      sum -= old;
      sumSq -= old * old;
    }
    writeWindow(run, i, sum, sumSq, i >= period - 1);
  }
}

function windowPoint(run: Run, close: Float64Array, index: number): void {
  const period = run.period;
  if (index < period - 1) {
    writeWindow(run, index, 0, 0, false);
    return;
  }
  let sum = 0;
  let sumSq = 0;
  const start = index - period + 1;
  for (let i = start; i <= index; i++) {
    const price = close[i]!;
    sum += price;
    sumSq += price * price;
  }
  writeWindow(run, index, sum, sumSq, true);
}

function writeWindow(run: Run, index: number, sum: number, sumSq: number, ready: boolean): void {
  if (!ready) {
    run.mid[index] = NaN;
    if (run.kind === 'bollinger') {
      run.upper[index] = NaN;
      run.lower[index] = NaN;
    }
    return;
  }
  const period = run.period;
  const mid = sum / period;
  run.mid[index] = mid;
  if (run.kind !== 'bollinger') return;
  let variance = (sumSq - (sum * sum) / period) / period;
  if (variance < 0) variance = 0;
  const std = Math.sqrt(variance);
  run.upper[index] = mid + run.mult * std;
  run.lower[index] = mid - run.mult * std;
}

function fillEma(run: Run, close: Float64Array, length: number): void {
  for (let i = 0; i < length; i++) emaPoint(run, close, i);
}

function emaPoint(run: Run, close: Float64Array, index: number): void {
  const period = run.period;
  if (index < period - 1) {
    run.mid[index] = NaN;
    return;
  }
  if (index === period - 1) {
    let sum = 0;
    for (let i = 0; i <= index; i++) sum += close[i]!;
    run.mid[index] = sum / period;
    return;
  }
  const k = 2 / (period + 1);
  const prev = run.mid[index - 1]!;
  run.mid[index] = close[index]! * k + prev * (1 - k);
}

/** Wilder RSI. Values stay on a 0–100 scale and are omitted from the price range. */
function fillRsi(run: Run, close: Float64Array, length: number): void {
  const period = run.period;
  if (length <= 0) return;
  run.mid[0] = NaN;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < length; i++) {
    const change = close[i]! - close[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i < period) {
      avgGain += gain;
      avgLoss += loss;
      run.mid[i] = NaN;
      continue;
    }
    if (i === period) {
      avgGain = (avgGain + gain) / period;
      avgLoss = (avgLoss + loss) / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    run.mid[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
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

export type { Run as IndicatorRun };
