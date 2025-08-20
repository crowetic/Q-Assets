// src/components/trade/CandleChart.tsx
import React, { useEffect, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  ColorType,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type WhitespaceData,
  type UTCTimestamp,
} from 'lightweight-charts';

// Your OhlcPoint: { t, o, h, l, c, v? } with t in ms or s
export type OhlcPoint = { t: number; o: number; h: number; l: number; c: number; v?: number };

type Props = {
  data: OhlcPoint[];
  height?: number;
  className?: string;
};

const toUtcSec = (t: number): UTCTimestamp =>
  (t >= 1e12 ? Math.floor(t / 1000) : Math.floor(t)) as UTCTimestamp; // ms -> s

const CandleChart: React.FC<Props> = ({ data, height = 280, className }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // mount
  useEffect(() => {
    const el = hostRef.current;
    if (!el || chartRef.current) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#cfd8dc',
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.08)' },
        horzLines: { color: 'rgba(255,255,255,0.08)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    // v5 API: addSeries with the primitive
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      priceFormat: { type: 'price', precision: 8, minMove: 1e-8 },
    });

    chartRef.current = chart;
    seriesRef.current = candle;

    // initial width + resize
    const applySize = () => {
      const w = el.clientWidth || 0;
      chart.applyOptions({ width: w, height });
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
      roRef.current = null;
    };
  }, [height]);

  // data updates
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    chart.timeScale().fitContent();

    // sort ascending (required by LWC)
    const asc = [...(data ?? [])].sort((a, b) => a.t - b.t);
    // Optional: if min==max, nudge the scale a hair to visualize:
    const min = Math.min(...asc.map((d) => d.l));
    const max = Math.max(...asc.map((d) => d.h));
    if (Number.isFinite(min) && min === max) {
      series.applyOptions({ priceFormat: { type: 'price', precision: 8, minMove: 1e-8 } });
      chart.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.2, bottom: 0.2 } } });
    }

    // Only use whitespace when OHLC are invalid/missing — NOT when volume is 0/undefined.
    const mixed: Array<CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = asc.map(
      (d) => {
        const time = toUtcSec(Number(d.t));
        const o = Number(d.o);
        const h = Number(d.h);
        const l = Number(d.l);
        const c = Number(d.c);

        const hasPrices =
          Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c);

        return hasPrices ? { time, open: o, high: h, low: l, close: c } : { time };
      }
    );

    series.setData(mixed);
    chart.timeScale().fitContent();
  }, [data]);

  return <div ref={hostRef} className={className} style={{ width: '100%', height }} />;
};

export default CandleChart;
