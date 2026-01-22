import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link } from 'react-router-dom';
import pLimit from 'p-limit';
import { useAuth } from 'qapp-core';
import { useAlert } from '../../components/alerts';
import { useActiveAccountName } from '../../hooks/useActiveAccountName';
import { useQdnBatchPublisher } from '../../utils/useQdnBatchPublisher';
import type { BatchPublishResource } from '../../utils/useQdnBatchPublisher';
import { fetchCurrentBlockHeight } from '../../utils/blockHeight';
import { getPrimaryAccountName } from '../../utils/qortalApi';
import { XQLORE_TX_TYPES } from '../../constants/xqloreTxTypes';
import {
  buildTxIndexPublishResources,
  buildStatsOverviewPublishResources,
  fetchTxIndexCandidates,
  fetchTxIndexDoc,
  fetchLatestTxIndex,
  fetchLatestStatsOverview,
  validateTxIndexEntries,
  type XqloreStatsOverview,
  type XqloreTxIndex,
  type XqloreTxIndexEntry,
} from '../../utils/xqloreIndex';
import {
  formatNumber,
  getIdentifier,
  getService,
  getTxType,
  shortenValue,
} from '../../utils/xqloreTx';
import { useXqloreTxIndex } from '../../hooks/useXqloreTxIndex';

const BLOCK_BATCH_SIZE = 25_000;
const DEFAULT_BATCH_COUNT = 1;
const MAX_BATCH_COUNT = 10;
const MAX_TX_PER_BATCH = 50_000;
const MAX_TOP_ACCOUNTS = 50;
const TX_PAGE_LIMIT = 200;
const REBUILD_PUBLISH_BATCH_SIZE = 20;
const NULL_ACCOUNT_ADDRESS = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

