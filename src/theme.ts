/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { ChartOptions, ResolvedOptions, ThemeName } from './types';

const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

const dark: ResolvedOptions = {
  width: null,
  height: null,
  interval: null,
  // Author credit stays in source. Nothing is painted unless an app sets this.
  watermark: '',
  header: { symbol: '', interval: '', exchange: '' },
  layout: {
    background: '#0b1220',
    textColor: '#8b9bb4',
    fontFamily: FONT,
    fontSize: 12,
    borderColor: '#1c2a44',
    watermarkColor: 'rgba(255,255,255,0.035)',
  },
  grid: { visible: true, color: 'rgba(120,144,180,0.14)' },
  candle: {
    upColor: '#0ecb81',
    downColor: '#f6465d',
    wickUpColor: '#0ecb81',
    wickDownColor: '#f6465d',
  },
  volume: {
    visible: true,
    upColor: 'rgba(14,203,129,0.65)',
    downColor: 'rgba(246,70,93,0.65)',
    ratio: 0.13,
  },
  series: {
    style: 'candlestick',
    baselineValue: null,
    topFill: 'rgba(14,203,129,0.28)',
    bottomFill: 'rgba(246,70,93,0.22)',
    topLine: '#0ecb81',
    bottomLine: '#f6465d',
  },
  crosshair: {
    visible: true,
    color: 'rgba(180,196,220,0.7)',
    labelBackground: '#1c2a44',
    labelText: '#ffffff',
  },
  timeScale: {
    barSpacing: 8,
    minBarSpacing: 0.001,
    maxBarSpacing: 48,
    rightOffset: 12,
  },
  priceScale: { autoScale: true, padding: 0.08 },
  drawings: { color: '#42a5f5', selectedColor: '#ffffff' },
};

const light: ResolvedOptions = {
  ...dark,
  layout: {
    ...dark.layout,
    background: '#ffffff',
    textColor: '#131722',
    borderColor: '#e0e3eb',
    watermarkColor: 'rgba(0,0,0,0.04)',
  },
  grid: { visible: true, color: 'rgba(0,0,0,0.06)' },
  crosshair: {
    ...dark.crosshair,
    color: 'rgba(19,23,34,0.45)',
    labelBackground: '#131722',
    labelText: '#ffffff',
  },
};

function cloneOptions(options: ResolvedOptions): ResolvedOptions {
  return {
    ...options,
    header: { ...options.header },
    layout: { ...options.layout },
    grid: { ...options.grid },
    candle: { ...options.candle },
    volume: { ...options.volume },
    series: { ...options.series },
    crosshair: { ...options.crosshair },
    timeScale: { ...options.timeScale },
    priceScale: { ...options.priceScale },
    drawings: { ...options.drawings },
  };
}

function assignDefined<T extends object>(target: T, patch?: Partial<T>): T {
  if (!patch) return target;
  const out = target;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return out;
}

export function themeDefaults(name: ThemeName = 'dark'): ResolvedOptions {
  return cloneOptions(name === 'light' ? light : dark);
}

export function resolveOptions(input?: ChartOptions): ResolvedOptions {
  const base = themeDefaults(input?.theme === 'light' ? 'light' : 'dark');
  if (!input) return base;
  return mergeOptions(base, input);
}

export function mergeOptions(base: ResolvedOptions, patch: ChartOptions): ResolvedOptions {
  const next = cloneOptions(base);
  if (patch.width !== undefined) next.width = patch.width;
  if (patch.height !== undefined) next.height = patch.height;
  if (patch.interval !== undefined) next.interval = patch.interval;
  if (patch.watermark !== undefined) next.watermark = patch.watermark;
  assignDefined(next.header, patch.header);
  assignDefined(next.layout, patch.layout);
  assignDefined(next.grid, patch.grid);
  assignDefined(next.candle, patch.candle);
  assignDefined(next.volume, patch.volume);
  assignDefined(next.series, patch.series);
  assignDefined(next.crosshair, patch.crosshair);
  assignDefined(next.timeScale, patch.timeScale);
  assignDefined(next.priceScale, patch.priceScale);
  assignDefined(next.drawings, patch.drawings);
  next.volume.ratio = clamp(next.volume.ratio, 0, 0.5);
  next.priceScale.padding = clamp(next.priceScale.padding, 0, 0.5);
  next.timeScale.minBarSpacing = Math.max(0.0001, next.timeScale.minBarSpacing);
  next.timeScale.maxBarSpacing = Math.max(next.timeScale.minBarSpacing, next.timeScale.maxBarSpacing);
  next.timeScale.barSpacing = clamp(
    next.timeScale.barSpacing,
    next.timeScale.minBarSpacing,
    next.timeScale.maxBarSpacing,
  );
  next.timeScale.rightOffset = Math.max(0, next.timeScale.rightOffset);
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
