// qortalEnv.ts
export function getHubOrigin(): string {
  // 1) allow override via env or global
  const explicit =
    (window as any)._qdnOrigin ||
    (import.meta as any).env?.VITE_QORTAL_ORIGIN ||
    (window as any)._qortalOrigin;
  if (explicit) return stripTrailingSlash(String(explicit));

  const p = window.location.pathname;
  if (p.startsWith('/render/') || p.startsWith('/arbitrary/')) {
    return window.location.origin;
  }
  // Try common Core/HUB addresses in priority order.
  const defaults = ['http://127.0.0.1:12391', 'http://localhost:12391'];
  return defaults[0]; // pick first; or implement a ping race if you want to be fancy
}

function stripTrailingSlash(u: string) {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

export async function waitForQortalRequest(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(window as any).qortalRequest) {
    await new Promise((r) => setTimeout(r, 50));
    if (Date.now() - start > timeoutMs) throw new Error('qortalRequest not ready');
  }
}

export function bootstrapQdnEnv() {
  const g = window as any;

  // Don’t override if the Hub already injected them.
  if (g._qdnContext) return;

  // Try to auto-detect “render” from the path if you’re proxying /render in dev
  // e.g. http://localhost:5173/render/APP/Q-Assets/info
  const m = location.pathname.match(/^\/render\/(APP|WEBSITE)\/([^/]+)(?:\/|$)/i);
  if (m) {
    const service = m[1].toUpperCase();
    const name = decodeURIComponent(m[2]);
    g._qdnContext = 'render';
    g._qdnBase = `/render/${service}/${encodeURIComponent(name)}`;

    const rest = location.pathname.slice(g._qdnBase.length) || '/';
    g._qdnPath = rest + location.search + location.hash;
    return;
  }

  // Otherwise: standalone/preview mode (plain dev server)
  g._qdnContext = (import.meta as any)?.env?.VITE_QDN_CONTEXT || 'preview';
  g._qdnBase = ''; // no basename in local app
  g._qdnPath = location.pathname + location.search + location.hash;
}
