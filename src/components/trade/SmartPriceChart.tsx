import React, { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  ColorType,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useTheme } from '@mui/material/styles';
import type { OhlcPoint } from './CandleChart';

type Props = {
  data: OhlcPoint[];
  height?: number;
  className?: string;
  /** Minimum number of bars to show candles; otherwise use line. */
  minCandles?: number; // default 15
  /** If price range is below this fraction (e.g. 0.001 = 0.1%), use line. */
  flatThresholdFrac?: number; // default 0.001
};

const toUtcSec = (t: number): UTCTimestamp =>
  (t >= 1e12 ? Math.floor(t / 1000) : Math.floor(t)) as UTCTimestamp;

function computeStats(data: OhlcPoint[]) {
  if (!data?.length)
    return { count: 0, min: Infinity, max: -Infinity, uniqueCloses: 0, flatFrac: 0 };
  let min = Infinity,
    max = -Infinity;
  const closes = new Set<number>();
  for (const d of data) {
    if (Number.isFinite(d.l) && d.l < min) min = d.l;
    if (Number.isFinite(d.h) && d.h > max) max = d.h;
    if (Number.isFinite(d.c)) closes.add(d.c);
  }
  const span = max - min;
  const flatFrac = !Number.isFinite(min) || !Number.isFinite(max) || max === 0 ? 0 : span / max;
  return { count: data.length, min, max, uniqueCloses: closes.size, flatFrac };
}

function asLineUniqueSeconds(asc: OhlcPoint[]): LineData<UTCTimestamp>[] {
  const bySec = new Map<number, LineData<UTCTimestamp>>();
  for (const d of asc) {
    if (!Number.isFinite(d.c)) continue;
    const sec = toUtcSec(d.t) as number;
    bySec.set(sec, { time: sec as UTCTimestamp, value: d.c! }); // last wins
  }
  return Array.from(bySec.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

// For candles: build OHLC per second (last close wins)
function asCandleUniqueSeconds(asc: OhlcPoint[]): CandlestickData<UTCTimestamp>[] {
  const bySec = new Map<number, CandlestickData<UTCTimestamp>>();
  for (const d of asc) {
    if (![d.o, d.h, d.l, d.c].every(Number.isFinite)) continue;
    const sec = toUtcSec(d.t) as number;
    const ex = bySec.get(sec);
    if (!ex) {
      bySec.set(sec, {
        time: sec as UTCTimestamp,
        open: d.o!,
        high: d.h!,
        low: d.l!,
        close: d.c!,
      });
    } else {
      ex.high = Math.max(ex.high, d.h!);
      ex.low = Math.min(ex.low, d.l!);
      ex.close = d.c!; // last close in that second
    }
  }
  return Array.from(bySec.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

const SmartPriceChart: React.FC<Props> = ({
  data,
  height = 280,
  className,
  minCandles = 15,
  flatThresholdFrac = 0.001,
}) => {
  const theme = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick' | 'Line'> | null>(null);
  const seriesKindRef = useRef<'candle' | 'line' | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Decide series type up front based on stats
  const mode: 'none' | 'line' | 'candle' = useMemo(() => {
    const stats = computeStats(data ?? []);
    if (stats.count === 0) return 'none';
    if (stats.count < minCandles) return 'line';
    if (stats.uniqueCloses <= 1) return 'line';
    if (stats.flatFrac <= flatThresholdFrac) return 'line';
    return 'candle';
  }, [data, minCandles, flatThresholdFrac]);

  // mount & (re)build chart when theme changes
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    // destroy existing chart on theme swap
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesKindRef.current = null;
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
    }

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.palette.text.secondary,
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      grid: {
        vertLines: { color: theme.palette.text.secondary, visible: true, style: 1 },
        horzLines: { color: theme.palette.text.secondary, visible: true, style: 1 },
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    // Choose series type (line/candle) based on mode
    let series: ISeriesApi<'Candlestick' | 'Line'>;
    if (mode === 'line') {
      series = chart.addSeries(LineSeries, {
        color: theme.palette.text.secondary, // neutral line for sparse/flat markets
        lineWidth: 2,
        priceLineVisible: true,
      });
      seriesKindRef.current = 'line';
    } else {
      series = chart.addSeries(CandlestickSeries, {
        upColor: theme.palette.success.main,
        downColor: theme.palette.error.main,
        wickUpColor: theme.palette.success.main,
        wickDownColor: theme.palette.error.main,
        borderUpColor: theme.palette.success.main,
        borderDownColor: theme.palette.error.main,
        priceFormat: { type: 'price', precision: 8, minMove: 1e-8 },
      });
      seriesKindRef.current = 'candle';
    }

    chartRef.current = chart;
    seriesRef.current = series;

    const applySize = () => {
      chart.applyOptions({ width: el.clientWidth || 0, height });
      chart.timeScale().fitContent();
    };
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(el);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesKindRef.current = null;
      roRef.current = null;
    };
    // re-create when theme or initial mode changes
  }, [height, theme, mode]);

  // push data
  useEffect(() => {
    const series = seriesRef.current;
    const kind = seriesKindRef.current;
    if (!series) return;

    if (!data || data.length === 0) {
      if (kind === 'line') (series as ISeriesApi<'Line'>).setData([]);
      else if (kind === 'candle') (series as ISeriesApi<'Candlestick'>).setData([]);
      return;
    }

    // Always sort ASC by your native timestamp first
    const asc = [...data].sort((a, b) => a.t - b.t);

    if (kind === 'line') {
      const line = asLineUniqueSeconds(asc);
      (series as ISeriesApi<'Line'>).setData(line);
    } else {
      const candles = asCandleUniqueSeconds(asc);
      (series as ISeriesApi<'Candlestick'>).setData(candles);
    }

    // Optional: refit after data change
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Optional overlay: show a subtle “No data” message when mode === 'none'
  if (mode === 'none') {
    return (
      <div
        className={className}
        style={{
          width: '100%',
          height,
          display: 'grid',
          placeItems: 'center',
          color: theme.palette.text.secondary,
          opacity: 0.6,
          borderRadius: 8,
          border: `1px dashed ${theme.palette.text.secondary}40`,
        }}
      >
        No market data for selected range
      </div>
    );
  }

  return <div ref={hostRef} className={className} style={{ width: '100%', height }} />;
};

export default SmartPriceChart;
