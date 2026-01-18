import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLatestTxIndex, type XqloreTxIndex } from '../utils/xqloreIndex';
import { normalizeTx, type NormalizedTx, type XqloreAppRegistryLookup } from '../utils/xqloreTx';

const toTxFromEntry = (entry: any) => ({
  signature: entry.signature,
  timestamp: entry.timestamp,
  type: entry.type,
  blockHeight: entry.blockHeight,
  txGroupId: entry.txGroupId,
  creatorAddress: entry.creatorAddress,
  recipient: entry.recipient,
  amount: entry.amount,
  fee: entry.fee,
  assetId: entry.assetId,
  service: entry.service,
  identifier: entry.identifier,
  name: entry.creatorName,
});

export function useXqloreTxIndex(registry?: XqloreAppRegistryLookup) {
  const [index, setIndex] = useState<XqloreTxIndex | null>(null);
  const [entries, setEntries] = useState<NormalizedTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { index: latest } = await fetchLatestTxIndex();
      setIndex(latest);
      const normalized = (latest?.entries ?? [])
        .map((entry) => normalizeTx(toTxFromEntry(entry), registry))
        .filter((item): item is NormalizedTx => Boolean(item));
      setEntries(normalized);
    } catch (err: any) {
      console.error('Failed to load Xqlore tx index', err);
      setError(err?.message ?? 'Failed to load tx index.');
      setIndex(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [registry]);

  useEffect(() => {
    void load();
  }, [load]);

  const dedupedEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: NormalizedTx[] = [];
    for (const item of entries) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }, [entries]);

  return { index, entries: dedupedEntries, loading, error, reload: load };
}
