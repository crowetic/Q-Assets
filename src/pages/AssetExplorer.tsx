import { useEffect, useState } from 'react';
import { getAllAssets, getAssetBalances } from '../utils/qortalAssetRequests';
import { Typography, Paper, CircularProgress, useTheme, Box } from '@mui/material';
import { Link } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { formatAssetAmount } from '../utils/qortalAssetRequests';

export interface Asset {
  assetId: number;
  name: string;
  description?: string;
  owner: string;
  quantity: number;
  isDivisible: boolean;
  isUnspendable: boolean;
}

interface BalanceEntry {
  assetId: number;
  address: string;
  balance: string; // Balance comes back normalized already!
  assetName: string;
}

interface EnrichedAsset extends Asset {
  totalSupply: number;
  circulating: number;
}

const AssetExplorer = () => {
  const [assets, setAssets] = useState<EnrichedAsset[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  const theme = useTheme();
  const { address: userAddress } = useAuth();

  useEffect(() => {
    async function loadAssets() {
      try {
        const rawAssets: Asset[] = await getAllAssets(true, 0, 0);
        const qortCirculating = await fetch('/stats/supply/circulating').then((res) => res.json());
        const assetIds: number[] = rawAssets.map((a) => a.assetId);
        const issuerAddresses: string[] = [...new Set(rawAssets.map((a) => a.owner))];
        localStorage.setItem('allAssets', JSON.stringify(rawAssets));

        const [userBalancesRaw, issuerBalancesRaw]: [BalanceEntry[], BalanceEntry[]] =
          await Promise.all([
            userAddress
              ? getAssetBalances({ addresses: [userAddress], assetIds, excludeZero: true })
              : Promise.resolve([]),
            getAssetBalances({ addresses: issuerAddresses, assetIds }),
          ]);

        // Normalize user balances
        const balanceMap: Record<number, number> = {};
        userBalancesRaw.forEach((b) => {
          balanceMap[b.assetId] = parseFloat(b.balance);
        });

        // Normalize issuer balances (per asset, summed)
        const issuerMap: Record<number, number> = {};
        issuerBalancesRaw.forEach((b: BalanceEntry) => {
          issuerMap[b.assetId] = (issuerMap[b.assetId] || 0) + parseFloat(b.balance);
        });

        const enriched: EnrichedAsset[] = rawAssets.map((asset) => {
          const isQort = asset.assetId === 0;
          const isUnspendable = asset.isUnspendable || asset.quantity === 0;

          if (isQort) {
            return {
              ...asset,
              totalSupply: qortCirculating,
              circulating: qortCirculating,
            };
          }

          if (isUnspendable) {
            return {
              ...asset,
              totalSupply: 'special base asset',
              circulating: 'coming soon',
            };
          }

          const totalSupply = asset.quantity / 1e8;
          const issuerBalance = issuerMap[asset.assetId] ?? 0;
          const circulating = Math.max(0, totalSupply - issuerBalance);

          // Debug logs
          console.log(
            `[Asset ${asset.assetId}] Total: ${totalSupply}, Issuer: ${issuerBalance}, Circulating: ${circulating}`
          );

          return {
            ...asset,
            totalSupply,
            circulating,
          };
        });

        setAssets(enriched);
        localStorage.setItem('allAssets', JSON.stringify(enriched));
        setBalances(balanceMap);
      } catch (err) {
        console.error('Asset load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadAssets();
  }, [userAddress]);

  return (
    <Box sx={{ padding: '2rem' }}>
      {/* <Typography variant="h3" align="center" gutterBottom>
        All Assets
      </Typography> */}

      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <Box
          display="grid"
          gridTemplateColumns={{
            xs: '1fr',
            sm: '1fr 1fr',
            md: '1fr 1fr 1fr',
          }}
          gap={3}
        >
          {assets.map((asset) => {
            const balance = balances[asset.assetId] || 0;
            const isOwned = userAddress && asset.owner === userAddress;

            return (
              <Link
                key={asset.assetId}
                to={`/assets/${asset.assetId}`}
                style={{ textDecoration: 'none' }}
              >
                <Paper
                  elevation={5}
                  sx={{
                    padding: '1.5rem',
                    height: '100%',
                    backgroundColor: isOwned
                      ? theme.palette.secondary.dark
                      : balance > 0
                        ? theme.palette.primary.dark
                        : theme.palette.background.paper,
                    color:
                      isOwned || balance > 0
                        ? theme.palette.getContrastText(
                            isOwned ? theme.palette.secondary.dark : theme.palette.primary.dark
                          )
                        : theme.palette.text.primary,
                    borderLeft: isOwned
                      ? '4px solid limegreen'
                      : balance > 0
                        ? '4px solid #1e90ff'
                        : '4px solid transparent',
                    transition: 'transform 0.2s ease',
                    '&:hover': {
                      transform: 'scale(1.03)',
                      cursor: 'pointer',
                    },
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={2}>
                    {/* TEXT BLOCK */}
                    <Box flex={1}>
                      <Typography variant="h4" fontWeight="bold" color="secondary.light">
                        {asset.name}
                      </Typography>

                      <Typography variant="body2" sx={{ mb: 2 }}>
                        {asset.description || 'No description'}
                      </Typography>

                      <Box
                        component="div"
                        sx={{
                          p: 0.5,
                          fontFamily: 'monospace',
                          bgcolor: theme.palette.secondary.main,
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 1,
                          fontSize: '0.875rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          mb: 1,
                        }}
                      >
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary" component="span">
                            Asset ID:{' '}
                          </Typography>
                          <Typography component="span">{asset.assetId}</Typography>
                        </Box>

                        <Box>
                          <Typography variant="subtitle2" color="text.secondary" component="span">
                            Total Supply:{' '}
                          </Typography>
                          <Typography component="span">
                            {formatAssetAmount(asset.totalSupply, asset.isDivisible)}
                          </Typography>
                        </Box>

                        <Box>
                          <Typography variant="subtitle2" color="text.secondary" component="span">
                            Circulating:{' '}
                          </Typography>
                          <Typography component="span">
                            {formatAssetAmount(asset.circulating, asset.isDivisible)}
                          </Typography>
                        </Box>

                        {balance > 0 && (
                          <Box>
                            <Typography
                              variant="subtitle1"
                              color="secondary.light"
                              component="span"
                            >
                              You Hold:{' '}
                            </Typography>
                            <Typography component="span" color="primary.light">
                              {balance}
                            </Typography>
                          </Box>
                        )}
                      </Box>

                      {isOwned && (
                        <Typography variant="body2" fontStyle="italic" color="limegreen">
                          ASSET ISSUER
                        </Typography>
                      )}
                    </Box>

                    {/* ASSET AVATAR */}
                    <Box
                      sx={{
                        width: 64,
                        height: 64,
                        flexShrink: 0,
                        display: { xs: 'none', sm: 'block' },
                        alignSelf: 'flex-start',
                      }}
                    >
                      <img
                        src={`/_media/${asset.name}/assetAvatar.png`}
                        alt={`${asset.name} Avatar`}
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          borderRadius: 4,
                        }}
                      />
                    </Box>
                  </Box>
                </Paper>
              </Link>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default AssetExplorer;
