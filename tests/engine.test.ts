/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DataStore } from '../src/core/data-store';
import { clipLine, distToSegment } from '../src/core/geometry';
import { IndicatorEngine } from '../src/core/indicators';
import { lowerBound } from '../src/core/search';
import { nicePriceStep } from '../src/core/ticks';
import { indexToTime, normalizeTimeMs, timeToIndex } from '../src/core/time';
import { anchorZoom, Viewport } from '../src/core/viewport';
import { LAYER_ALL, LAYER_BG, LAYER_DRAW, LAYER_OVERLAY, LAYER_SERIES, resolveDirty } from '../src/render/layers';

test('lowerBound finds the first value at or after the target', () => {
  const values = [10, 20, 30, 40];
  assert.equal(lowerBound(values, values.length, 20), 1);
  assert.equal(lowerBound(values, values.length, 25), 2);
  assert.equal(lowerBound(values, values.length, 5), 0);
  assert.equal(lowerBound(values, values.length, 50), 4);
});

test('timestamps below 1e11 are seconds', () => {
  assert.equal(normalizeTimeMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeTimeMs(1_700_000_000_000), 1_700_000_000_000);
});

test('setData sorts, dedupes, and keeps the later duplicate', () => {
  const store = new DataStore();
  store.setData([
    { time: 300, open: 1, high: 1, low: 1, close: 1 },
    { time: 100, open: 2, high: 4, low: 1, close: 3, volume: 5 },
    { time: 100, open: 3, high: 3, low: 3, close: 3, volume: 9 },
    { time: 200, open: 1, high: 1, low: 2, close: 1 },
  ]);
  assert.equal(store.length, 3);
  assert.equal(store.time[0], 100_000);
  assert.equal(store.close[0], 3);
  assert.equal(store.volume[0], 9);
  assert.equal(store.low[2], 1);
  assert.ok(store.high[2]! >= store.low[2]!);
});

test('appendTick updates the open bar and rolls a new bucket', () => {
  const store = new DataStore();
  const start = 1_700_000_000_000;
  store.setData([{ time: start, open: 10, high: 11, low: 9, close: 10, volume: 1 }]);
  const updated = store.appendTick(12, start + 10_000, 2, 60_000);
  assert.equal(updated.kind, 'update');
  assert.equal(store.length, 1);
  assert.equal(store.close[0], 12);
  assert.equal(store.high[0], 12);
  assert.equal(store.low[0], 9);
  assert.equal(store.volume[0], 3);
  const appended = store.appendTick(8, start + 60_000, 4, 60_000);
  assert.equal(appended.kind, 'append');
  assert.equal(store.length, 2);
  assert.equal(store.open[1], 8);
  assert.equal(store.time[1], start + 60_000);
});

test('updateBar replaces a matching time and appends a newer one', () => {
  const store = new DataStore();
  store.setData([{ time: 1_700_000_000, open: 1, high: 2, low: 1, close: 1 }]);
  store.updateBar({ time: 1_700_000_000, open: 1, high: 5, low: 1, close: 4 });
  assert.equal(store.length, 1);
  assert.equal(store.close[0], 4);
  store.updateBar({ time: 1_700_000_060, open: 4, high: 6, low: 4, close: 5 });
  assert.equal(store.length, 2);
  assert.equal(store.time[1], 1_700_000_060_000);
});

test('block extrema match a direct scan, including partial blocks', () => {
  const store = new DataStore();
  const bars = [];
  for (let i = 0; i < 1000; i++) {
    const close = 100 + Math.sin(i / 7) * 10;
    bars.push({
      time: 1_700_000_000 + i * 60,
      open: close - 0.2,
      high: close + (i % 17),
      low: close - (i % 13),
      close,
      volume: (i * 3) % 50,
    });
  }
  store.setData(bars);
  for (const [from, to] of [
    [0, 255],
    [256, 511],
    [200, 300],
    [0, 999],
  ] as const) {
    const ext = store.extrema(from, to);
    let min = Infinity;
    let max = -Infinity;
    let volume = 0;
    for (let i = from; i <= to; i++) {
      max = Math.max(max, store.high[i]!);
      min = Math.min(min, store.low[i]!);
      volume = Math.max(volume, store.volume[i]!);
    }
    assert.equal(ext.min, min);
    assert.equal(ext.max, max);
    assert.equal(ext.maxVolume, volume);
  }
});