const XqloreStatsPage = () => {
  const theme = useTheme();
  const { address } = useAuth();
  const { alert } = useAlert();
  const { activeName } = useActiveAccountName({ autoAuth: true });
  const { publish } = useQdnBatchPublisher();
  const { index: latestIndex } = useXqloreTxIndex();

  const [batchCount, setBatchCount] = useState(DEFAULT_BATCH_COUNT);
  const [includeNames, setIncludeNames] = useState(true);
  const [batches, setBatches] = useState<
    Array<{
      blockStart: number;
      blockEnd: number;
      entries: XqloreTxIndexEntry[];
      validation: { ok: boolean; errors: string[]; warnings: string[] };
    }>
  >([]);
  const [blockStart, setBlockStart] = useState<number | null>(null);
  const [blockEnd, setBlockEnd] = useState<number | null>(null);
  const [validation, setValidation] = useState<{
    ok: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusNote, setStatusNote] = useState<string>('');
  const [progress, setProgress] = useState<{
    phase: string;
    pages: number;
    entries: number;
    batch?: string;
  } | null>(null);
  const [statsOverview, setStatsOverview] = useState<XqloreStatsOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewRebuildLoading, setOverviewRebuildLoading] = useState(false);
  const [overviewProgress, setOverviewProgress] = useState('');
  const [indexRebuildLoading, setIndexRebuildLoading] = useState(false);
  const [indexRebuildProgress, setIndexRebuildProgress] = useState('');
  const [showIndexTools, setShowIndexTools] = useState(false);
  const [qortAccountsOver25, setQortAccountsOver25] = useState<number | null>(null);
  const [qortAccountsLoading, setQortAccountsLoading] = useState(false);
  const surfaceSx = {
    borderRadius: '24px',
    border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
    background: `linear-gradient(135deg, ${alpha(
      theme.palette.background.paper,
      0.92
    )} 0%, ${alpha(theme.palette.background.default, 0.9)} 100%)`,
    boxShadow: `0 20px 50px ${alpha(theme.palette.common.black, 0.18)}`,
    position: 'relative',
    overflow: 'hidden',
  } as const;

  type AccountCount = { address: string; count: number; name?: string };
  type AccountAmount = { address: string; amount: number; name?: string };
  type OverviewGroup =
    | { title: string; kind: 'amount'; items: AccountAmount[] }
    | { title: string; kind: 'count'; items: AccountCount[] };

  const longStats = useMemo(() => {
    if (statsOverview) {
      return {
        count: statsOverview.entryCount,
        assets: statsOverview.assetEvents,
        arbitrary: statsOverview.qdnPublishes,
      };
    }
    const count = latestIndex?.entries.length ?? 0;
    const assets =
      latestIndex?.entries.filter((entry) => {
        if (!String(entry.type).includes('ASSET')) return false;
        if (entry.type === 'TRANSFER_ASSET' && Number(entry.assetId) === 0) return false;
        return true;
      }).length ?? 0;
    const arbitrary =
      latestIndex?.entries.filter((entry) => entry.type === 'ARBITRARY').length ?? 0;
    return { count, assets, arbitrary };
  }, [latestIndex, statsOverview]);

  const overviewGroups: OverviewGroup[] = statsOverview
    ? [
        {
          title: 'Most QDN publishes',
          items: statsOverview.topAccountsByQdnPublishes,
          kind: 'count',
        },
        {
          title: 'Most asset events',
          items: statsOverview.topAccountsByAssetEvents,
          kind: 'count',
        },
        {
          title: 'Most incoming QORT',
          items: statsOverview.topAccountsByIncomingQort,
          kind: 'amount',
        },
        {
          title: 'Most bought QORT',
          items: statsOverview.topAccountsByBoughtQort,
          kind: 'amount',
        },
        {
          title: 'Most sold QORT',
          items: statsOverview.topAccountsBySoldQort,
          kind: 'amount',
        },
        {
          title: 'Consolidation tx count',
          items: statsOverview.topAccountsByConsolidatedQort,
          kind: 'count',
        },
        {
          title: 'Most overall transactions',
          items: statsOverview.topAccountsByTxCount,
          kind: 'count',
        },
      ]
    : [];

  const isNullAddress = (addr?: string | null) => addr === NULL_ACCOUNT_ADDRESS;
  const formatAccountLabel = (item: { address: string; name?: string }) =>
    item.name ? item.name : shortenValue(item.address, 6, 4);
  const isAssetEvent = (entry: XqloreTxIndexEntry) => {
    if (!entry.type.includes('ASSET')) return false;
    if (entry.type === 'TRANSFER_ASSET' && Number(entry.assetId) === 0) return false;
    return true;
  };
  const getQortAmount = (entry: XqloreTxIndexEntry) => {
    if (entry.type === 'PAYMENT' || entry.type === 'MULTI_PAYMENT') {
      return Number(entry.amount ?? 0) || 0;
    }
    if (entry.type === 'TRANSFER_ASSET' && Number(entry.assetId) === 0) {
      return Number(entry.amount ?? 0) || 0;
    }
    if (entry.type === 'AT') {
      return Number(entry.amount ?? 0) || 0;
    }
    return 0;
  };

  const addCount = (
    map: Map<string, AccountCount>,
    address: string,
    count: number,
    name?: string
  ) => {
    if (!address || isNullAddress(address)) return;
    const current = map.get(address);
    if (current) {
      current.count += count;
      if (!current.name && name) current.name = name;
    } else {
      map.set(address, { address, count, name });
    }
  };

  const addAmount = (
    map: Map<string, AccountAmount>,
    address: string,
    amount: number,
    name?: string
  ) => {
    if (!address || isNullAddress(address) || amount <= 0) return;
    const current = map.get(address);
    if (current) {
      current.amount += amount;
      if (!current.name && name) current.name = name;
    } else {
      map.set(address, { address, amount, name });
    }
  };

  const seedCountMap = (base: AccountCount[] = []) => {
    const map = new Map<string, AccountCount>();
    base.forEach((item) => {
      if (!item?.address || item.count <= 0 || isNullAddress(item.address)) return;
      map.set(item.address, { ...item });
    });
    return map;
  };

  const seedAmountMap = (base: AccountAmount[] = []) => {
    const map = new Map<string, AccountAmount>();
    base.forEach((item) => {
      if (!item?.address || item.amount <= 0 || isNullAddress(item.address)) return;
      map.set(item.address, { ...item });
    });
    return map;
  };

  const mergeCountMaps = (
    target: Map<string, AccountCount>,
    incoming: Map<string, AccountCount>
  ) => {
    incoming.forEach((item) => addCount(target, item.address, item.count, item.name));
  };

  const mergeAmountMaps = (
    target: Map<string, AccountAmount>,
    incoming: Map<string, AccountAmount>
  ) => {
    incoming.forEach((item) => addAmount(target, item.address, item.amount, item.name));
  };

  const toCountList = (map: Map<string, AccountCount>) =>
    Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_TOP_ACCOUNTS);

  const toAmountList = (map: Map<string, AccountAmount>) =>
    Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, MAX_TOP_ACCOUNTS);

  const aggregateEntries = (entries: XqloreTxIndexEntry[]) => {
    const resolveAtAddress = (entry: XqloreTxIndexEntry) => {
      const tx = entry.tx && typeof entry.tx === 'object' ? entry.tx : null;
      const raw =
        typeof tx?.atAddress === 'string'
          ? tx.atAddress.trim()
          : typeof tx?.aTAddress === 'string'
            ? tx.aTAddress.trim()
            : '';
      return raw || undefined;
    };
    const atCreatorMap = new Map<string, string>();
    const atTypeMap = new Map<string, string>();
    const atRefunded = new Set<string>();
    entries.forEach((entry) => {
      const atAddress = resolveAtAddress(entry);
      if (!atAddress) return;
      if (entry.type === 'DEPLOY_AT' && entry.creatorAddress) {
        atCreatorMap.set(atAddress, entry.creatorAddress);
        const tx = entry.tx && typeof entry.tx === 'object' ? entry.tx : null;
        const rawType =
          typeof tx?.aTType === 'string'
            ? tx.aTType.trim()
            : typeof tx?.atType === 'string'
              ? tx.atType.trim()
              : '';
        if (rawType) atTypeMap.set(atAddress, rawType.toUpperCase());
      }
    });
    entries.forEach((entry) => {
      if (entry.type !== 'AT' || !entry.recipient) return;
      const atAddress = resolveAtAddress(entry);
      if (!atAddress) return;
      const creator = atCreatorMap.get(atAddress);
      if (creator && creator === entry.recipient) {
        atRefunded.add(atAddress);
      }
    });
    const isOwnAt = (addr?: string | null, atAddress?: string) => {
      if (!addr || !atAddress) return false;
      return atCreatorMap.get(atAddress) === addr;
    };
    const isAcctAt = (atAddress?: string) =>
      atAddress ? atTypeMap.get(atAddress) === 'ACCT' : false;
    const txCountMap = new Map<string, AccountCount>();
    const incomingQortMap = new Map<string, AccountAmount>();
    const boughtQortMap = new Map<string, AccountAmount>();
    const soldQortMap = new Map<string, AccountAmount>();
    const consolidatedQortMap = new Map<string, AccountCount>();
    const qdnPublishMap = new Map<string, AccountCount>();
    const assetEventMap = new Map<string, AccountCount>();
    let qdnPublishes = 0;
    let assetEvents = 0;

    entries.forEach((entry) => {
      if (entry.type === 'ARBITRARY') {
        qdnPublishes += 1;
        if (entry.creatorAddress) {
          addCount(qdnPublishMap, entry.creatorAddress, 1, entry.creatorName);
        }
      }
      if (isAssetEvent(entry)) {
        assetEvents += 1;
        if (entry.creatorAddress) {
          addCount(assetEventMap, entry.creatorAddress, 1, entry.creatorName);
        }
      }
      if (entry.creatorAddress) {
        addCount(txCountMap, entry.creatorAddress, 1, entry.creatorName);
      }
      const amount = getQortAmount(entry);
      const atAddress = resolveAtAddress(entry);
      if (entry.type === 'DEPLOY_AT' && entry.creatorAddress) {
        const deployAmount = Number(entry.amount ?? 0) || 0;
        if (deployAmount > 0 && isAcctAt(atAddress) && !atRefunded.has(atAddress || '')) {
          addAmount(soldQortMap, entry.creatorAddress, deployAmount, entry.creatorName);
        }
      }
      if (
        entry.type === 'AT' &&
        amount > 0 &&
        entry.creatorAddress &&
        entry.recipient &&
        atAddress &&
        isAcctAt(atAddress) &&
        entry.recipient === atAddress &&
        !isOwnAt(entry.creatorAddress, atAddress)
      ) {
        addAmount(soldQortMap, entry.creatorAddress, amount, entry.creatorName);
      }
      if (amount > 0 && entry.recipient) {
        const recipientName =
          entry.tx && typeof entry.tx === 'object' && typeof entry.tx.recipientName === 'string'
            ? entry.tx.recipientName
            : undefined;
        const isAcctAutomation = isAcctAt(atAddress);
        const recipientIsOwner = Boolean(entry.recipient && isOwnAt(entry.recipient, atAddress));
        const recipientIsAtAddress =
          !!entry.recipient && !!atAddress && entry.recipient === atAddress;
        const isSelfAt =
          entry.type === 'AT' &&
          isAcctAutomation &&
          recipientIsOwner &&
          atRefunded.has(atAddress || '');
        if (!recipientIsAtAddress && !isSelfAt) {
          addAmount(incomingQortMap, entry.recipient, amount, recipientName);
          addCount(consolidatedQortMap, entry.recipient, 1, recipientName);
        }
        if (
          entry.type === 'AT' &&
          !recipientIsAtAddress &&
          !isSelfAt &&
          isAcctAutomation &&
          !recipientIsOwner
        ) {
          addAmount(boughtQortMap, entry.recipient, amount, recipientName);
        }
      }
    });

    return {
      entryCount: entries.length,
      qdnPublishes,
      assetEvents,
      txCountMap,
      incomingQortMap,
      boughtQortMap,
      soldQortMap,
      consolidatedQortMap,
      qdnPublishMap,
      assetEventMap,
    };
  };

  const buildStatsOverviewForPublish = (
    base: XqloreStatsOverview | null,
    nextBatches: typeof batches
  ): XqloreStatsOverview => {
    const entries = nextBatches.flatMap((batch) => batch.entries);
    const batchStart = nextBatches[0]?.blockStart ?? 0;
    const batchEnd = nextBatches[nextBatches.length - 1]?.blockEnd ?? 0;
    const blockStart = Math.min(base?.blockStart ?? batchStart, batchStart);
    const blockEnd = Math.max(base?.blockEnd ?? batchEnd, batchEnd);
    const aggregate = aggregateEntries(entries);

    const incomingMap = seedAmountMap(base?.topAccountsByIncomingQort);
    mergeAmountMaps(incomingMap, aggregate.incomingQortMap);
    const soldMap = seedAmountMap(base?.topAccountsBySoldQort);
    mergeAmountMaps(soldMap, aggregate.soldQortMap);
    const boughtMap = seedAmountMap(base?.topAccountsByBoughtQort);
    mergeAmountMaps(boughtMap, aggregate.boughtQortMap);
    const consolidatedMap = seedCountMap(base?.topAccountsByConsolidatedQort);
    mergeCountMaps(consolidatedMap, aggregate.consolidatedQortMap);
    const txCountMap = seedCountMap(base?.topAccountsByTxCount);
    mergeCountMaps(txCountMap, aggregate.txCountMap);
    const qdnPublishMap = seedCountMap(base?.topAccountsByQdnPublishes);
    mergeCountMaps(qdnPublishMap, aggregate.qdnPublishMap);
    const assetEventMap = seedCountMap(base?.topAccountsByAssetEvents);
    mergeCountMaps(assetEventMap, aggregate.assetEventMap);

    return {
      version: 1,
      updatedAt: Date.now(),
      blockStart,
      blockEnd,
      entryCount: (base?.entryCount ?? 0) + aggregate.entryCount,
      qdnPublishes: (base?.qdnPublishes ?? 0) + aggregate.qdnPublishes,
      assetEvents: (base?.assetEvents ?? 0) + aggregate.assetEvents,
      topAccountsByIncomingQort: toAmountList(incomingMap),
      topAccountsBySoldQort: toAmountList(soldMap),
      topAccountsByBoughtQort: toAmountList(boughtMap),
      topAccountsByConsolidatedQort: toCountList(consolidatedMap),
      topAccountsByTxCount: toCountList(txCountMap),
      topAccountsByQdnPublishes: toCountList(qdnPublishMap),
      topAccountsByAssetEvents: toCountList(assetEventMap),
    };
  };

  const rebuildStatsOverview = useCallback(async () => {
    if (!activeName) {
      await alert('Select an active publishing name before rebuilding.', 'Name required', {
        severity: 'warning',
      });
      return;
    }
    setOverviewRebuildLoading(true);
    setOverviewProgress('Finding published index batches...');
    try {
      const hits = await fetchTxIndexCandidates(200);
      const docs: XqloreTxIndex[] = [];
      if (hits.length) {
        setOverviewProgress(`Loading ${hits.length} index batch(es)...`);
        for (const hit of hits) {
          const doc = await fetchTxIndexDoc(hit);
          if (doc) docs.push(doc);
        }
      } else {
        setOverviewProgress('Loading the latest published index...');
        const fallback = await fetchLatestTxIndex();
        if (fallback.index) docs.push(fallback.index);
      }
      if (!docs.length) {
        await alert('No tx indexes found to aggregate.', 'No data', { severity: 'info' });
        return;
      }
      setOverviewProgress(`Aggregating ${docs.length} batch(es)...`);
      const txCountMap = new Map<string, AccountCount>();
      const incomingQortMap = new Map<string, AccountAmount>();
      const boughtQortMap = new Map<string, AccountAmount>();
      const soldQortMap = new Map<string, AccountAmount>();
      const consolidatedQortMap = new Map<string, AccountCount>();
      const qdnPublishMap = new Map<string, AccountCount>();
      const assetEventMap = new Map<string, AccountCount>();
      let entryCount = 0;
      let qdnPublishes = 0;
      let assetEvents = 0;
      let blockStart = Number.POSITIVE_INFINITY;
      let blockEnd = 0;

      for (let i = 0; i < docs.length; i += 1) {
        setOverviewProgress(`Aggregating batch ${i + 1}/${docs.length}...`);
        const doc = docs[i];
        const aggregate = aggregateEntries(doc.entries);
        entryCount += aggregate.entryCount;
        qdnPublishes += aggregate.qdnPublishes;
        assetEvents += aggregate.assetEvents;
        blockStart = Math.min(blockStart, doc.blockStart);
        blockEnd = Math.max(blockEnd, doc.blockEnd);
        mergeCountMaps(txCountMap, aggregate.txCountMap);
        mergeAmountMaps(incomingQortMap, aggregate.incomingQortMap);
        mergeAmountMaps(boughtQortMap, aggregate.boughtQortMap);
        mergeAmountMaps(soldQortMap, aggregate.soldQortMap);
        mergeCountMaps(consolidatedQortMap, aggregate.consolidatedQortMap);
        mergeCountMaps(qdnPublishMap, aggregate.qdnPublishMap);
        mergeCountMaps(assetEventMap, aggregate.assetEventMap);
      }

      if (!Number.isFinite(blockStart) || blockEnd === 0) {
        await alert('No valid index docs found to aggregate.', 'No data', { severity: 'warning' });
        return;
      }

      setOverviewProgress('Preparing overview payload...');
      const overview: XqloreStatsOverview = {
        version: 1,
        updatedAt: Date.now(),
        blockStart,
        blockEnd,
        entryCount,
        qdnPublishes,
        assetEvents,
        topAccountsByIncomingQort: toAmountList(incomingQortMap),
        topAccountsBySoldQort: toAmountList(soldQortMap),
        topAccountsByBoughtQort: toAmountList(boughtQortMap),
        topAccountsByConsolidatedQort: toCountList(consolidatedQortMap),
        topAccountsByTxCount: toCountList(txCountMap),
        topAccountsByQdnPublishes: toCountList(qdnPublishMap),
        topAccountsByAssetEvents: toCountList(assetEventMap),
      };

      setOverviewProgress('Publishing overview...');
      const overviewResources = await buildStatsOverviewPublishResources({
        publisherName: activeName,
        blockStart: overview.blockStart,
        blockEnd: overview.blockEnd,
        overview,
      });
      await publish(overviewResources);
      setStatsOverview(overview);
      await alert('Stats overview rebuilt and published.', 'Success', { severity: 'success' });
    } catch (err: any) {
      await alert(err?.message || 'Failed to rebuild stats overview.', 'Publish error', {
        severity: 'error',
      });
    } finally {
      setOverviewRebuildLoading(false);
      setOverviewProgress('');
    }
  }, [activeName, alert, publish]);

  const rebuildIndexes = useCallback(async () => {
    if (!activeName) {
      await alert('Select an active publishing name before rebuilding.', 'Name required', {
        severity: 'warning',
      });
      return;
    }
    setIndexRebuildLoading(true);
    setIndexRebuildProgress('Finding published index batches...');
    try {
      const hits = await fetchTxIndexCandidates(200);
      const parseRange = (identifier?: string | null) => {
        const raw = identifier ? String(identifier) : '';
        const match = raw.match(/__(\d+)__(\d+)__/);
        if (!match) return null;
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        return { start, end };
      };
      const normalizedName = (name?: string) => String(name || '').toLowerCase();
      const ownHits = hits.filter((hit) => normalizedName(hit.name) === normalizedName(activeName));
      if (!ownHits.length) {
        await alert(
          'No index batches found for the active name. Rebuild skipped to avoid duplicating other publishers.',
          'No matching batches',
          { severity: 'info' }
        );
        return;
      }
      const byRange = new Map<
        string,
        { hit: (typeof ownHits)[number]; range: { start: number; end: number } }
      >();
      const getStamp = (hit: (typeof ownHits)[number]) =>
        Number.isFinite(hit.updated) ? Number(hit.updated) : Number(hit.created) || 0;
      for (const hit of ownHits) {
        const range = parseRange(hit.identifier);
        if (!range) continue;
        const key = `${range.start}-${range.end}`;
        const existing = byRange.get(key);
        if (!existing) {
          byRange.set(key, { hit, range });
          continue;
        }
        if (hit.size !== existing.hit.size) {
          if (hit.size > existing.hit.size) {
            byRange.set(key, { hit, range });
          }
          continue;
        }
        if (getStamp(hit) > getStamp(existing.hit)) {
          byRange.set(key, { hit, range });
        }
      }
      const selectedHits = Array.from(byRange.values()).sort((a, b) => {
        if (a.range.end !== b.range.end) return a.range.end - b.range.end;
        return a.range.start - b.range.start;
      });

      if (!selectedHits.length) {
        setIndexRebuildProgress('Loading the latest published index...');
        const fallback = await fetchLatestTxIndex();
        if (!fallback.index || !fallback.head?.latestIdentifier) {
          await alert('No tx indexes found to rebuild.', 'No data', { severity: 'info' });
          return;
        }
        setIndexRebuildProgress('Rebuilding latest batch...');
        const rebuiltEntries = [...fallback.index.entries].sort((a, b) => {
          const heightA =
            Number.isFinite(Number(a.blockHeight)) && Number(a.blockHeight) > 0
              ? Number(a.blockHeight)
              : Number.MAX_SAFE_INTEGER;
          const heightB =
            Number.isFinite(Number(b.blockHeight)) && Number(b.blockHeight) > 0
              ? Number(b.blockHeight)
              : Number.MAX_SAFE_INTEGER;
          if (heightA !== heightB) return heightA - heightB;
          const timeA = Number(a.timestamp ?? 0) || 0;
          const timeB = Number(b.timestamp ?? 0) || 0;
          if (timeA !== timeB) return timeA - timeB;
          return a.signature.localeCompare(b.signature);
        });
        const resources = await buildTxIndexPublishResources({
          publisherName: activeName,
          publisherAddress: address ?? undefined,
          blockStart: fallback.index.blockStart,
          blockEnd: fallback.index.blockEnd,
          entries: rebuiltEntries,
          identifier: fallback.head.latestIdentifier,
        });
        setIndexRebuildProgress('Publishing rebuilt batch...');
        await publish(resources);
        await alert('Rebuilt index batch published.', 'Success', { severity: 'success' });
        return;
      }

      let pendingResources: BatchPublishResource[] | null = null;
      let rebuiltBatches = 0;
      let publishQueue: BatchPublishResource[] = [];

      const flushQueue = async (includeHead: boolean) => {
        if (!publishQueue.length) return;
        setIndexRebuildProgress(
          includeHead
            ? `Publishing final ${publishQueue.length - 1} batch(es)...`
            : `Publishing ${publishQueue.length} batch(es)...`
        );
        await publish(publishQueue);
        publishQueue = [];
      };

      for (let i = 0; i < selectedHits.length; i += 1) {
        setIndexRebuildProgress(`Rebuilding batch ${i + 1}/${selectedHits.length}...`);
        const doc = await fetchTxIndexDoc(selectedHits[i].hit);
        if (!doc || !doc.entries.length) continue;
        const rebuiltEntries = [...doc.entries].sort((a, b) => {
          const heightA =
            Number.isFinite(Number(a.blockHeight)) && Number(a.blockHeight) > 0
              ? Number(a.blockHeight)
              : Number.MAX_SAFE_INTEGER;
          const heightB =
            Number.isFinite(Number(b.blockHeight)) && Number(b.blockHeight) > 0
              ? Number(b.blockHeight)
              : Number.MAX_SAFE_INTEGER;
          if (heightA !== heightB) return heightA - heightB;
          const timeA = Number(a.timestamp ?? 0) || 0;
          const timeB = Number(b.timestamp ?? 0) || 0;
          if (timeA !== timeB) return timeA - timeB;
          return a.signature.localeCompare(b.signature);
        });

        const batchResources = await buildTxIndexPublishResources({
          publisherName: activeName,
          publisherAddress: address ?? undefined,
          blockStart: doc.blockStart,
          blockEnd: doc.blockEnd,
          entries: rebuiltEntries,
          identifier: selectedHits[i].hit.identifier,
        });

        if (pendingResources) {
          publishQueue.push(pendingResources[0]);
          if (publishQueue.length >= REBUILD_PUBLISH_BATCH_SIZE) {
            await flushQueue(false);
          }
        }

        pendingResources = batchResources;
        rebuiltBatches += 1;
      }

      if (!pendingResources) {
        await alert('No index batches were eligible to republish.', 'No data', {
          severity: 'info',
        });
        return;
      }

      publishQueue.push(...pendingResources);
      await flushQueue(true);
      await alert(`Rebuilt ${rebuiltBatches} index batch(es).`, 'Success', {
        severity: 'success',
      });
    } catch (err: any) {
      await alert(err?.message || 'Failed to rebuild index batches.', 'Publish error', {
        severity: 'error',
      });
    } finally {
      setIndexRebuildLoading(false);
      setIndexRebuildProgress('');
    }
  }, [activeName, address, alert, publish]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const { overview } = await fetchLatestStatsOverview();
      setStatsOverview(overview);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    let active = true;
    setQortAccountsLoading(true);
    const load = async () => {
      let total = 0;
      let offset = 0;
      const pageSize = 5000;
      while (true) {
        const params = new URLSearchParams({
          assetid: '0',
          ordering: 'ASSET_BALANCE_ACCOUNT',
          excludeZero: 'true',
          limit: String(pageSize),
          reverse: 'true',
          offset: String(offset),
        });
        const res = await fetch(`/assets/balances?${params.toString()}`, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) break;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        let belowThreshold = false;
        rows.forEach((row) => {
          const balance = Number(
            row?.balance ?? row?.amount ?? row?.confirmedBalance ?? row?.confirmed
          );
          if (!Number.isFinite(balance)) return;
          if (balance >= 25) {
            total += 1;
          } else {
            belowThreshold = true;
          }
        });
        if (belowThreshold || rows.length < pageSize) break;
        offset += pageSize;
      }
      if (active) setQortAccountsOver25(total);
    };
    void load().finally(() => {
      if (active) setQortAccountsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const buildIndex = useCallback(async () => {
    setLoading(true);
    setValidation(null);
    setStatusNote('');
    setBatches([]);
    setProgress({ phase: 'Starting index build...', pages: 0, entries: 0 });
    try {
      const height = await fetchCurrentBlockHeight();
      const start = latestIndex?.blockEnd ? latestIndex.blockEnd + 1 : 1;
      if (start > height) {
        setValidation({ ok: false, errors: ['No new blocks to index.'], warnings: [] });
        setStatusNote('No new blocks to index.');
        setProgress(null);
        return;
      }

      const targetBatches = Math.max(1, Math.min(MAX_BATCH_COUNT, batchCount));
      const nextBatches: Array<{
        blockStart: number;
        blockEnd: number;
        entries: XqloreTxIndexEntry[];
        validation: { ok: boolean; errors: string[]; warnings: string[] };
      }> = [];
      let lastEnd = start - 1;
      let cursorStart = start;

      for (let i = 0; i < targetBatches && cursorStart <= height; i += 1) {
        const batchStart = cursorStart;
        const batchEnd = Math.min(height, batchStart + BLOCK_BATCH_SIZE - 1);
        const effectiveLimit = batchEnd - batchStart + 1;
        const batchLabel = `Batch ${i + 1}/${targetBatches}`;
        setStatusNote(`Scanning blocks ${batchStart}-${batchEnd}...`);
        setProgress({ phase: 'Scanning blocks', pages: 0, entries: 0, batch: batchLabel });

        const collected: any[] = [];
        let offset = 0;
        let hasMore = true;
        let pageCount = 0;
        let capReached = false;
        while (hasMore) {
          const res = await qortalRequest({
            action: 'SEARCH_TRANSACTIONS',
            confirmationStatus: 'CONFIRMED',
            startBlock: batchStart,
            blockLimit: effectiveLimit,
            limit: TX_PAGE_LIMIT,
            offset,
            reverse: false,
            txType: [...XQLORE_TX_TYPES],
          });
          const rows = Array.isArray(res) ? res : res && typeof res === 'object' ? [res] : [];
          if (rows.length === 0) break;
          collected.push(...rows);
          pageCount += 1;
          if (collected.length >= MAX_TX_PER_BATCH) {
            capReached = true;
            if (collected.length > MAX_TX_PER_BATCH) {
              collected.length = MAX_TX_PER_BATCH;
            }
            hasMore = false;
          }
          setProgress({
            phase: 'Scanning blocks',
            pages: pageCount,
            entries: collected.length,
            batch: batchLabel,
          });
          if (!hasMore || rows.length < TX_PAGE_LIMIT) {
            hasMore = false;
          } else {
            offset += TX_PAGE_LIMIT;
          }
        }

        setStatusNote(`Indexed ${collected.length} transactions. Building entries...`);
        setProgress({
          phase: 'Building entries',
          pages: pageCount,
          entries: collected.length,
          batch: batchLabel,
        });

        const draftEntries: XqloreTxIndexEntry[] = collected
          .map((tx: any) => {
            const signature = String(tx?.signature ?? tx?.txId ?? '').trim();
            if (!signature) return null;
            const type = getTxType(tx);
            const identifier = getIdentifier(tx, type);
            const service = getService(tx);
            const creatorAddress = String(
              tx?.creatorAddress ?? tx?.creator ?? tx?.sender ?? ''
            ).trim();
            return {
              signature,
              timestamp: Number(tx?.timestamp ?? 0),
              type,
              blockHeight: Number(tx?.blockHeight ?? tx?.height ?? 0) || undefined,
              creatorAddress: creatorAddress || undefined,
              service: service || undefined,
              identifier: identifier || undefined,
              tx,
            };
          })
          .filter(Boolean) as XqloreTxIndexEntry[];

        if (draftEntries.length === 0) {
          setStatusNote(`No transactions found for blocks ${batchStart}-${batchEnd}. Skipping.`);
          setProgress({
            phase: 'Skipping empty batch',
            pages: pageCount,
            entries: 0,
            batch: batchLabel,
          });
          cursorStart = batchEnd + 1;
          continue;
        }

        if (includeNames) {
          const uniqueAddresses = Array.from(
            new Set(draftEntries.map((entry) => entry.creatorAddress).filter(Boolean))
          ) as string[];
          const limiter = pLimit(2);
          const nameMap = new Map<string, string>();
          setStatusNote(`Resolving ${uniqueAddresses.length} creator names...`);
          setProgress({
            phase: 'Resolving names',
            pages: pageCount,
            entries: draftEntries.length,
            batch: batchLabel,
          });
          await Promise.all(
            uniqueAddresses.map((addr) =>
              limiter(async () => {
                const name = await getPrimaryAccountName(addr);
                if (name) nameMap.set(addr, name);
              })
            )
          );
          draftEntries.forEach((entry) => {
            if (entry.creatorAddress && nameMap.has(entry.creatorAddress)) {
              const creatorName = nameMap.get(entry.creatorAddress);
              if (creatorName) {
                entry.creatorName = creatorName;
                if (entry.tx && typeof entry.tx === 'object') {
                  entry.tx.creatorName = creatorName;
                }
              }
            }
          });
        }

        draftEntries.sort((a, b) => {
          const heightA =
            Number.isFinite(Number(a.blockHeight)) && Number(a.blockHeight) > 0
              ? Number(a.blockHeight)
              : Number.MAX_SAFE_INTEGER;
          const heightB =
            Number.isFinite(Number(b.blockHeight)) && Number(b.blockHeight) > 0
              ? Number(b.blockHeight)
              : Number.MAX_SAFE_INTEGER;
          if (heightA !== heightB) return heightA - heightB;
          const timeA = Number(a.timestamp ?? 0) || 0;
          const timeB = Number(b.timestamp ?? 0) || 0;
          if (timeA !== timeB) return timeA - timeB;
          return a.signature.localeCompare(b.signature);
        });

        setStatusNote('Validating index...');
        setProgress({
          phase: 'Validating',
          pages: pageCount,
          entries: draftEntries.length,
          batch: batchLabel,
        });
        const maxEntryHeight = draftEntries.reduce((max, entry) => {
          const heightVal = Number(entry.blockHeight ?? 0);
          return heightVal > max ? heightVal : max;
        }, 0);
        const actualEnd = maxEntryHeight > 0 ? maxEntryHeight : batchEnd;
        const result = await validateTxIndexEntries({
          blockStart: batchStart,
          blockEnd: actualEnd,
          entries: draftEntries,
          sampleSize: 5,
        });
        const warnings = capReached
          ? [
              ...result.warnings,
              `Reached ${MAX_TX_PER_BATCH.toLocaleString()} tx cap; batch end set to block ${actualEnd}.`,
            ]
          : result.warnings;

        nextBatches.push({
          blockStart: batchStart,
          blockEnd: actualEnd,
          entries: draftEntries,
          validation: { ok: result.ok, errors: result.errors, warnings },
        });
        lastEnd = actualEnd;
        cursorStart = actualEnd + 1;
      }

      setBatches(nextBatches);
      setBlockStart(start);
      setBlockEnd(lastEnd >= start ? lastEnd : start);

      const errors = nextBatches.flatMap((batch, idx) =>
        batch.validation.errors.map((err) => `Batch ${idx + 1}: ${err}`)
      );
      const warnings = nextBatches.flatMap((batch, idx) =>
        batch.validation.warnings.map((warn) => `Batch ${idx + 1}: ${warn}`)
      );
      const ok = errors.length === 0;
      setValidation({ ok, errors, warnings });
      setStatusNote(ok ? 'Validation passed.' : 'Validation found issues.');
    } catch (err: any) {
      setStatusNote('Failed to build index.');
      setValidation({
        ok: false,
        errors: [err?.message ?? 'Failed to build index.'],
        warnings: [],
      });
    } finally {
      setProgress(null);
      setLoading(false);
    }
  }, [batchCount, includeNames, latestIndex]);

  const publishIndex = useCallback(async () => {
    if (!activeName) {
      await alert('Select an active publishing name before publishing.', 'Name required', {
        severity: 'warning',
      });
      return;
    }
    if (!blockStart || !blockEnd || batches.length === 0) {
      await alert('Run a build before publishing the index.', 'Missing range', {
        severity: 'warning',
      });
      return;
    }
    if (!validation?.ok) {
      await alert('Validation failed; resolve errors before publishing.', 'Validation failed', {
        severity: 'error',
      });
      return;
    }

    try {
      const resources: BatchPublishResource[] = [];
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const batchResources = await buildTxIndexPublishResources({
          publisherName: activeName,
          publisherAddress: address ?? undefined,
          blockStart: batch.blockStart,
          blockEnd: batch.blockEnd,
          entries: batch.entries,
        });
        if (i < batches.length - 1) {
          resources.push(batchResources[0]);
        } else {
          resources.push(...batchResources);
        }
      }
      const { overview: latestOverview } = await fetchLatestStatsOverview();
      const mergedOverview = buildStatsOverviewForPublish(latestOverview, batches);
      const overviewResources = await buildStatsOverviewPublishResources({
        publisherName: activeName,
        blockStart: mergedOverview.blockStart,
        blockEnd: mergedOverview.blockEnd,
        overview: mergedOverview,
      });
      resources.push(...overviewResources);
      await publish(resources);
      setStatsOverview(mergedOverview);
      await alert(`Published ${batches.length} index batch(es).`, 'Success', {
        severity: 'success',
      });
    } catch (err: any) {
      await alert(err?.message || 'Failed to publish index.', 'Publish error', {
        severity: 'error',
      });
    }
  }, [activeName, address, alert, blockStart, blockEnd, batches, publish, validation]);

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100%',
        px: { xs: 2, md: 4 },
        py: { xs: 3, md: 5 },
        background: `radial-gradient(circle at 15% 10%, ${alpha(
          theme.palette.info.light,
          0.2
        )} 0%, transparent 45%), linear-gradient(180deg, ${alpha(
          theme.palette.background.default,
          0.98
        )} 0%, ${alpha(theme.palette.background.paper, 0.92)} 100%)`,
      }}
    >
      <Box sx={{ width: '85vw', maxWidth: 1600, mx: 'auto' }}>
        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 }, mb: 3 }}>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
              <Box>
                <Typography variant="h4" sx={{ fontFamily: 'Orbitron' }}>
                  Long-term Stats
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Index-backed analytics and history beyond the live feed.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button component={Link} to="/xqlore" variant="outlined">
                  Back to Xqlore
                </Button>
              </Stack>
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              {[
                {
                  label: 'QDN publishes',
                  value: longStats.arbitrary,
                  accent: theme.palette.info.main,
                },
                {
                  label: 'Asset events',
                  value: longStats.assets,
                  accent: theme.palette.warning.main,
                },
                {
                  label: 'Indexed entries',
                  value: longStats.count,
                  accent: theme.palette.success.main,
                },
                {
                  label: 'accounts with >25 QORT',
                  value: qortAccountsOver25 ?? 0,
                  accent: theme.palette.primary.main,
                  loading: qortAccountsLoading,
                },
              ].map((item) => (
                <Paper
                  key={item.label}
                  elevation={0}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: `1px solid ${alpha(item.accent, 0.35)}`,
                    background: `linear-gradient(140deg, ${alpha(
                      item.accent,
                      0.12
                    )} 0%, ${alpha(theme.palette.background.paper, 0.9)} 80%)`,
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
                    {item.label}
                  </Typography>
                  {item.loading ? (
                    <Typography variant="body2" color="text.secondary">
                      Scanning...
                    </Typography>
                  ) : (
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                      {item.value.toLocaleString()}
                    </Typography>
                  )}
                </Paper>
              ))}
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {statsOverview?.blockStart && statsOverview?.blockEnd && (
                <Chip
                  label={`Aggregate blocks ${statsOverview.blockStart}-${statsOverview.blockEnd}`}
                  variant="outlined"
                  color="success"
                />
              )}
              {overviewLoading && <Chip label="Loading overview..." variant="outlined" />}
              {latestIndex?.blockStart && latestIndex?.blockEnd && (
                <Chip
                  label={`Latest index blocks ${latestIndex.blockStart}-${latestIndex.blockEnd}`}
                  variant="outlined"
                />
              )}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button
                variant={showIndexTools ? 'contained' : 'outlined'}
                onClick={() => setShowIndexTools((prev) => !prev)}
              >
                Index tools
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Collapse in={showIndexTools} unmountOnExit>
          <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 }, mb: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
                Publish / update tx index
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Build 25k-block index batches and publish them for long-term visibility (capped at
                50k transactions per batch). Ranges start from genesis or continue after the latest
                published index. Validation checks random signatures and continuity across each
                batch.
              </Typography>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                alignItems={{ md: 'center' }}
              >
                <TextField
                  size="small"
                  label="25k batches"
                  type="number"
                  value={batchCount}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    const next = Math.max(1, Math.min(MAX_BATCH_COUNT, Math.floor(value)));
                    setBatchCount(next);
                  }}
                  helperText={`Up to ${MAX_BATCH_COUNT} batches`}
                  sx={{ maxWidth: 200 }}
                />
                <ToggleButtonGroup
                  value={includeNames ? 'yes' : 'no'}
                  exclusive
                  onChange={(_, next) => setIncludeNames(next === 'yes')}
                  size="small"
                >
                  <ToggleButton value="yes">Include names</ToggleButton>
                  <ToggleButton value="no">No names</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button variant="contained" onClick={buildIndex} disabled={loading}>
                  {loading ? 'Building...' : 'Build + validate index'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={publishIndex}
                  disabled={loading || !validation?.ok}
                >
                  Publish index
                </Button>
                <Button
                  variant="outlined"
                  onClick={rebuildIndexes}
                  disabled={indexRebuildLoading || loading}
                >
                  {indexRebuildLoading ? 'Rebuilding indexes...' : 'Rebuild index batches'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={rebuildStatsOverview}
                  disabled={overviewRebuildLoading || loading}
                >
                  {overviewRebuildLoading ? 'Rebuilding overview...' : 'Rebuild stats overview'}
                </Button>
              </Stack>
              {statusNote && (
                <Typography variant="body2" color={validation?.ok ? 'success.main' : 'error.main'}>
                  {statusNote}
                </Typography>
              )}
              {indexRebuildLoading && indexRebuildProgress && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {indexRebuildProgress}
                  </Typography>
                  <LinearProgress sx={{ mt: 1 }} />
                </Box>
              )}
              {overviewRebuildLoading && overviewProgress && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {overviewProgress}
                  </Typography>
                  <LinearProgress sx={{ mt: 1 }} />
                </Box>
              )}
              {loading && progress && (
                <Box>
                  <Stack direction="row" spacing={1} justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                      {progress.phase}
                      {progress.batch ? ` · ${progress.batch}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {progress.entries.toLocaleString()} tx · {progress.pages} pages
                    </Typography>
                  </Stack>
                  <LinearProgress sx={{ mt: 1 }} />
                </Box>
              )}
              {validation && (
                <Box>
                  <Divider sx={{ my: 2 }} />
                  <Stack spacing={1}>
                    {validation.errors.length > 0 && (
                      <Box>
                        <Typography variant="subtitle2" color="error">
                          Validation errors
                        </Typography>
                        {validation.errors.map((err, idx) => (
                          <Typography key={`${err}-${idx}`} variant="body2" color="error">
                            {err}
                          </Typography>
                        ))}
                      </Box>
                    )}
                    {validation.warnings.length > 0 && (
                      <Box>
                        <Typography variant="subtitle2" color="warning.main">
                          Warnings
                        </Typography>
                        {validation.warnings.map((warn, idx) => (
                          <Typography key={`${warn}-${idx}`} variant="body2" color="warning.main">
                            {warn}
                          </Typography>
                        ))}
                      </Box>
                    )}
                    {blockStart && blockEnd && batches.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Built {batches.reduce((sum, batch) => sum + batch.entries.length, 0)}{' '}
                        entries across {batches.length} batch(es) for blocks {blockStart}-{blockEnd}
                        .
                      </Typography>
                    )}
                  </Stack>
                </Box>
              )}
            </Stack>
          </Paper>
        </Collapse>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 }, mt: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
              Stats overview
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Aggregated metrics across all published index batches with QORT flow, QDN, and asset
              activity leaderboards.
            </Typography>
            {!statsOverview ? (
              <Typography variant="body2" color="text.secondary">
                No aggregated overview published yet.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                {overviewGroups.map((group) => (
                  <Paper
                    key={group.title}
                    elevation={0}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                    }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      {group.title}
                    </Typography>
                    {group.items.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No data yet.
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        {group.kind === 'amount'
                          ? group.items.slice(0, MAX_TOP_ACCOUNTS).map((item, idx) => (
                              <Stack
                                key={item.address}
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                              >
                                <MuiLink
                                  component={Link}
                                  to={`/xqlore/accounts/${item.address}`}
                                  underline="hover"
                                >
                                  #{idx + 1} - {formatAccountLabel(item)}
                                </MuiLink>
                                <Typography variant="body2">
                                  {formatNumber(item.amount)} QORT
                                </Typography>
                              </Stack>
                            ))
                          : group.items.slice(0, MAX_TOP_ACCOUNTS).map((item, idx) => (
                              <Stack
                                key={item.address}
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                              >
                                <MuiLink
                                  component={Link}
                                  to={`/xqlore/accounts/${item.address}`}
                                  underline="hover"
                                >
                                  #{idx + 1} - {formatAccountLabel(item)}
                                </MuiLink>
                                <Typography variant="body2">{formatNumber(item.count)}</Typography>
                              </Stack>
                            ))}
                      </Stack>
                    )}
                  </Paper>
                ))}
              </Box>
            )}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default XqloreStatsPage;
