import { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, Paper } from '@mui/material';
import { useParams } from 'react-router-dom';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../bootstrap/assetsBootstrap';
import AssetTransactions from '../components/asset/AssetTransactions';
import AssetHolders from '../components/asset/AssetHolders';
import ActionsToolbar from '../components/asset/ActionsToolbar';

export default function AssetDataPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const id = Number(assetId);

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string>('');
  const [divisible, setDivisible] = useState(true);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        setLoading(true);
        let mini = readAssetsIndexSync()?.[id] ?? null;
        if (!mini) {
          const idx = await ensureAssetsIndexLoaded();
          mini = idx?.[id] ?? null;
        }
        if (!mini) mini = await ensureAssetMini(id);
        if (!stop) {
          setName(mini?.name || `#${id}`);
          setDivisible(Boolean(mini?.isDivisible ?? true));
        }
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [id]);

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        display: 'grid',
        gap: 2,
        width: '100%',
        maxWidth: '100%',
        overflowX: 'hidden',
      }}
    >
      <Box
        display="flex"
        alignItems="baseline"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
      >
        <Typography variant="h5">{name} — Asset Data</Typography>
      </Box>

      <ActionsToolbar assetId={id} assetName={name} />

      {loading ? (
        <Paper sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <AssetHolders assetId={id} assetName={name} divisible={divisible} />
          <AssetTransactions assetId={id} assetName={name} divisible={divisible} />
        </Box>
      )}
    </Box>
  );
}
