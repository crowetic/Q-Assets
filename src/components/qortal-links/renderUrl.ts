// src/components/qortal-links/renderUrl.ts

export function arbitraryToRenderUrl(baseArbitrary: string, path?: string): string {
  let render = baseArbitrary.replace(/^\/arbitrary\//, '/render/');
  if (path) {
    const segs = path.split('/').map(seg => encodeURIComponent(seg).replace(/#/g, '%23'));
    render += '/' + segs.join('/');
  }
  return render;
}

export function toAbsoluteHubUrl(hubOrigin: string, relativePath: string): string {
  const origin = hubOrigin.replace(/\/+$/, '');
  const rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${origin}${rel}`;
}
