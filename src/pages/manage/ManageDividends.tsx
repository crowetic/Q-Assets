import * as React from 'react';
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  TextField,
  Chip,
  CircularProgress,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { useFetchTracker } from '../../state/global/fetchTracker';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../../bootstrap/assetsBootstrap';

type IssuedAsset = {
  id: number;
  name: string;
  isDivisible: boolean;
};

// Minimal shape we actually read from "mini"
type MinimalMini = { name?: string; isDivisible?: boolean };

export default function ManageDividends() {
  const { address: myAddress, authenticateUser } = useAuth();
  const { track } = useFetchTracker();
  const busyWhile = React.useCallback(
    async <T,>(fn: () => Promise<T> | T, label: string) => track(Promise.resolve().then(fn), label),
    [track]
  );
  const [assets, setAssets] = React.useState<IssuedAsset[]>([]);
  const [q, setQ] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const navigate = useNavigate();

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        if (!myAddress) authenticateUser();
        if (!myAddress) return;

        await busyWhile(async () => {
          // 1) get assetIds issued by me
          const issues =
            (await qortalRequest({
              action: 'SEARCH_TRANSACTIONS',
              txGroupId: 0,
              address: myAddress,
              txType: ['ISSUE_ASSET'],
              confirmationStatus: 'CONFIRMED',
              limit: 1000,
              offset: 0,
              reverse: true,
            }).catch(() => [])) || [];

          const assetIds: number[] = Array.from(
            new Set(
              issues
                .map((tx: any) => Number(tx?.assetId ?? tx?.assetIdIssued ?? tx?.assetIdCreated))
                .filter((n: any) => Number.isFinite(n))
            )
          );

          // 2) ensure index and mini info
          const idx = (await ensureAssetsIndexLoaded()) ?? readAssetsIndexSync() ?? {};
          const out: IssuedAsset[] = [];

          for (const id of assetIds) {
            // NOTE: do not assign null — keep possibly undefined and guard
            let mini: MinimalMini | undefined = (idx as Record<number, MinimalMini | undefined>)[
              id
            ];
            if (!mini) {
              mini = (await ensureAssetMini(id).catch(() => undefined)) as MinimalMini | undefined;
            }
            if (!mini) continue; // skip if we still don't have it

            out.push({
              id,
              name: mini.name || `#${id}`,
              isDivisible: Boolean(mini.isDivisible ?? true),
            });
          }

          // sort by id desc then name
          out.sort((a, b) => b.id - a.id || a.name.localeCompare(b.name));
          if (alive) setAssets(out);
        }, 'blocking:manage:dividends:list');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [myAddress, authenticateUser, busyWhile]);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return assets;
    return assets.filter((a) => a.name.toLowerCase().includes(s) || String(a.id).includes(s));
  }, [assets, q]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: 1000 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
          Dividends — Select Asset
        </Typography>
        <Button component={RouterLink} to="/manage" variant="text">
          ← Back to Manage
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Filter assets"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ width: { xs: '100%', sm: 360 } }}
        />
      </Stack>

      {loading ? (
        <Paper variant="outlined" sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Paper>
      ) : filtered.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography>No issued assets found for your account.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25}>
          {filtered.map((a) => (
            <Paper
              key={a.id}
              variant="outlined"
              sx={{
                p: { xs: 1.25, sm: 2 },
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ lineHeight: 1.2 }}>
                  {a.name}{' '}
                  <Chip
                    size="small"
                    label={a.isDivisible ? 'Divisible' : 'Indivisible'}
                    sx={{ ml: 1 }}
                  />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Asset #{a.id}
                </Typography>
              </Box>
              <Box>
                <Button variant="contained" onClick={() => navigate(`/manage/dividends/${a.id}`)}>
                  Select
                </Button>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
