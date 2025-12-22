import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../portfolio/PortfolioProvider';
import {
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
  CircularProgress,
  IconButton,
} from '@mui/material';
import { Delete } from '@mui/icons-material';
import { useAuth } from 'qapp-core';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { getPrimaryAccountName } from '../utils/qortalApi';
import pLimit from 'p-limit';
import PortfolioWallet from '../portfolio/PortfolioWallet';
import type { Wallet } from '../portfolio/portfolioTypes';
import { base64ToObject, objectToBase64 } from '../utils/data';
import { getAllAccountNames } from '../utils/qortalApi';
import { searchSimpleByIdentifierPrefix, type SimpleHit } from '../utils/searchSimple';
import { useQdnBatchPublisher } from '../utils/useQdnBatchPublisher';
// import { addPrivateMagic } from '../constants/qdeckIdentifiers';

const SAVED_SET_STORAGE_KEY = 'qa_portfolio_saved_wallet_sets';

type SavedWalletSet = {
  id: string;
  name: string;
  wallets: Wallet[];
  savedAt: number;
};

const normalizeStoredWallet = (raw: any): Wallet | null => {
  if (!raw || typeof raw !== 'object') return null;
  const address = typeof raw.address === 'string' ? raw.address.trim() : '';
  if (!address) return null;
  return {
    address,
    label: typeof raw.label === 'string' && raw.label ? raw.label : undefined,
    name: typeof raw.name === 'string' && raw.name ? raw.name : undefined,
  };
};

const normalizeStoredSet = (raw: any): SavedWalletSet | null => {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const walletsRaw = Array.isArray(raw.wallets) ? raw.wallets : [];
  const wallets = walletsRaw
    .map((w: Wallet) => normalizeStoredWallet(w))
    .filter((w: Wallet): w is Wallet => Boolean(w));
  if (!wallets.length) return null;

  const savedAt =
    typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now();
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  return { id, name, wallets, savedAt };
};

const normalizeNameForComparison = (value?: string | null) => (value || '').trim().toLowerCase();

const isPrivateServiceName = (service?: string) =>
  typeof service === 'string' && service.toUpperCase().endsWith('_PRIVATE');

const getHitTimestamp = (hit: SimpleHit) => Number(hit.updated ?? hit.created ?? 0) || 0;

async function fetchAndDecodePublishedSets(
  hit: SimpleHit
): Promise<{ sets: SavedWalletSet[]; owner?: string; savedAt?: number } | null> {
  if (!hit.name || !hit.identifier) return null;
  const service = hit.service ?? 'DOCUMENT_PRIVATE';
  const response = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    name: hit.name,
    service,
    identifier: hit.identifier,
    encoding: 'base64',
  });
  const rawBase64 =
    typeof response === 'string'
      ? response
      : response && typeof response === 'object'
        ? (response.data64 ?? response.base64 ?? '')
        : '';
  if (!rawBase64 || typeof rawBase64 !== 'string') {
    throw new Error('Failed to load published saved sets.');
  }

  let clear64 = rawBase64;
  if (isPrivateServiceName(service)) {
    const decrypted = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: rawBase64,
    });
    if (!decrypted || typeof decrypted !== 'string') {
      throw new Error('Failed to decrypt published saved sets.');
    }
    clear64 = decrypted;
  }

  const payload = base64ToObject(clear64);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Published saved sets payload is invalid.');
  }

  const setsRaw = Array.isArray(payload.sets) ? payload.sets : [];
  const sets = setsRaw
    .map((raw: SavedWalletSet) => normalizeStoredSet(raw))
    .filter((set: SavedWalletSet): set is SavedWalletSet => Boolean(set));
  if (!sets.length) return null;

  return {
    sets,
    owner: typeof payload.owner === 'string' ? payload.owner : undefined,
    savedAt: Number(payload.savedAt ?? 0) || undefined,
  };
}

const QA_PORTFOLIO_QDN_PREFIX = 'qa_portfolio_saved_sets';

const buildSavedSetsIdentifier = (address: string) =>
  `${QA_PORTFOLIO_QDN_PREFIX}__${address.toLowerCase()}`;

