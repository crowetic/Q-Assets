import { useEffect, useState } from 'react';
import { getAllAssets, getAssetBalances } from '../utils/qortalAssetRequests';
import { Typography, Paper, CircularProgress, useTheme, Box } from '@mui/material';
import { Link } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { getPrimaryAccountName } from '../utils/qortalApi';
import pLimit from 'p-limit';
import { ensureAssetsIndexLoaded } from '../bootstrap/assetsBootstrap';

export interface Asset {
  assetId: number;
  name: string;
  description?: string;
  owner: string;
  quantity: number;
  isDivisible: boolean;
  isUnspendable: boolean;
}

export interface BalanceEntry {
  assetId: number;
  address: string;
  balance: string; // Balance comes back normalized already!
  assetName: string;
}

export interface EnrichedAsset extends Asset {
  totalSupply: number;
  circulating: number;
}

const AssetExplorer = () => {
  const [assets, setAssets] = useState<EnrichedAsset[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});

  const theme = useTheme();
  const { address: userAddress } = useAuth();

  useEffect(() => {
    async function loadAssets() {
      try {
        setLoading(true);
        const assetIndex = await ensureAssetsIndexLoaded();
        const rawAssets: Asset[] = Object.values(assetIndex) as Asset[];
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

        const limit = pLimit(6); // max 6 concurrent promises

        const avatarEntries: [number, string | null][] = await Promise.all(
          enriched.map((a) =>
            limit(async (): Promise<[number, string | null]> => {
              try {
                if (a.name == 'QORT' || a.name == 'QORT-from-QORA' || a.name == 'Legacy-QORA') {
                  const url = await fetchAssetAvatar('Q-Assets', a.name);
                  return [a.assetId, url ?? null];
                }

                const issuerName = await getPrimaryAccountName(a.owner);
                if (!issuerName) return [a.assetId, null];

                const dataUrl = await fetchAssetAvatar(issuerName, a.name);
                return [a.assetId, dataUrl ?? null];
              } catch {
                return [a.assetId, null];
              }
            })
          )
        );

        setAvatarMap(Object.fromEntries(avatarEntries));
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
                  <Box
                    display="flex"
                    flexDirection={{ xs: 'column', sm: 'column', md: 'column', lg: 'row' }}
                    gap={1}
                  >
                    {/* TEXT BLOCK */}
                    <Box
                      flex={1}
                      alignItems={'center'}
                      alignContent={'center'}
                      justifyContent={'space-evenly'}
                    >
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
                        width: '12rem',
                        height: '12rem',
                        flexShrink: 0,
                        display: { xs: 'none', sm: 'block' },
                        alignSelf: 'center',
                      }}
                    >
                      {avatarMap[asset.assetId] ? (
                        <img
                          src={avatarMap[asset.assetId]!}
                          alt={`${asset.name} Avatar`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            borderRadius: 4,
                          }}
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                      ) : (
                        <img
                          src="/asset-placeholder.svg" // or a tiny inline SVG/emoji/etc.
                          alt="No avatar"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            opacity: 0.5,
                          }}
                        />
                      )}
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
