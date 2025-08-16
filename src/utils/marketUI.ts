export function colorFromAssetId(aid: number) {
  const hue = (aid * 57) % 360;
  return {
    accent: `hsl(${hue} 80% 50%)`,
    tint:   `hsl(${hue} 80% 20% / 0.12)`,
    tintHover: `hsl(${hue} 80% 20% / 0.20)`,
    border: `hsl(${hue} 80% 45% / 0.55)`,
  };
}

export const formatPrice = (p: number) =>
  Number.isFinite(p) ? p.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—';

export const formatQty = (q: number, divisible = true) =>
  Number.isFinite(q) ? q.toLocaleString(undefined, { maximumFractionDigits: divisible ? 8 : 0 }) : '—';