test('time and index convert in both directions', () => {
  const times = [0, 60_000, 120_000, 180_000];
  assert.equal(timeToIndex(times, times.length, 90_000), 1.5);
  assert.equal(indexToTime(times, times.length, 1.5), 90_000);
  assert.equal(timeToIndex(times, times.length, 60_000), 1);
});

test('zoom keeps the bar under the cursor fixed', () => {
  const viewport = new Viewport();
  viewport.plotLeft = 0;
  viewport.plotWidth = 100;
  viewport.barSpacing = 10;
  viewport.minBarSpacing = 1;
  viewport.maxBarSpacing = 40;
  viewport.rightIndex = 20;
  assert.equal(viewport.indexToX(20), 100);
  assert.equal(viewport.xToIndex(50), 15);
  anchorZoom(viewport, 50, 2);
  assert.ok(Math.abs(viewport.xToIndex(50) - 15) < 1e-9);
  assert.equal(viewport.barSpacing, 20);
});

test('price maps linearly inside the candle pane', () => {
  const viewport = new Viewport();
  viewport.plotTop = 0;
  viewport.candleBottom = 50;
  viewport.priceMin = 0;
  viewport.priceMax = 100;
  assert.equal(viewport.priceToY(100), 0);
  assert.equal(viewport.priceToY(0), 50);
  assert.equal(viewport.yToPrice(25), 50);
});

test('SMA, EMA, and Bollinger follow the window formulas', () => {
  const engine = new IndicatorEngine();
  const closes = Float64Array.from([1, 2, 3, 4, 5, 6]);
  engine.add({ kind: 'sma', period: 3 });
  engine.add({ kind: 'ema', period: 3 });
  engine.add({ kind: 'bollinger', period: 3, mult: 2 });
  engine.recompute(closes, closes.length);
  const [sma, ema, bb] = engine.list();
  assert.ok(Number.isNaN(sma!.mid[1]));
  assert.equal(sma!.mid[2], 2);
  assert.equal(sma!.mid[5], 5);
  const k = 2 / 4;
  const seed = (1 + 2 + 3) / 3;
  const ema3 = 4 * k + seed * (1 - k);
  assert.equal(ema!.mid[2], seed);
  assert.ok(Math.abs(ema!.mid[3]! - ema3) < 1e-12);
  const mean = 2;
  const variance = ((1 - mean) ** 2 + (2 - mean) ** 2 + (3 - mean) ** 2) / 3;
  assert.ok(Math.abs(bb!.upper[2]! - (mean + 2 * Math.sqrt(variance))) < 1e-12);
  closes[5] = 9;
  engine.patchLast(closes, closes.length);
  assert.equal(sma!.mid[4], 4);
  assert.equal(sma!.mid[5], 6);
});

test('RSI stays on its own scale and does not stretch the price range', () => {
  const engine = new IndicatorEngine();
  const closes = Float64Array.from([1, 2, 3, 4, 5, 6]);
  engine.add({ kind: 'sma', period: 3 });
  engine.add({ kind: 'rsi', period: 3 });
  engine.recompute(closes, closes.length);
  const rsi = engine.list()[1]!;
  assert.equal(rsi.label, 'RSI (3)');
  assert.ok(Number.isNaN(rsi.mid[2]));
  assert.equal(rsi.mid[3], 100);
  const span = engine.range(0, closes.length - 1);
  assert.ok(span != null && span.max < 20);
});

