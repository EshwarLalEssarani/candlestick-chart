/** Eshwar Lal — https://github.com/EshwarLalEssarani */
/** Unix time in seconds or milliseconds. Values below 1e11 are read as seconds. */
export interface BarData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** A single trade print. `time` defaults to now and is bucketed into the current bar. */
export interface Tick {
  price: number;
  time?: number;
  volume?: number;
}

export interface Anchor {
  /** Milliseconds since the Unix epoch. */
  time: number;
  price: number;
}

export type SeriesStyle = 'candlestick' | 'baseline';
export type OverlayKind = 'sma' | 'ema' | 'bollinger' | 'rsi' | 'script';
/** Price shares the candle scale. An oscillator gets its own pane. */
export type OverlayPane = 'price' | 'oscillator';

/** Columns passed to a custom indicator. Each array has `length` bars. */
export interface IndicatorBars {
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  volume: ArrayLike<number>;
  length: number;
}

/** Return one value per bar. A bare number is drawn as a flat line. Non-finite values leave a gap. */
export type IndicatorCompute = (bars: IndicatorBars) => ArrayLike<number> | number;
export type DrawingTool =
  | 'trendline'
  | 'ray'
  | 'extended-line'
  | 'horizontal-line'
  | 'horizontal-ray'
  | 'vertical-line'
  | 'cross-line'
  | 'parallel-channel'
  | 'fibonacci'
  | 'fib-extension'
  | 'pitchfork'
  | 'rectangle'
  | 'ellipse'
  | 'triangle'
  | 'arrow'
  | 'brush'
  | 'measure'
  | 'long-position'
  | 'short-position'
  | 'text'
  | 'price-label'
  | 'note';
export type Tool = 'cursor' | 'crosshair' | DrawingTool;
export type ThemeName = 'dark' | 'light';

export interface OverlaySpec {
  kind: OverlayKind;
  /** Lookback for built-in studies. Ignored by `script`. */
  period: number;
  /** Bollinger standard-deviation multiple. Defaults to 2. */
  mult?: number;
  color?: string;
  lineWidth?: number;
  /** Bollinger band fill. */
  fill?: string;
  /** Legend name. Built-ins use their own name when this is omitted. */
  label?: string;
  /** Where a `script` indicator is drawn. Defaults to the price pane. */
  pane?: OverlayPane;
  /** Required for `kind: 'script'`. Called again whenever the series changes. */
  compute?: IndicatorCompute;
}

export interface OverlayValue {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface Drawing {
  id: string;
  type: DrawingTool;
  anchors: Anchor[];
  /** Label for text and note tools. */
  text?: string;
}

export interface DrawingInput {
  type: DrawingTool;
  anchors: Anchor[];
  text?: string;
}

export interface LogicalRange {
  /** Fractional bar index at the left edge of the plot. */
  from: number;
  /** Fractional bar index at the right edge of the plot. */
  to: number;
}

export interface VisibleTimeRange {
  /** Milliseconds. */
  from: number;
  /** Milliseconds. */
  to: number;
}

export interface CrosshairMoveParam {
  /** Plot-space CSS pixel, or null when the pointer has left the chart. */
  point: { x: number; y: number } | null;
  /** Milliseconds. */
  time: number | null;
  price: number | null;
  index: number | null;
  bar: BarData | null;
}

export interface ChartStats {
  barCount: number;
  visibleBars: number;
  lastRenderMs: number;
  barSpacing: number;
  /** True when new bars keep the latest candle pinned to the right edge. */
  following: boolean;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  theme?: ThemeName;
  /** Bar size in seconds used to bucket `appendTick`. Inferred from the series when omitted. */
  interval?: number;
  watermark?: string;
  /** Symbol line drawn in the plot, such as BTC/USDT · 1h · Binance. */
  header?: {
    symbol?: string;
    interval?: string;
    exchange?: string;
  };
  layout?: {
    background?: string;
    textColor?: string;
    fontFamily?: string;
    fontSize?: number;
    borderColor?: string;
    watermarkColor?: string;
  };
  grid?: {
    visible?: boolean;
    color?: string;
  };
  candle?: {
    upColor?: string;
    downColor?: string;
    wickUpColor?: string;
    wickDownColor?: string;
  };
  volume?: {
    visible?: boolean;
    upColor?: string;
    downColor?: string;
    /** Fraction of the plot reserved under the candles. */
    ratio?: number;
  };
  series?: {
    style?: SeriesStyle;
    /** Price that splits the baseline fill. The first close is used when omitted. */
    baselineValue?: number;
    topFill?: string;
    bottomFill?: string;
    topLine?: string;
    bottomLine?: string;
  };
  crosshair?: {
    visible?: boolean;
    color?: string;
    labelBackground?: string;
    labelText?: string;
  };
  timeScale?: {
    barSpacing?: number;
    minBarSpacing?: number;
    maxBarSpacing?: number;
    /** Empty bars kept to the right of the latest candle while following. */
    rightOffset?: number;
  };
  priceScale?: {
    autoScale?: boolean;
    /** Fraction of the visible price span added above and below the data. */
    padding?: number;
  };
  drawings?: {
    color?: string;
    selectedColor?: string;
  };
}

export interface ResolvedLayout {
  background: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  borderColor: string;
  watermarkColor: string;
}

export interface ResolvedHeader {
  symbol: string;
  interval: string;
  exchange: string;
}

export interface ResolvedOptions {
  width: number | null;
  height: number | null;
  interval: number | null;
  watermark: string;
  header: ResolvedHeader;
  layout: ResolvedLayout;
  grid: { visible: boolean; color: string };
  candle: {
    upColor: string;
    downColor: string;
    wickUpColor: string;
    wickDownColor: string;
  };
  volume: { visible: boolean; upColor: string; downColor: string; ratio: number };
  series: {
    style: SeriesStyle;
    baselineValue: number | null;
    topFill: string;
    bottomFill: string;
    topLine: string;
    bottomLine: string;
  };
  crosshair: {
    visible: boolean;
    color: string;
    labelBackground: string;
    labelText: string;
  };
  timeScale: {
    barSpacing: number;
    minBarSpacing: number;
    maxBarSpacing: number;
    rightOffset: number;
  };
  priceScale: { autoScale: boolean; padding: number };
  drawings: { color: string; selectedColor: string };
}

export interface SetDataOptions {
  /** When true (default), the view jumps to the latest bars at the default spacing. */
  resetView?: boolean;
}
