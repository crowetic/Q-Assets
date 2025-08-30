// utils/resolveIssuerName.ts
import { getPrimaryAccountName } from '../utils/qortalApi';

const LS_PREFIX = 'asset:issuerName:';

export async function resolveIssuerName(ownerAddress: string): Promise<string | null> {
  const k = `${LS_PREFIX}${ownerAddress}`;
  const cached = localStorage.getItem(k);
  if (cached !== null) return cached || null;

  try {
    const name = await getPrimaryAccountName(ownerAddress);
    localStorage.setItem(k, name || '');
    return name || null;
  } catch {
    localStorage.setItem(k, '');
    return null;
  }
}
