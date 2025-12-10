import { memo, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Brush,
} from 'recharts';
import type { OhlcPoint } from './CandleChart';
import type { DepthPoint } from '../../utils/chartTransforms';

function tsFormatter(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type SparkPoint = { x: number; y: number };

export function PriceSparkline({
  data,
  yDomain,
  smaPeriod = 20,
}: {
  data: SparkPoint[];
  yDomain?: [number, number];
  smaPeriod?: number;
}) {
  const sorted = useMemo(() => (data ? [...data].sort((a, b) => a.x - b.x) : []), [data]);

  const paddedDomain = useMemo<[number, number] | undefined>(() => {
    if (yDomain) return yDomain;
    if (!sorted.length) return undefined;
    let min = Infinity,
      max = -Infinity;
    for (const p of sorted) {
      if (Number.isFinite(p.y)) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    if (min === max) {
      const pad = Math.abs(min) * 0.01 || 1e-8;
      return [min - pad, max + pad];
    }
    const pad = (max - min) * 0.04;
    return [min - pad, max + pad];
  }, [sorted, yDomain]);

  // simple SMA
  const sma = useMemo(() => {
    if (sorted.length < smaPeriod || smaPeriod < 2) return [];
    const out: SparkPoint[] = [];
    let acc = 0;
    for (let i = 0; i < sorted.length; i++) {
      acc += sorted[i].y;
      if (i >= smaPeriod) acc -= sorted[i - smaPeriod].y;
      if (i >= smaPeriod - 1) out.push({ x: sorted[i].x, y: acc / smaPeriod });
    }
    return out;
  }, [sorted, smaPeriod]);

  const xFmt = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!sorted.length)
    return (
      <div
        style={{
          height: 160,
          display: 'flex',
          alignItems: 'center',
          color: 'var(--mui-palette-text-secondary)',
        }}
      >
        No price data
      </div>
    );

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={sorted} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0.06} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeOpacity={0.1} />
        <XAxis
          dataKey="x"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={xFmt}
          allowDataOverflow
        />
        <YAxis domain={paddedDomain ?? ['auto', 'auto']} width={60} />

        {/* Force dark tooltip + visible text */}
        <Tooltip
          labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
          formatter={(v) => [Number(v as number).toFixed(8), 'QORT']}
        />

        <Area
          type="monotone"
          dataKey="y"
          stroke="currentColor"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          fill="url(#priceFill)"
        />

        {sma.length > 1 && (
          <Area
            type="monotone"
            data={sma}
            dataKey="y"
            dot={false}
            isAnimationActive={false}
            fillOpacity={0}
            stroke="currentColor"
            strokeOpacity={0.6}
            strokeWidth={1}
          />
        )}

        {/* Tone down the big white Brush bar on dark themes */}
        <Brush dataKey="x" height={22} tickFormatter={xFmt} travellerWidth={8} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export const VolumeBars = memo(function VolumeBars({ data }: { data: OhlcPoint[] }) {
  const rows = data.map((d) => ({ t: d.t, v: d.v }));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={rows}>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="t" hide />
        <YAxis width={60} />
        <Tooltip labelFormatter={(l) => tsFormatter(Number(l))} />
        <Bar dataKey="v" />
      </BarChart>
    </ResponsiveContainer>
  );
});

export const DepthChart = memo(function DepthChart({
  bids,
  asks,
}: {
  bids: DepthPoint[];
  asks: DepthPoint[];
}) {
  // Merge to a single array just for axes domain (Recharts quirk); we render two series.
  // const domain = [
  //   ...bids.map((b) => ({ price: b.price, qty: b.cum })),
  //   ...asks.map((a) => ({ price: a.price, qty: a.cum })),
  // ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis type="number" dataKey="price" domain={['dataMin', 'dataMax']} hide />
        <YAxis type="number" dataKey="cum" width={60} />
        <Tooltip />
        {/* Bids area */}
        <Area
          type="stepAfter"
          data={bids}
          dataKey="cum"
          xAxisId={0}
          yAxisId={0}
          name="Bids"
          dot={false}
          isAnimationActive={false}
        />
        {/* Asks area */}
        <Area
          type="stepAfter"
          data={asks}
          dataKey="cum"
          xAxisId={0}
          yAxisId={0}
          name="Asks"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});
