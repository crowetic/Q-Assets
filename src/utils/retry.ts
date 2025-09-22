// src/utils/retry.ts
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; factor?: number } = {}
): Promise<T> {
  const tries = opts.tries ?? 5;
  const base = opts.baseMs ?? 400;
  const factor = opts.factor ?? 1.8;

  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === tries - 1) break;
      const delay = Math.round(base * Math.pow(factor, i));
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
