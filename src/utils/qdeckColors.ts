// export function colorKey(id: string) {
//   return (id ?? '').trim().toLowerCase();
// }

export function hueFromId(id: string): number {
  const k = (id ?? '').trim().toLowerCase();

  // FNV-1a hash
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  // Convert hash to [0,1]
  const frac = (h >>> 0) / 0xffffffff;

  // Allowed hue range: skip 0–40° (reds) & maybe 340–360° (pinks)
  // We'll use 40°–300° as "cool" zone
  const minHue = 40;
  const maxHue = 300;
  return minHue + frac * (maxHue - minHue);
}

export function bgFromId(id: string, mode: 'light' | 'dark') {
  const h = hueFromId(id);
  const s = 55; // fixed saturation
  const l = mode === 'dark' ? 16 : 92;
  return `hsl(${h} ${s}% ${l}%)`;
}

// --- stable hash (FNV-1a) ---
function hash32(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Map a 0..1 value into union of allowed hue ranges
function hueFromFrac(frac: number): number {
  // Cool-only bands: green, teal/blue, indigo/violet (no reds/oranges/yellows)
  const ranges: Array<[number, number]> = [
    [100, 160], // green → teal
    [180, 260], // cyan → blue
    [260, 320], // indigo → violet
  ];
  const total = ranges.reduce((acc, [a, b]) => acc + (b - a), 0);
  let t = frac * total;

  for (const [a, b] of ranges) {
    const len = b - a;
    if (t <= len) return a + t;
    t -= len;
  }
  // Fallback
  return ranges[ranges.length - 1][1];
}

/**
 * Pastel + muted HSL derived from an id.
 * - Avoids warm hues
 * - Muted pastels in both modes
 * - Adds a tiny variance for saturation/lightness so boards don’t look identical
 */
export function pastelBgFromId(id: string, mode: 'light' | 'dark'): string {
  const k = (id ?? '').trim().toLowerCase();
  const h32 = hash32(k);
  const frac = h32 / 0xffffffff;

  const hue = hueFromFrac(frac);

  // tiny, deterministic wiggle so not every card in a hue band looks the same
  const wiggle = ((h32 >>> 8) & 0xff) / 255; // 0..1

  if (mode === 'dark') {
    // Dark mode: muted tint on a dark surface
    const s = 22 + wiggle * 8; // 22–30%
    const l = 12 + wiggle * 6; // 12–18%
    return `hsl(${hue} ${s}% ${l}%)`;
  } else {
    // Light mode: very soft pastel
    const s = 28 + wiggle * 10; // 28–38%
    const l = 90 + wiggle * 4; // 90–94%
    return `hsl(${hue} ${s}% ${l}%)`;
  }
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hPrime = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hPrime >= 0 && hPrime < 1) {
    r = c;
    g = x;
  } else if (hPrime >= 1 && hPrime < 2) {
    r = x;
    g = c;
  } else if (hPrime >= 2 && hPrime < 3) {
    g = c;
    b = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    g = x;
    b = c;
  } else if (hPrime >= 4 && hPrime < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = light - c / 2;
  const toHex = (v: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round((v + m) * 255)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function pastelHexFromId(id: string): string {
  const k = (id ?? '').trim().toLowerCase();
  const h32 = hash32(k);
  const frac = h32 / 0xffffffff;
  const hue = hueFromFrac(frac);
  const wiggle = ((h32 >>> 8) & 0xff) / 255;
  const s = 28 + wiggle * 10;
  const l = 90 + wiggle * 4;
  return hslToHex(hue, s, l);
}

// Optional: slightly stronger border/hover derived from the same id
export function pastelBorderFromId(id: string, mode: 'light' | 'dark'): string {
  const bg = pastelBgFromId(id, mode);
  // Nudge the lightness for a subtle border contrast
  return bg.replace(
    /(\d+(\.\d+)?)%\)$/,
    (_, l) => `${Math.max(0, Math.min(100, Number(l) - (mode === 'dark' ? 4 : 6)))}%)`
  );
}

export function pastelHoverFromId(id: string, mode: 'light' | 'dark'): string {
  const bg = pastelBgFromId(id, mode);
  return bg.replace(
    /(\d+(\.\d+)?)%\)$/,
    (_, l) => `${Math.max(0, Math.min(100, Number(l) + (mode === 'dark' ? 3 : -3)))}%)`
  );
}