test('a script plots on price, and an oscillator pane stays off that scale', () => {
  const engine = new IndicatorEngine();
  const closes = Float64Array.from([1, 2, 3, 4]);
  const flat = Float64Array.from([1, 1, 1, 1]);
  const source = { open: flat, high: closes, low: flat, close: closes, volume: flat };
  engine.add({
    kind: 'script',
    period: 1,
    label: 'Double',
    compute: (bars) => Array.from({ length: bars.length }, (_, i) => Number(bars.close[i]) * 2),
  });
  engine.add({
    kind: 'script',
    period: 1,
    label: 'Spread',
    pane: 'oscillator',
    compute: (bars) => Array.from({ length: bars.length }, (_, i) => Number(bars.high[i]) - Number(bars.low[i])),
  });
  engine.add({
    kind: 'script',
    period: 1,
    label: 'Broken',
    compute: () => {
      throw new Error('bad script');
    },
  });
  engine.recompute(closes, closes.length, source);
  const [price, osc, broken] = engine.list();
  assert.equal(price!.label, 'Double');
  assert.equal(price!.mid[3], 8);
  assert.equal(osc!.mid[3], 3);
  assert.ok(Number.isNaN(broken!.mid[3]));
  const span = engine.range(0, 3);
  assert.equal(span!.min, 2);
  assert.equal(span!.max, 8);
  const pane = engine.oscillatorRange(0, 3);
  assert.equal(pane!.min, 0);
  assert.equal(pane!.max, 3);
  closes[3] = 5;
  engine.patchLast(closes, closes.length, source);
  assert.equal(price!.mid[3], 10);
  assert.equal(osc!.mid[3], 4);
});

test('nice price steps land on 1, 2, or 5', () => {
  assert.equal(nicePriceStep(0, 100, 5), 20);
  assert.equal(nicePriceStep(0, 1, 4), 0.2);
});

test('a live tick skips grid and drawings when the view is unchanged', () => {
  const visible = resolveDirty(LAYER_ALL, true, 10, false, false, 0, 20);
  assert.equal(visible & LAYER_BG, 0);
  assert.equal(visible & LAYER_DRAW, 0);
  assert.notEqual(visible & LAYER_SERIES, 0);
  assert.notEqual(visible & LAYER_OVERLAY, 0);

  const offscreen = resolveDirty(LAYER_ALL, true, 80, false, false, 0, 20);
  assert.equal(offscreen & LAYER_SERIES, 0);
  assert.notEqual(offscreen & LAYER_OVERLAY, 0);

  assert.equal(resolveDirty(LAYER_ALL, true, 10, true, false, 0, 20), LAYER_ALL);
  assert.equal(resolveDirty(LAYER_ALL, false, -1, false, false, 0, 20), LAYER_ALL);
});

test('line clip and segment distance', () => {
  const clipped = clipLine(-10, 10, 10, 10, { left: 0, top: 0, right: 100, bottom: 100 });
  assert.deepEqual(clipped, [0, 10, 10, 10]);
  assert.equal(clipLine(-10, -10, -1, -1, { left: 0, top: 0, right: 10, bottom: 10 }), null);
  assert.equal(distToSegment(5, 5, 0, 5, 10, 5), 0);
  assert.equal(distToSegment(5, 8, 0, 5, 10, 5), 3);
});

test('binary search stays cheap at 100,000 bars', () => {
  const length = 100_000;
  const times = new Float64Array(length);
  for (let i = 0; i < length; i++) times[i] = i * 60_000;
  const started = performance.now();
  let sink = 0;
  for (let i = 0; i < 2_000; i++) sink += lowerBound(times, length, (i * 97) % length * 60_000);
  const elapsed = performance.now() - started;
  assert.ok(sink > 0);
  assert.ok(elapsed < 250, `lowerBound batch took ${elapsed.toFixed(1)}ms`);
});
