import React, { useEffect, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  ColorType,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useTheme } from '@mui/material/styles';

export type OhlcPoint = { t: number; o: number; h: number; l: number; c: number; v?: number };

type Props = { data: OhlcPoint[]; height?: number; className?: string };

const toUtcSec = (t: number): UTCTimestamp =>
  (t >= 1e12 ? Math.floor(t / 1000) : Math.floor(t)) as UTCTimestamp;

const CandleChart: React.FC<Props> = ({ data, height = 280, className }) => {
  const theme = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || chartRef.current) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.palette.text.secondary, // ✅ text from theme
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      grid: {
        vertLines: { color: theme.palette.text.secondary, visible: true, style: 1 },
        horzLines: { color: theme.palette.text.secondary, visible: true, style: 1 },
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: theme.palette.success.main, // ✅ green
      downColor: theme.palette.error.main, // ✅ red
      wickUpColor: theme.palette.success.main,
      wickDownColor: theme.palette.error.main,
      borderUpColor: theme.palette.success.main,
      borderDownColor: theme.palette.error.main,
      priceFormat: { type: 'price', precision: 8, minMove: 1e-8 },
    });

    chartRef.current = chart;
    seriesRef.current = candle;

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
      roRef.current = null;
    };
  }, [height, theme]); // ✅ re-run if theme changes (dark/light mode)

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (!data || data.length === 0) {
      series.setData([]);
      return;
    }

    const asc = [...data].sort((a, b) => a.t - b.t);
    const lwc = asc
      .filter((d) => [d.o, d.h, d.l, d.c].every(Number.isFinite))
      .map((d) => ({ time: toUtcSec(d.t), open: d.o, high: d.h, low: d.l, close: d.c }));

    series.setData(lwc);
  }, [data]);

  return <div ref={hostRef} className={className} style={{ width: '100%', height }} />;
};

export default CandleChart;
