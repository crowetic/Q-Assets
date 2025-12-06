import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography, CircularProgress, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import pLimit from 'p-limit';

import { ensureAssetsIndexLoaded, readAssetsIndexSync } from '../bootstrap/assetsBootstrap';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { colorFromAssetId } from '../utils/marketUI';
import { makeAssetFallbackAvatar } from '../utils/assetAvatarFallback';
import { fetchQortVolumeLastN } from '../explorerStats/fetchers';
import { TRADE_FETCH_N } from '../explorerStats/types';
import { useTheme } from '@mui/material';
import { useMemberGroupIds } from '../hooks/useMemberGroupIds';
import { canViewAsset, getAssetPrivacy, type AssetPrivacy } from '../utils/assetPrivacy';

type Row = {
  assetId: number;
  name: string;
  owner: string;
  isDivisible: boolean;
  isUnspendable: boolean;
  description?: string;
  avatar?: string | null;
};

export default function TradeMarkets() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  type VolInfo = { sum: number; count: number; ts: number };
  const VOL_TTL_MS = 10 * 60 * 1000;
  const theme = useTheme();
  const { memberGroupIds, loading: groupsLoading } = useMemberGroupIds();
  const [privacyMap, setPrivacyMap] = useState<Record<string, AssetPrivacy>>({});

  const [volumes, setVolumes] = useState<Record<number, VolInfo>>({});
  const [sortKey, setSortKey] = useState<'volume' | 'name' | 'assetId'>('volume');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const readVolCache = (): Record<number, VolInfo> => {
    try {
      return JSON.parse(localStorage.getItem('marketVolumes') || '{}');
    } catch {
      return {};
    }
  };
  const writeVolCache = (m: Record<number, VolInfo>) => {
    try {
      localStorage.setItem('marketVolumes', JSON.stringify(m));
    } catch {
      /* empty */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // try sync for instant paint
        const syncIdx = readAssetsIndexSync();
        if (syncIdx && !cancelled) {
          setRows(
            Object.values(syncIdx)
              .filter((a) => a.assetId > 2 && !a.isUnspendable) // skip 0–2 and unspendable
              .map((a) => ({ ...a, avatar: null }))
          );
        }

        const idx = await ensureAssetsIndexLoaded();
        if (cancelled) return;
        const baseRows: Row[] = Object.values(idx)
          .filter((a) => a.assetId > 2 && !a.isUnspendable)
          .map((a) => ({ ...a, avatar: null }));

        // parallel avatar hints (best-effort)
        const limit = pLimit(6);
        const withAvatars = await Promise.all(
          baseRows.map((r) =>
            limit(async () => {
              try {
                // Special built-ins from project namespace
                if (
                  r.assetId === 0 ||
                  r.name === 'QORT' ||
                  r.name === 'QORT-from-QORA' ||
                  r.name === 'Legacy-QORA'
                ) {
                  const url = await fetchAssetAvatar('Q-Assets', r.name).catch(() => null);
                  return { ...r, avatar: url ?? makeAssetFallbackAvatar(r.assetId, r.name, 80) };
                }

                const issuerName = await getPrimaryAccountName(r.owner).catch(() => '');
                if (!issuerName) {
                  return { ...r, avatar: makeAssetFallbackAvatar(r.assetId, r.name, 80) };
                }

                const url = await fetchAssetAvatar(issuerName, r.name).catch(() => null);
                return { ...r, avatar: url ?? makeAssetFallbackAvatar(r.assetId, r.name, 80) };
              } catch {
                return { ...r, avatar: makeAssetFallbackAvatar(r.assetId, r.name, 80) };
              }
            })
          )
        );

        setRows(withAvatars);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const keyFor = (id: number) =>
      `${id}:${memberGroupIds
        .slice()
        .sort((a, b) => a - b)
        .join(',')}`;
    const missing = rows.filter((r) => r.assetId > 2 && !privacyMap[keyFor(r.assetId)]);
    if (!missing.length) return;
    let cancelled = false;
    const limit = pLimit(6);
    (async () => {
      const results = await Promise.all(
        missing.map((r) =>
          limit(async () => {
            const priv = await getAssetPrivacy(r.assetId, memberGroupIds);
            return [keyFor(r.assetId), priv] as const;
          })
        )
      );
      if (cancelled) return;
      setPrivacyMap((prev) => {
        const next = { ...prev };
        for (const [key, priv] of results) next[key] = priv;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, privacyMap]);

  const keyFor = useCallback(
    (id: number) =>
      `${id}:${memberGroupIds
        .slice()
        .sort((a, b) => a - b)
        .join(',')}`,
    [memberGroupIds]
  );

  useEffect(() => {
    let cancelled = false;
    if (rows.length === 0) return;

    (async () => {
      const cache = readVolCache();
      const now = Date.now();
      const limit = pLimit(6);

      // Which assets actually need fetching?
      const pending = rows
        .map((r) => r.assetId)
        .filter((id) => id > 2)
        .filter((id) => !(cache[id] && now - cache[id].ts < VOL_TTL_MS));

      if (pending.length === 0) {
        if (!cancelled) setVolumes(cache);
        return;
      }

      const fetched = await Promise.all(
        pending.map((id) =>
          limit(async () => {
            try {
              const { qortSum, count } = await fetchQortVolumeLastN(id, TRADE_FETCH_N); // same fetcher as Explorer
              return [id, { sum: qortSum, count, ts: now }] as const;
            } catch {
              return [id, { sum: 0, count: 0, ts: now }] as const;
            }
          })
        )
      );

      const next = { ...cache };
      for (const [id, v] of fetched) next[id] = v;

      writeVolCache(next);
      if (!cancelled) setVolumes(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [rows]);

  const viewableRows = useMemo(() => {
    return rows.filter((r) => {
      if (r.assetId <= 2) return false; // should not appear anyway
      const privacy = privacyMap[keyFor(r.assetId)];
      if (!privacy) return false;
      return canViewAsset(privacy, memberGroupIds);
    });
  }, [rows, privacyMap, memberGroupIds]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return viewableRows;
    return viewableRows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        r.description?.toLowerCase().includes(s) ||
        String(r.assetId).includes(s)
    );
  }, [viewableRows, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'volume') {
        const av = volumes[a.assetId]?.sum ?? 0;
        const bv = volumes[b.assetId]?.sum ?? 0;
        cmp = av === bv ? 0 : av < bv ? -1 : 1;
      } else if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else {
        // assetId
        cmp = a.assetId - b.assetId;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, volumes, sortKey, sortDir]);

  return (
    <>
      <Box sx={{ p: { xs: 2, md: 3 }, display: 'grid', gap: 2 }}>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          gap={2}
          flexWrap="wrap"
        >
          <Typography variant="h5">Markets (QORT Pairs)</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Search assets…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <TextField
              select
              // SelectProps={{ native: true }}
              size="small"
              label="Sort by"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              sx={{ minWidth: 140 }}
            >
              <option value="volume">QORT Volume</option>
              <option value="name">Name</option>
              <option value="assetId">Asset ID</option>
            </TextField>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                borderWidth: '0.1rem',
                borderStyle: 'dotted',
                borderColor: theme.palette.text.secondary,
                border: theme.palette.info.dark,
                color: theme.palette.primary.contrastText,
                background: 'transparent',
                cursor: 'pointer',
              }}
              title={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortDir === 'asc' ? 'Asc ↑' : 'Desc ↓'}
            </button>
          </Box>
        </Box>

        {(loading || groupsLoading) && viewableRows.length === 0 ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 1,
            }}
          >
            {/* header-ish */}
            <Box
              sx={{
                display: { xs: 'none', sm: 'grid' },
                gridTemplateColumns: 'auto 1fr auto',
                px: 1,
                py: 0.5,
                color: 'text.secondary',
              }}
            >
              {/* <span>Asset</span>
              <span>Pair</span>
              <span>Actions</span> */}
            </Box>

            {sorted.map((r) => {
              const c = colorFromAssetId(r.assetId);
              return (
                <Paper
                  key={r.assetId}
                  onClick={() => navigate(`/trade/${r.assetId}`)}
                  sx={{
                    p: 1,
                    display: 'grid',
                    gridTemplateColumns: { xs: 'auto 1fr', sm: 'auto 1fr auto' },
                    alignItems: 'center',
                    gap: 1.25,
                    borderLeft: `4px solid ${c.border}`,
                    bgcolor: c.tint,
                    transition: 'background-color .12s ease, transform .1s ease',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: c.tintHover, transform: 'translateY(-1px)' },
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'background.default',
                    }}
                  >
                    {r.avatar ? (
                      <img
                        src={r.avatar}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                          // swap to synthesized fallback if whatever we had fails
                          const fallback = makeAssetFallbackAvatar(r.assetId, r.name, 80);
                          if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                        }}
                      />
                    ) : (
                      <img
                        src="/src/core-assets/asset-placeholder.svg"
                        alt=""
                        loading="lazy"
                        style={{ width: '70%', height: '70%', opacity: 0.6 }}
                      />
                    )}
                  </Box>

                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap title={r.name}>
                      {r.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      Asset {r.assetId} • {r.isDivisible ? 'Divisible' : 'Whole'}
                    </Typography>
                  </Box>

                  <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
                    {(() => {
                      const vol = volumes[r.assetId]?.sum ?? 0;
                      const cnt = volumes[r.assetId]?.count ?? 0;

                      return (
                        <>
                          <Typography variant="body2">
                            QORT Vol:{' '}
                            {vol > 0
                              ? vol.toLocaleString(undefined, { maximumFractionDigits: 8 })
                              : 'no trades'}
                          </Typography>
                          {cnt > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              {cnt} trades
                            </Typography>
                          )}
                        </>
                      );
                    })()}
                  </Box>
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>
    </>
  );
}
