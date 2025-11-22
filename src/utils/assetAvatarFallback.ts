// Deterministic SVG data-URL avatar based on assetId + name
export function makeAssetFallbackAvatar(assetId: number, name: string, size = 80): string {
  // hash -> hue
  const key = `${assetId}:${name}`.toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;

  const initials = (name || String(assetId))
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

  const bg = `hsl(${hue}, 70%, 18%)`;
  const fg = `hsl(${(hue + 180) % 360}, 80%, 70%)`;
  const s = size;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}"/>
        <stop offset="100%" stop-color="hsl(${hue}, 70%, 10%)"/>
      </linearGradient>
    </defs>
    <rect rx="${Math.round(s * 0.15)}" ry="${Math.round(s * 0.15)}" width="${s}" height="${s}" fill="url(#g)"/>
    <text x="50%" y="54%" text-anchor="middle" font-family="system-ui, sans-serif"
          font-size="${Math.round(s * 0.42)}" fill="${fg}" font-weight="700"
          dominant-baseline="middle">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