const encryptForPublicKey = async (data64: string, publicKey: string) => {
  const encrypted: string | null = await qortalRequest({
    action: 'ENCRYPT_DATA',
    base64: data64,
    publicKeys: [publicKey],
  });
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Failed to encrypt saved tracked sets.');
  }
  return encrypted;
};
export default function PortfolioPage() {
  const {
    wallets,
    assetsIndex,
    holdings,
    loading,
    error,
    addWalletByNameOrAddress,
    removeWallet,
    refreshHoldings,
    setWallets,
  } = usePortfolio();

  const [newAddr, setNewAddr] = useState('');
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [authName, setAuthName] = useState<string | null>(null);
  const trackedSet = useMemo(() => new Set(wallets.map((w) => w.address)), [wallets]);
  const [savedSets, setSavedSets] = useState<SavedWalletSet[]>([]);
  const [saveSetName, setSaveSetName] = useState('');
  const [savingSet, setSavingSet] = useState(false);
  const [savedSetMsg, setSavedSetMsg] = useState<string | null>(null);
  const [publishingSets, setPublishingSets] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [remotePublishedSets, setRemotePublishedSets] = useState<SavedWalletSet[]>([]);
  const [remotePublishedMeta, setRemotePublishedMeta] = useState<{
    publisher: string;
    owner?: string;
    ts: number;
  } | null>(null);
  const [remotePublishedLoading, setRemotePublishedLoading] = useState(false);
  const [remotePublishedError, setRemotePublishedError] = useState<string | null>(null);
  const { publish } = useQdnBatchPublisher();

  const {
    address: authAddress,
    publicKey: authPublicKey,
    name: userName,
    authenticateUser,
  } = useAuth();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map(normalizeStoredSet)
        .filter((set): set is SavedWalletSet => Boolean(set));
      if (normalized.length) setSavedSets(normalized);
    } catch {
      setSavedSets([]);
    }
  }, []);

  const persistSavedSets = (next: SavedWalletSet[]) => {
    try {
      localStorage.setItem(SAVED_SET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setSavedSets(next);
  };

  useEffect(() => {
    if (!authAddress) {
      setRemotePublishedSets([]);
      setRemotePublishedMeta(null);
      setRemotePublishedError(null);
      setRemotePublishedLoading(false);
      return;
    }

    let cancelled = false;

    const loadPublishedSets = async () => {
      setRemotePublishedSets([]);
      setRemotePublishedMeta(null);
      setRemotePublishedError(null);
      setRemotePublishedLoading(true);

      try {
        const normalizedNames = new Set<string>();
        const addName = (value?: string | null) => {
          const normalized = normalizeNameForComparison(value);
          if (normalized) normalizedNames.add(normalized);
        };
        addName(userName);
        addName(authName);
        const accountNames = await getAllAccountNames(authAddress).catch(() => []);
        if (cancelled) return;
        if (Array.isArray(accountNames)) {
          accountNames.forEach(addName);
        }
        if (!normalizedNames.size) {
          setRemotePublishedError('Unable to determine which name owns published sets.');
          return;
        }

        const prefix = buildSavedSetsIdentifier(authAddress);
        const hits = await searchSimpleByIdentifierPrefix('DOCUMENT_PRIVATE', prefix);
        if (cancelled) return;

        const filtered = hits.filter((hit) => {
          const hitName = normalizeNameForComparison(hit.name);
          return hitName && normalizedNames.has(hitName);
        });

        if (!filtered.length) {
          return;
        }

        filtered.sort((a, b) => getHitTimestamp(b) - getHitTimestamp(a));
        const bestHit = filtered[0];
        const decoded = await fetchAndDecodePublishedSets(bestHit);
        if (!decoded) {
          setRemotePublishedError('Published saved sets could not be decoded.');
          return;
        }
        if (cancelled) return;

        setRemotePublishedSets(decoded.sets);
        setRemotePublishedMeta({
          publisher: bestHit.name ?? '',
          owner: decoded.owner,
          ts: decoded.savedAt ?? getHitTimestamp(bestHit),
        });
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch published saved sets', err);
        setRemotePublishedError(
          err instanceof Error ? err.message : 'Failed to fetch published saved sets.'
        );
      } finally {
        if (!cancelled) {
          setRemotePublishedLoading(false);
        }
      }
    };

    loadPublishedSets();

    return () => {
      cancelled = true;
    };
  }, [authAddress, userName, authName]);

  const handleSaveCurrentSet = () => {
    setPublishStatus(null);
    setPublishError(null);
    const name = saveSetName.trim();
    if (!name) {
      setSavedSetMsg('Provide a name before saving.');
      return;
    }
    if (!wallets.length) {
      setSavedSetMsg('Add at least one tracked wallet first.');
      return;
    }
    setSavingSet(true);
    try {
      const newSet: SavedWalletSet = {
        id: `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        wallets: wallets.map((w) => ({ ...w })),
        savedAt: Date.now(),
      };
      const nextSets = [newSet, ...savedSets.filter((set) => set.name !== name)];
      persistSavedSets(nextSets);
      setSaveSetName('');
      setSavedSetMsg(`Saved set "${name}".`);
    } finally {
      setSavingSet(false);
    }
  };

  const handleLoadSavedSet = (set: SavedWalletSet) => {
    setWallets(set.wallets.map((w) => ({ ...w })));
    setSavedSetMsg(`Loaded set "${set.name}".`);
    setPublishStatus(null);
    setPublishError(null);
  };

  const handleDeleteSavedSet = (id: string) => {
    const next = savedSets.filter((set) => set.id !== id);
    persistSavedSets(next);
    setSavedSetMsg('Saved set removed.');
    setPublishStatus(null);
    setPublishError(null);
  };

  const handleClearTracked = () => {
    setWallets([]);
    localStorage.setItem('qa_portfolio_skip_mine', '1');
    setSavedSetMsg('Tracked wallets cleared.');
    setPublishStatus(null);
    setPublishError(null);
  };

  const handlePublishSavedSets = async () => {
    setPublishStatus(null);
    setPublishError(null);
    if (!authAddress || !authPublicKey) {
      setPublishError('Sign in to publish saved sets.');
      return;
    }
    if (!savedSets.length) {
      setPublishError('No saved tracked sets to publish.');
      return;
    }
    setPublishingSets(true);
    try {
      const payload = {
        owner: authAddress,
        savedAt: Date.now(),
        sets: savedSets.map((set) => ({
          id: set.id,
          name: set.name,
          savedAt: set.savedAt,
          wallets: set.wallets.map((wallet) => ({
            address: wallet.address,
            label: wallet.label,
            name: wallet.name,
          })),
        })),
      };
      const base64 = await objectToBase64(payload);
      const encrypted = await encryptForPublicKey(base64, authPublicKey);
      await publish([
        {
          name: userName!,
          service: 'DOCUMENT_PRIVATE',
          identifier: buildSavedSetsIdentifier(authAddress),
          base64: encrypted,
        },
      ]);
      setPublishStatus('Saved sets published to QDN.');
    } catch (e: any) {
      setPublishError(e?.message || 'Failed to publish saved sets.');
    } finally {
      setPublishingSets(false);
    }
  };

  // Resolve primary name for authenticated account (for header prettiness)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authAddress) {
        authenticateUser();
        setAuthName(userName || authAddress);
        return;
      }
      try {
        if (userName) setAuthName(userName);
        if (!userName) {
          const n = await qortalRequest({ action: 'GET_PRIMARY_NAME', address: authAddress });
          if (!cancelled) setAuthName(typeof n === 'string' && n ? n : null);
        }
      } catch {
        if (!cancelled) setAuthName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authAddress]);

  // Progressive avatar load for assets present in holdings
  useEffect(() => {
    let cancelled = false;
    const limit = pLimit(4);
    const nameCache = new Map<string, string | null>();

    const getIssuer = async (addr: string) => {
      if (nameCache.has(addr)) return nameCache.get(addr)!;
      const n = await getPrimaryAccountName(addr).catch(() => null);
      nameCache.set(addr, n);
      return n;
    };

    const loadAvatars = async () => {
      const entries = await Promise.all(
        Object.keys(holdings).map(async (k) => {
          const assetId = Number(k);
          const meta = assetsIndex[assetId];

          if (!meta) return [assetId, null] as const;
          try {
            if (assetId == 0) {
              const url = await fetchAssetAvatar('Q-Assets', 'QORT');
              return [assetId, url ?? null] as const;
            } else if (assetId == 1) {
              const url = await fetchAssetAvatar('Q-Assets', 'Legacy-QORA');
              return [assetId, url ?? null] as const;
            } else if (assetId == 2) {
              const url = await fetchAssetAvatar('Q-Assets', 'QORT-from-QORA');
              return [assetId, url ?? null] as const;
            }
            const issuerName = await getIssuer(meta.owner);

            if (!issuerName) return [assetId, null] as const;
            const url = await limit(() => fetchAssetAvatar(issuerName, meta.name));

            return [assetId, url ?? null] as const;
          } catch {
            return [assetId, null] as const;
          }
        })
      );

      if (!cancelled) setAvatarMap(Object.fromEntries(entries));
    };

    if (Object.keys(holdings).length) loadAvatars();
    return () => {
      cancelled = true;
    };
  }, [holdings, assetsIndex]);

  // Keep holdings fresh when wallets change
  useEffect(() => {
    refreshHoldings();
  }, [wallets, refreshHoldings]);

  // ===== All tracked (existing) rows =====
  const rowsAll = useMemo(() => {
    return Object.values(holdings)
      .map((h) => {
        const meta = assetsIndex[h.assetId];
        if (!meta) return null;

        // sum only tracked wallets
        const totalTracked = Object.entries(h.perWallet).reduce((sum, [addr, amt]) => {
          return trackedSet.has(addr) ? sum + (amt as number) : sum;
        }, 0);

        if (totalTracked <= 0) return null;

        return {
          assetId: h.assetId,
          name: meta.name,
          isDivisible: meta.isDivisible,
          total: totalTracked,
        };
      })
      .filter(Boolean) as Array<{
      assetId: number;
      name: string;
      isDivisible: boolean;
      total: number;
    }>;
  }, [holdings, assetsIndex, trackedSet]);

  // Add tracked wallet (name or address)
  const onAdd = async () => {
    if (!newAddr) return;
    setAdding(true);
    setAddMsg(null);
    const ok = await addWalletByNameOrAddress(newAddr);
    setAdding(false);
    setAddMsg(ok ? 'Added' : 'Name/address not found');
    if (ok) setNewAddr('');
  };


  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        display: 'grid',
        gridAutoRows: 'min-content',
        gap: { xs: 2, md: 3 },
      }}
    >
      <PortfolioWallet
        authAddress={authAddress}
        authPublicKey={authPublicKey}
        authName={authName}
        assetsIndex={assetsIndex}
        holdings={holdings}
        avatarMap={avatarMap}
      />

      {/* ===== BELOW: Tracked wallets manager (left) + Holdings (right) ===== */}
      <Typography variant="h4" textAlign={'center'} sx={{ mb: { xs: 0.5, md: 1 } }}>
        Track Account Portfolios
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' },
          gap: { xs: 2, md: 3 },
        }}
      >
        {/* Tracked Wallets manager */}
        <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
          <Typography variant="h6" gutterBottom>
            Tracked Wallets
          </Typography>

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr auto' }} gap={1} mb={1.5}>
            <TextField
              size="small"
              fullWidth
              label="Qortal Address or Name"
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAdd();
              }}
            />
            <Button
              variant="contained"
              onClick={onAdd}
              disabled={!newAddr || adding}
              sx={{ minWidth: { sm: 100 } }}
            >
              {adding ? 'Adding...' : 'Add'}
            </Button>
          </Box>

          {addMsg && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              {addMsg}
            </Typography>
          )}

          {wallets.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tracked wallets yet.
            </Typography>
          ) : (
            <Box display="grid" gap={0.5}>
              {wallets.map((w) => (
                <Box
                  key={w.address}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  py={0.5}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      minWidth: 0,
                      maxWidth: '75%',
                      fontFamily: w.name ? undefined : 'monospace',
                    }}
                    title={w.name ?? w.address}
                  >
                    {w.name ?? w.address}
                  </Typography>
                  <IconButton size="small" onClick={() => removeWallet(w.address)}>
                    <Delete fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          <Box mt={2} display="flex" gap={1} flexWrap="wrap">
            <Button variant="outlined" onClick={() => refreshHoldings()} disabled={loading}>
              Refresh
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              onClick={handleClearTracked}
              disabled={loading}
            >
              New set
            </Button>
            {error && (
              <Typography color="error" sx={{ alignSelf: 'center' }}>
                {error}
              </Typography>
            )}
          </Box>
          <Divider sx={{ my: 2 }} />
          <Box display="grid" gap={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                size="small"
                fullWidth
                label="Save tracked set as"
                value={saveSetName}
                onChange={(e) => setSaveSetName(e.target.value)}
              />
              <Button variant="contained" onClick={handleSaveCurrentSet} disabled={savingSet}>
                {savingSet ? 'Saving...' : 'Save Set'}
              </Button>
            </Stack>
            {savedSetMsg && (
              <Typography variant="caption" color="text.secondary">
                {savedSetMsg}
              </Typography>
            )}
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Button
                variant="outlined"
                size="small"
                onClick={handlePublishSavedSets}
                disabled={publishingSets || !savedSets.length}
              >
                {publishingSets ? 'Publishing...' : 'Publish saved sets'}
              </Button>
              {publishError ? (
                <Typography variant="caption" color="error.main">
                  {publishError}
                </Typography>
              ) : publishStatus ? (
                <Typography variant="caption" color="success.main">
                  {publishStatus}
                </Typography>
              ) : null}
            </Stack>
            <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
              Saved Tracked Sets
            </Typography>
            {savedSets.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No saved tracked account sets yet.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {savedSets.map((set) => (
                  <Paper key={set.id} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2">{set.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {set.wallets.length} wallet{set.wallets.length === 1 ? '' : 's'} - saved{' '}
                          {new Date(set.savedAt).toLocaleDateString()}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            mt: 0.5,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={set.wallets.map((w) => w.name ?? w.address).join(', ')}
                        >
                          {set.wallets.map((w) => w.name ?? w.address).join(', ')}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => handleLoadSavedSet(set)}>
                          Load
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleDeleteSavedSet(set.id)}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
          <Divider sx={{ my: 2 }} />
          <Box display="grid" gap={1}>
            <Typography variant="subtitle2">Published Tracked Sets</Typography>
            {authAddress ? (
              <>
                {remotePublishedLoading ? (
                  <Typography variant="body2" color="text.secondary">
                    Searching QDN for any published saved sets...
                  </Typography>
                ) : remotePublishedError ? (
                  <Typography variant="body2" color="error.main">
                    {remotePublishedError}
                  </Typography>
                ) : (
                  remotePublishedMeta && (
                    <Typography variant="caption" color="text.secondary">
                      Published by {remotePublishedMeta.publisher}
                      {remotePublishedMeta.owner ? ` - owner ${remotePublishedMeta.owner}` : ''}
                      {remotePublishedMeta.ts
                        ? ` - ${new Date(remotePublishedMeta.ts).toLocaleString()}`
                        : ''}
                    </Typography>
                  )
                )}
                {!remotePublishedLoading && !remotePublishedError && (
                  <>
                    {remotePublishedSets.length ? (
                      <Stack spacing={1}>
                        {remotePublishedSets.map((set) => (
                          <Paper key={`published-${set.id}`} variant="outlined" sx={{ p: 1.25 }}>
                            <Stack direction="row" alignItems="flex-start" spacing={1}>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="subtitle2">{set.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {set.wallets.length} wallet{set.wallets.length === 1 ? '' : 's'} -
                                  saved {new Date(set.savedAt).toLocaleDateString()}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{
                                    display: 'block',
                                    mt: 0.5,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                  title={set.wallets.map((w) => w.name ?? w.address).join(', ')}
                                >
                                  {set.wallets.map((w) => w.name ?? w.address).join(', ')}
                                </Typography>
                              </Box>
                              <Button size="small" onClick={() => handleLoadSavedSet(set)}>
                                Load
                              </Button>
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No published tracked account sets were found.
                      </Typography>
                    )}
                  </>
                )}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Sign in to check for published saved sets.
              </Typography>
            )}
          </Box>
        </Paper>

        {/* Holdings (All Tracked) */}
        <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            mb={{ xs: 1.5, md: 2 }}
          >
            <Typography variant="h6">Holdings (All Tracked)</Typography>
            {loading && <CircularProgress size={20} />}
          </Box>

          {rowsAll.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No holdings yet.
            </Typography>
          ) : (
            <Box
              display="grid"
              gridTemplateColumns={{
                xs: 'auto 1fr auto', // amount column exists on mobile too
                sm: 'auto 1fr auto',
              }}
              rowGap={1}
              columnGap={1}
              alignItems="center"
            >
              {rowsAll.map((row) => (
                <React.Fragment key={row.assetId}>
                  {/* Avatar */}
                  <Box
                    sx={{
                      width: { xs: 32, sm: 36 },
                      height: { xs: 32, sm: 36 },
                      borderRadius: 1,
                      overflow: 'hidden',
                      bgcolor: 'background.default',
                      border: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {avatarMap[row.assetId] ? (
                      <img
                        src={avatarMap[row.assetId]!}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <img
                        src="/src/core-assets/asset-placeholder.svg"
                        alt=""
                        style={{ width: '70%', height: '70%', opacity: 0.6 }}
                      />
                    )}
                  </Box>

                  {/* Name */}
                  <Typography
                    variant="body1"
                    sx={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      pr: 1,
                    }}
                    title={row.name}
                  >
                    {row.name}
                  </Typography>

                  {/* Amount - now visible on xs, right-aligned */}
                  <Typography
                    variant="body1"
                    sx={{
                      fontFamily: 'monospace',
                      textAlign: 'right',
                      fontSize: { xs: '0.92rem', sm: '1rem' }, // optional; tighter on phones
                    }}
                    title="Total tracked balance"
                  >
                    {formatAssetAmount(row.total, row.isDivisible)}
                  </Typography>
                </React.Fragment>
              ))}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
