export async function fetchCurrentBlockHeight(): Promise<number> {
  try {
    const height = await fetch(`/blocks/height`);
    if (typeof height === 'number' && Number.isFinite(height) && height > 0) return height;
  } catch {
    /* ignore and try fallback */
  }

  try {
    const res = await fetch('/admin/status', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.height === 'number' && data.height > 0) return data.height;
    }
  } catch {
    /* ignore */
  }

  throw new Error('Unable to determine current block height');
}
