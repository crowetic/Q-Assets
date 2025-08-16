export async function resolveToAddress(input: string): Promise<string | null> {
  const v = input.trim();

  // Heuristic: looks like a Qortal address already
  if (/^Q[0-9A-Za-z]{25,}$/.test(v)) return v;

  try {
    const data = await qortalRequest({
      action: 'GET_NAME_DATA',
      name: v,
    });
    if (data?.owner && typeof data.owner === 'string') return data.owner;
  } catch {}

  return null;
}


// utils/address.ts
// Robust, cached resolver for Qortal names/addresses → validated address on *this* node.

const Q_ADDR_RX = /^Q[0-9A-Za-z]{25,}$/;

// tiny in-memory cache for the session
const addressCache = new Map<string, string>();   // input -> resolved address
const validityCache = new Map<string, boolean>(); // address -> isValid

export function isQAddressFormat(s: string): boolean {
  return Q_ADDR_RX.test((s || '').trim());
}

export async function validateQortalAddress(address: string): Promise<boolean> {
  const addr = (address || '').trim();
  if (!addr) return false;

  // cache hit
  const hit = validityCache.get(addr);
  if (typeof hit === 'boolean') return hit;

  try {
    const res = await fetch(`/addresses/validate/${addr}`, {
      method: 'GET',
      headers: { accept: 'text/plain' },
    });
    if (!res.ok) {
      // fall back to a format check if node temporarily unhappy
      const ok = isQAddressFormat(addr);
      validityCache.set(addr, ok);
      return ok;
    }
    const txt = (await res.text()).trim().toLowerCase();
    const ok =
      txt === 'true' || txt === '1' || txt === 'yes' || txt === 'ok' || txt === 'valid';
    validityCache.set(addr, ok);
    return ok;
  } catch {
    const ok = isQAddressFormat(addr);
    validityCache.set(addr, ok);
    return ok;
  }
}

/**
 * Resolve user input to a node-validated address.
 * - Accepts Qortal address or Name (case-insensitive). Leading "@" allowed.
 * - Name -> GET_NAME_DATA.owner -> validate via /addresses/validate
 * - Caches both name and address results.
 */
export async function resolveRecipientStrict(input: string): Promise<string> {
  const raw = (input || '').trim();
  if (!raw) throw new Error('Empty recipient');

  // cache hit for input
  const memo = addressCache.get(raw);
  if (memo) return memo;

  // normalize potential name
  const maybeName = raw.replace(/^@+/, ''); // allow "@name"
  // address path
  if (isQAddressFormat(raw)) {
    const ok = await validateQortalAddress(raw);
    if (!ok) throw new Error('Address is not valid on this node.');
    addressCache.set(raw, raw);
    return raw;
  }

  // name path
  try {
    const data = await qortalRequest({ action: 'GET_NAME_DATA', name: maybeName });
    const addr = data?.owner;
    if (typeof addr !== 'string') throw new Error(`Name not found: ${maybeName}`);

    const ok = await validateQortalAddress(addr);
    if (!ok) throw new Error(`Resolved owner address for "${maybeName}" is not valid on this node.`);
    addressCache.set(raw, addr);
    addressCache.set(maybeName, addr); // also cache normalized variant
    return addr;
  } catch (e: any) {
    throw new Error(
      typeof e?.message === 'string' ? e.message : `Unable to resolve "${maybeName}" to an address`
    );
  }
}
