import * as React from 'react';
import { Box, Paper, Typography, TextField, CircularProgress, Stack, Chip } from '@mui/material';
import { useAuth } from 'qapp-core';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../bootstrap/assetsBootstrap';
import NewsPublisher from '../components/news/NewsPublisher';

type IssuedAsset = {
  id: number;
  name: string;
  isDivisible: boolean;
};

type MinimalMini = { name?: string; isDivisible?: boolean };

export default function PublishAssetNewsPage() {
  const { address: myAddress, authenticateUser } = useAuth();
  const [assets, setAssets] = React.useState<IssuedAsset[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        if (!myAddress) authenticateUser();
        if (!myAddress) return;

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

        const idx = (await ensureAssetsIndexLoaded()) ?? readAssetsIndexSync() ?? {};
        const out: IssuedAsset[] = [];

        for (const id of assetIds) {
          let mini: MinimalMini | undefined = (idx as Record<number, MinimalMini | undefined>)[id];
          if (!mini) {
            mini = (await ensureAssetMini(id).catch(() => undefined)) as MinimalMini | undefined;
          }
          if (!mini) continue;

          out.push({
            id,
            name: mini.name || `#${id}`,
            isDivisible: Boolean(mini.isDivisible ?? true),
          });
        }

        out.sort((a, b) => b.id - a.id || a.name.localeCompare(b.name));
        if (alive) setAssets(out);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [myAddress, authenticateUser]);

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((a) => a.name.toLowerCase().includes(term) || String(a.id).includes(term));
  }, [assets, query]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: 1100 }}>
      <Typography variant="h4" sx={{ mb: 1, textAlign: 'center' }}>
        Publish Asset News
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
        Select one of your issued assets and publish news directly from here.
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Filter assets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: { xs: '100%', sm: 320 } }}
        />
      </Stack>

      {loading ? (
        <Paper variant="outlined" sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Paper>
      ) : filtered.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary" textAlign="center">
            No issued assets found for your account.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((asset) => (
            <Paper
              key={asset.id}
              variant="outlined"
              sx={{
                p: { xs: 1.25, sm: 2 },
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ lineHeight: 1.2 }}>
                  {asset.name}
                  <Chip size="small" label={`Asset #${asset.id}`} sx={{ ml: 1 }} color="info" />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {asset.isDivisible ? 'Divisible' : 'Indivisible'} asset
                </Typography>
              </Box>
              <NewsPublisher
                assetId={asset.id}
                assetName={asset.name}
                isIssuer
                onPublished={() => undefined}
              />
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
