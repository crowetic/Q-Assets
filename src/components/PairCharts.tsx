// src/components/PairCharts.tsx
import { memo } from 'react';
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
} from 'recharts';
import type { LinePoint, OhlcPoint, DepthPoint } from '../utils/chartTransforms';

function tsFormatter(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const PriceSparkline = memo(function PriceSparkline({ data }: { data: LinePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopOpacity={0.35} />
            <stop offset="100%" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="t" tickFormatter={tsFormatter} />
        <YAxis width={60} />
        <Tooltip labelFormatter={(l) => tsFormatter(Number(l))} />
        <Area type="monotone" dataKey="y" strokeWidth={2} fill="url(#priceFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const VolumeBars = memo(function VolumeBars({ data }: { data: OhlcPoint[] }) {
  const rows = data.map((d) => ({ t: d.t, v: d.v }));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={rows}>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="t" tickFormatter={tsFormatter} />
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
  const domain = [
    ...bids.map((b) => ({ price: b.price, qty: b.cum })),
    ...asks.map((a) => ({ price: a.price, qty: a.cum })),
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis type="number" dataKey="price" domain={['dataMin', 'dataMax']} />
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
