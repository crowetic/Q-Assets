import { Service } from 'qapp-core';

export type ParsedQortal = {
  service: Service;
  name: string;
  identifier?: string;
  path?: string;
  raw: string;
} | null;

export function parseQortalHref(raw: string): ParsedQortal {
  const href = (raw || '').trim();
  if (!/^qortal:\/\//i.test(href)) return null;

  const parts = href.slice('qortal://'.length).split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const service = parts[0].toUpperCase() as Service;
  const name = parts[1];

  if (service === 'APP' || service === 'WEBSITE') {
    const path = parts.slice(2).join('/') || undefined; // rest is path
    return { service, name, path, raw: href };
  }

  const identifier = parts[2] || '';
  if (!identifier) return null; // non-APP/WEBSITE require identifier
  return { service, name, identifier, raw: href };
}

export function arbitraryToRenderUrl(baseArbitrary: string, path?: string): string {
  let render = baseArbitrary.replace(/^\/arbitrary\//, '/render/');
  if (path) {
    const segs = path.split('/').map((seg) => encodeURIComponent(seg).replace(/#/g, '%23'));
    render += '/' + segs.join('/');
  }
  return render;
}
