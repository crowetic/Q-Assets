import { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography, CircularProgress, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import pLimit from 'p-limit';

import { ensureAssetsIndexLoaded, readAssetsIndexSync } from '../bootstrap/assetsBootstrap';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { colorFromAssetId } from '../utils/marketUI';
import { makeAssetFallbackAvatar } from '../utils/assetAvatarFallback';

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

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        r.description?.toLowerCase().includes(s) ||
        String(r.assetId).includes(s)
    );
  }, [rows, q]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, display: 'grid', gap: 2 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        gap={2}
        flexWrap="wrap"
      >
        <Typography variant="h5">Markets (QORT Pairs)</Typography>
        <TextField
          size="small"
          placeholder="Search assets…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Box>

      {loading && rows.length === 0 ? (
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
            <span>Asset</span>
            <span>Pair</span>
            <span>Actions</span>
          </Box>

          {filtered.map((r) => {
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
                      src="/img/asset-placeholder.svg"
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
                    #{r.assetId} • {r.isDivisible ? 'Divisible' : 'Whole'}
                  </Typography>
                </Box>

                <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
                  <Typography variant="body2">Pair: {r.name}/QORT</Typography>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
