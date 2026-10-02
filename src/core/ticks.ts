/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import { indexToTime, timeToIndex } from './time';

export interface PriceTick {
  price: number;
  y: number;
  label: string;
}

export interface TimeTick {
  time: number;
  x: number;
  label: string;
}

const TIME_STEPS = [
  1_000, 5_000, 15_000, 30_000,
  60_000, 300_000, 900_000, 1_800_000, 3_600_000,
  14_400_000, 21_600_000, 43_200_000, 86_400_000,
  86_400_000 * 7,
  86_400_000 * 30,
  86_400_000 * 90,
  86_400_000 * 365,
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function nicePriceStep(min: number, max: number, targetCount: number): number {
  const span = Math.abs(max - min) || Math.abs(max) || 1;
  const rough = span / Math.max(1, targetCount);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / pow;
  const nice = fraction >= 7.5 ? 10 : fraction >= 3.5 ? 5 : fraction >= 1.5 ? 2 : 1;
  return nice * pow;
}

export function formatPrice(price: number, step: number): string {
  if (!Number.isFinite(price)) return '';
  const absStep = Math.abs(step) || 1;
  let digits = 2;
  if (absStep < 1) digits = Math.min(8, Math.max(2, Math.ceil(-Math.log10(absStep))));
  const negative = price < 0;
  const [whole, frac] = Math.abs(price).toFixed(digits).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac !== undefined ? `${grouped}.${frac}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatVolume(volume: number): string {
  const abs = Math.abs(volume);
  if (abs >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
  return volume.toFixed(0);
}

export function formatTimeLabel(ms: number, stepMs: number): string {
  const date = new Date(ms);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()] ?? '';
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  if (stepMs < 60_000) return `${hh}:${mm}:${String(date.getUTCSeconds()).padStart(2, '0')}`;
  if (stepMs < 12 * 3_600_000) return `${hh}:${mm}`;
  if (stepMs < 86_400_000) return date.getUTCHours() === 0 ? String(day) : `${hh}:${mm}`;
  if (stepMs < 86_400_000 * 28) return String(day);
  if (stepMs < 86_400_000 * 365) return `${month} ${year}`;
  return String(year);
}

export function buildPriceTicks(
  min: number,
  max: number,
  priceToY: (price: number) => number,
  targetCount: number,
): PriceTick[] {
  if (!(max > min)) return [];
  const step = nicePriceStep(min, max, targetCount);
  const start = Math.ceil(min / step) * step;
  const ticks: PriceTick[] = [];
  const limit = Math.ceil((max - start) / step) + 1;
  for (let i = 0; i < limit && i < 80; i++) {
    const price = start + i * step;
    if (price > max + step * 1e-6) break;
    if (price < min - step * 1e-6) continue;
    ticks.push({ price, y: priceToY(price), label: formatPrice(price, step) });
  }
  return ticks;
}

export function buildTimeTicks(
  times: ArrayLike<number>,
  length: number,
  fromIndex: number,
  toIndex: number,
  indexToX: (index: number) => number,
  barSpacing: number,
  intervalMs: number,
  plotLeft: number,
  plotRight: number,
): TimeTick[] {
  if (length <= 0 || toIndex < fromIndex) return [];
  const step = chooseTimeStep(barSpacing, intervalMs);

  const startTime = indexToTime(times, length, fromIndex);
  const endTime = indexToTime(times, length, toIndex);
  const first = Math.ceil(startTime / step) * step;
  const count = Math.min(80, Math.ceil((endTime - first) / step) + 2);
  const ticks: TimeTick[] = [];
  let lastX = -Infinity;
  for (let n = 0; n < count; n++) {
    const time = first + n * step;
    if (time > endTime) break;
    const index = timeToIndex(times, length, time);
    const x = indexToX(index);
    if (x < plotLeft + 4 || x > plotRight - 4) continue;
    if (x - lastX < 64) continue;
    ticks.push({ time, x, label: formatTimeLabel(time, step) });
    lastX = x;
  }
  return ticks;
}

export function chooseTimeStep(barSpacing: number, intervalMs: number): number {
  const interval = intervalMs > 0 ? intervalMs : 60_000;
  let step = TIME_STEPS[TIME_STEPS.length - 1]!;
  for (const candidate of TIME_STEPS) {
    if ((candidate / interval) * barSpacing >= 88) {
      step = candidate;
      break;
    }
  }
  while ((step / interval) * barSpacing < 88 && step < 1e15) step *= 2;
  return step;
}
