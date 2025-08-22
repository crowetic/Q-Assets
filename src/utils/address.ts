// utils/address.ts
// Robust Qortal address utilities: format/validate, name resolution (cached),
// and a persistent last-known-good (LKG) address with TTL.

type FetchLike = typeof fetch;

// ---- Config -----------------------------------------------------------------

// Qortal addresses are Base58 w/out 0, O, I, l; typically 26-35 chars. Be generous.
const Q_ADDR_RX = /^Q[1-9A-HJ-NP-Za-km-z]{20,60}$/;

const LKG_KEY = 'qassets:lastKnownQortalAddress';
const LKG_TS  = 'qassets:lastKnownQortalAddress:ts';
const LKG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Name/addr cache TTLs
const RESOLVE_TTL_MS  = 10 * 60 * 1000;     // 10 minutes
const VALIDATE_TTL_MS = 30 * 60 * 1000;     // 30 minutes
const MAX_CACHE_ENTRIES = 500;

// -----------------------------------------------------------------------------

export function isQAddressFormat(s: string): boolean {
  return Q_ADDR_RX.test((s || '').trim());
}

// Tiny in-memory caches
const _resolveCache = new Map<string, { addr: string; ts: number }>();  // input -> addr
const _validateCache = new Map<string, { ok: boolean; ts: number }>();  // addr -> ok

function _now() { return Date.now(); }
function _prune<K, V>(m: Map<K, V>, max = MAX_CACHE_ENTRIES) {
  if (m.size <= max) return;
  // naive prune: drop first N
  const drop = m.size - max;
  let i = 0;
  for (const k of m.keys()) { m.delete(k); if (++i >= drop) break; }
}

// Validate an address on *this* node; falls back to format check on transient errors.
export async function validateQortalAddress(address: string, fetcher?: FetchLike): Promise<boolean> {
  const addr = (address || '').trim();
  if (!addr) return false;

  const hit = _validateCache.get(addr);
  if (hit && (_now() - hit.ts) < VALIDATE_TTL_MS) return hit.ok;

  let ok = false;
  try {
    const f = fetcher ?? fetch;
    // If your node exposes a JSON endpoint instead, swap this out.
    const res = await f(`/addresses/validate/${addr}`, { method: 'GET', headers: { accept: 'text/plain' }});
    if (res.ok) {
      const txt = (await res.text()).trim().toLowerCase();
      ok = (txt === 'true' || txt === '1' || txt === 'yes' || txt === 'ok' || txt === 'valid');
    } else {
      ok = isQAddressFormat(addr);
    }
  } catch {
    ok = isQAddressFormat(addr);
  }

  _validateCache.set(addr, { ok, ts: _now() });
  _prune(_validateCache);
  return ok;
}

// Resolve user input to a validated address (accepts address or Name; leading "@" OK).
export async function resolveRecipientStrict(input: string): Promise<string> {
  const raw = (input || '').trim();
  if (!raw) throw new Error('Empty recipient');

  const memo = _resolveCache.get(raw);
  if (memo && (_now() - memo.ts) < RESOLVE_TTL_MS) return memo.addr;

  // address path
  if (isQAddressFormat(raw)) {
    const ok = await validateQortalAddress(raw);
    if (!ok) throw new Error('Address is not valid on this node.');
    _resolveCache.set(raw, { addr: raw, ts: _now() });
    _prune(_resolveCache);
    return raw;
  }

  // name path
  const name = raw.replace(/^@+/, '');
  try {
    const data = await qortalRequest({ action: 'GET_NAME_DATA', name });
    const addr: unknown = data?.owner;
    if (typeof addr !== 'string') throw new Error(`Name not found: ${name}`);

    const ok = await validateQortalAddress(addr);
    if (!ok) throw new Error(`Resolved owner address for "${name}" is not valid on this node.`);

    const rec = { addr, ts: _now() };
    _resolveCache.set(raw, rec);
    _resolveCache.set(name, rec);
    _prune(_resolveCache);
    return addr;
  } catch (e: any) {
    throw new Error(typeof e?.message === 'string'
      ? e.message
      : `Unable to resolve "${name}" to an address`);
  }
}

// --- Last-known-good (LKG) address persistence -------------------------------

export function getLastKnownAddress(): string | null {
  try {
    const addr = localStorage.getItem(LKG_KEY);
    const tsStr = localStorage.getItem(LKG_TS);
    if (!addr || !isQAddressFormat(addr)) return null;
    const ts = tsStr ? Number(tsStr) : 0;
    if (!Number.isFinite(ts) || (_now() - ts) > LKG_TTL_MS) return null;
    return addr;
  } catch { return null; }
}

export function rememberAuthAddress(addr: string | null) {
  try {
    if (addr && isQAddressFormat(addr)) {
      localStorage.setItem(LKG_KEY, addr);
      localStorage.setItem(LKG_TS, String(_now()));
      _validateCache.set(addr, { ok: true, ts: _now() });
    } else {
      localStorage.removeItem(LKG_KEY);
      localStorage.removeItem(LKG_TS);
    }
  } catch { /* ignore */ }
}

// Convenience: ensure a usable address by preferring explicit > auth > LKG.
// If it returns a value, it’s already validated against the node (unless skipValidate=true).
export async function ensureUsableAddress(opts: {
  explicit?: string | null;        // e.g., from a user picker
  authAddress?: string | null;     // e.g., from useAuth()
  skipValidate?: boolean;          // when you just need a string quickly
} = {}): Promise<string | null> {
  const { explicit, authAddress, skipValidate } = opts;

  // Highest priority: explicit
  if (explicit && isQAddressFormat(explicit)) {
    if (!skipValidate && !(await validateQortalAddress(explicit))) return null;
    rememberAuthAddress(explicit);
    return explicit;
  }

  // Next: auth
  if (authAddress && isQAddressFormat(authAddress)) {
    if (!skipValidate && !(await validateQortalAddress(authAddress))) return null;
    rememberAuthAddress(authAddress);
    return authAddress;
  }

  // Fallback: LKG
  const lkg = getLastKnownAddress();
  if (!lkg) return null;
  if (!skipValidate && !(await validateQortalAddress(lkg))) {
    // stale or invalid — clear it
    rememberAuthAddress(null);
    return null;
  }
  return lkg;
}

// Cross-tab listener: get notified when LKG changes elsewhere (optional).
export function onLastKnownAddressChange(cb: (addr: string | null) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === LKG_KEY || e.key === LKG_TS) cb(getLastKnownAddress());
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
