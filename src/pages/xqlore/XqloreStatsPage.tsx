import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
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
  validateTxIndexEntries,
  type XqloreTxIndexEntry,
} from '../../utils/xqloreIndex';
import { getIdentifier, getService, getTxType } from '../../utils/xqloreTx';
import { useXqloreTxIndex } from '../../hooks/useXqloreTxIndex';

const BLOCK_BATCH_SIZE = 100_000;
const DEFAULT_BATCH_COUNT = 1;
const MAX_BATCH_COUNT = 10;
const TX_PAGE_LIMIT = 200;

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

  const longStats = useMemo(() => {
    const count = latestIndex?.entries.length ?? 0;
    const assets =
      latestIndex?.entries.filter((entry) => String(entry.type).includes('ASSET')).length ?? 0;
    const arbitrary =
      latestIndex?.entries.filter((entry) => entry.type === 'ARBITRARY').length ?? 0;
    return { count, assets, arbitrary };
  }, [latestIndex]);

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

      for (let i = 0; i < targetBatches; i += 1) {
        const batchStart = start + i * BLOCK_BATCH_SIZE;
        if (batchStart > height) break;
        const batchEnd = Math.min(height, batchStart + BLOCK_BATCH_SIZE - 1);
        const effectiveLimit = batchEnd - batchStart + 1;
        const batchLabel = `Batch ${i + 1}/${targetBatches}`;
        setStatusNote(`Scanning blocks ${batchStart}-${batchEnd}...`);
        setProgress({ phase: 'Scanning blocks', pages: 0, entries: 0, batch: batchLabel });

        const collected: any[] = [];
        let offset = 0;
        let hasMore = true;
        let pageCount = 0;
        while (hasMore) {
          const res = await qortalRequest({
            action: 'SEARCH_TRANSACTIONS',
            confirmationStatus: 'CONFIRMED',
            startBlock: batchStart,
            blockLimit: effectiveLimit,
            limit: TX_PAGE_LIMIT,
            offset,
            reverse: true,
            txType: [...XQLORE_TX_TYPES],
          });
          const rows = Array.isArray(res) ? res : res && typeof res === 'object' ? [res] : [];
          if (rows.length === 0) break;
          collected.push(...rows);
          pageCount += 1;
          setProgress({
            phase: 'Scanning blocks',
            pages: pageCount,
            entries: collected.length,
            batch: batchLabel,
          });
          if (rows.length < TX_PAGE_LIMIT) {
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

        if (includeNames) {
          const uniqueAddresses = Array.from(
            new Set(draftEntries.map((entry) => entry.creatorAddress).filter(Boolean))
          ) as string[];
          const limiter = pLimit(10);
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

        setStatusNote('Validating index...');
        setProgress({
          phase: 'Validating',
          pages: pageCount,
          entries: draftEntries.length,
          batch: batchLabel,
        });
        const result = await validateTxIndexEntries({
          blockStart: batchStart,
          blockEnd: batchEnd,
          entries: draftEntries,
          sampleSize: 5,
        });

        nextBatches.push({
          blockStart: batchStart,
          blockEnd: batchEnd,
          entries: draftEntries,
          validation: { ok: result.ok, errors: result.errors, warnings: result.warnings },
        });
        lastEnd = batchEnd;
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
      await publish(resources);
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
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`Indexed entries: ${longStats.count}`} variant="outlined" />
              <Chip label={`Asset events: ${longStats.assets}`} variant="outlined" />
              <Chip label={`QDN publishes: ${longStats.arbitrary}`} variant="outlined" />
              {latestIndex?.blockStart && latestIndex?.blockEnd && (
                <Chip
                  label={`Latest index blocks ${latestIndex.blockStart}-${latestIndex.blockEnd}`}
                  variant="outlined"
                />
              )}
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
              Publish / update tx index
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Build 100k-block index batches and publish them for long-term visibility. Ranges start
              from genesis or continue after the latest published index. Validation checks random
              signatures and continuity across each batch.
            </Typography>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ md: 'center' }}
            >
              <TextField
                size="small"
                label="100k batches"
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
            </Stack>
            {statusNote && (
              <Typography variant="body2" color={validation?.ok ? 'success.main' : 'error.main'}>
                {statusNote}
              </Typography>
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
                      Built {batches.reduce((sum, batch) => sum + batch.entries.length, 0)} entries
                      across {batches.length} batch(es) for blocks {blockStart}-{blockEnd}.
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default XqloreStatsPage;
