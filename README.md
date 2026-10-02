# Candlestick Chart

By [Eshwar Lal](https://github.com/EshwarLalEssarani).

That credit lives in this README and in the source. The chart leaves its on-canvas watermark empty unless an app sets one.

Zero-dependency candlestick chart for static pages and JavaScript apps. The renderer is vanilla TypeScript on stacked HTML canvases: grid, series, drawings, and crosshair each have their own layer. Series pixels are painted into an `OffscreenCanvas` (or a detached canvas when that API is missing) and blitted to the screen.

Pan and zoom stay on the visible window. A binary search finds the first bar in view, and when several bars share a pixel they collapse into one column. Price range queries use 256-bar blocks, so a tick does not walk the whole series. If that tick does not move the scale, the grid and drawings are not repainted.

## Build

```bash
npm install
npm test
npm run demo
```

The demo is at [http://localhost:4173/demo/](http://localhost:4173/demo/). `npm test` typechecks, builds `dist/`, and runs the engine tests.

| File | Format |
| --- | --- |
| `dist/index.mjs` | ESM |
| `dist/index.cjs` | CommonJS |
| `dist/index.d.ts` | TypeScript |
| `dist/candlestick-chart.min.js` | IIFE, global `CandlestickChart` |

## Script tag

```html
<div id="chart" style="height: 480px"></div>
<script src="./dist/candlestick-chart.min.js"></script>
<script>
  const chart = CandlestickChart.create('#chart');
  chart.setData([
    { time: 1710000000, open: 100, high: 110, low: 95, close: 105, volume: 1200 },
  ]);
</script>
```

`time` may be Unix seconds or milliseconds. Values below `1e11` are read as seconds. Callbacks return milliseconds.

## ESM

```ts
import { create } from 'candlestick-chart';

const chart = create(document.querySelector('#chart')!, {
  theme: 'dark',
  interval: 60,
});
chart.setData(bars);
chart.addOverlay({ kind: 'sma', period: 20 });
chart.addOverlay({ kind: 'ema', period: 21 });
chart.addOverlay({ kind: 'bollinger', period: 20, mult: 2 });
```

## React, Vue, Svelte, Next.js

The package does not import a UI framework. Own the `Chart` instance in the component lifecycle and call `destroy()` on unmount.

```tsx
function CandleView({ bars }: { bars: BarData[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const chart = create(ref.current!);
    chartRef.current = chart;
    return () => chart.destroy();
  }, []);

  useEffect(() => {
    chartRef.current?.setData(bars);
  }, [bars]);

  return <div ref={ref} style={{ height: 480 }} />;
}
```

Vue: create in `onMounted`, destroy in `onBeforeUnmount`. Svelte: create in `onMount` and return the destroy function. Next.js: load the component with `next/dynamic` and `{ ssr: false }`, because the canvas needs `document`.

## Data

```ts
chart.setData(bars);                 // replaces the series and jumps to the latest bars
chart.setData(bars, { resetView: false });
chart.updateBar(bar);                // replace by timestamp, or insert in order
chart.appendTick(101.25);            // trade at Date.now(), bucketed by interval
chart.appendTick({ price: 101.25, time: 1710000060, volume: 12 });
```

`appendTick` updates the open bar when the trade falls in its bucket. A later bucket appends a bar. While the view is following the right edge, new bars stay pinned there. Panning away leaves the viewport where you put it.

## Interaction

- Drag pans. The wheel zooms around the cursor. Shift-wheel pans. Pinch zooms.
- Double-click, or `fitContent()`, fits every bar. `scrollToRealtime()` pins the latest bar.
- Arrow keys pan and zoom when the chart is focused. Delete removes the selected drawing.
- `setTool('trendline' | 'horizontal-ray' | 'fibonacci' | 'crosshair')`. Two clicks place a trendline or Fibonacci retracement. One click places a horizontal ray.

```ts
chart.subscribeCrosshairMove((param) => {
  param.bar;    // hovered OHLCV, or null
  param.price;  // cursor price
  param.time;   // milliseconds
});
```

## Coordinates

`timeToCoordinate`, `priceToCoordinate`, `coordinateToTime`, and `coordinateToPrice` convert between data and CSS pixels. `setVisibleRange(from, to)` and `getVisibleRange()` speak in milliseconds. `scrollBy(bars)` and `zoomBy(factor, anchorX)` move the camera. `getStats()` reports bar count, visible bars, and the last frame time. `takeScreenshot()` returns a composited canvas.
