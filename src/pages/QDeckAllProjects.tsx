import * as React from 'react';
import {
  Box,
  Stack,
  Paper,
  Typography,
  TextField,
  Chip,
  Alert,
  useMediaQuery,
  Skeleton,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PublicIcon from '@mui/icons-material/Public';

import { QDeckId, parsePrivateProjectIdentV2 } from '../constants/qdeckIdentifiers';
import { qdeckFetch } from '../utils/qdeckApi';
import type { AnyProject, QDeckProject } from '../types/qdeck';
import { coerceService, coerceVisibility } from '../types/qdeck';
import { searchSimpleByIdPrefixOnly } from '../utils/searchSimple';
import { pastelBgFromId, pastelBorderFromId } from '../utils/qdeckColors';
import { useFetchTracker } from '../state/global/fetchTracker';

type ProjectLoadStatus = 'queued' | 'loading' | 'decrypting' | 'loaded' | 'error';
type ListedProject = AnyProject & {
  status: ProjectLoadStatus;
  statusMessage?: string;
  createdAt?: number;
  updatedAt?: number;
  identifier?: string;
  issuerName: string;
  boardsCount?: number;
  assetsCount?: number;
};

const statusPriority: Record<ProjectLoadStatus, number> = {
  loaded: 4,
  decrypting: 3,
  loading: 2,
  queued: 1,
  error: 0,
};

const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) return 'Unknown';
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

export default function QDeckAllProjects() {
  const [projectMap, setProjectMap] = React.useState<Record<string, ListedProject>>({});
  const [q, setQ] = React.useState('');
  const [stats, setStats] = React.useState({ pubFound: 0, privFound: 0 });

  const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

  const { track, isLoadingPrefix } = useFetchTracker();
  const busyWhile = React.useCallback(
    async <T,>(fn: () => Promise<T> | T, label: string) => track(Promise.resolve().then(fn), label),
    [track]
  );

  const loadTokenRef = React.useRef(0);

  const upsertProject = React.useCallback(
    (key: string, next: ListedProject | ((prev?: ListedProject) => ListedProject)) => {
      setProjectMap((prev) => {
        const current = prev[key];
        const updated =
          typeof next === 'function'
            ? (next as (arg?: ListedProject) => ListedProject)(current)
            : next;
        if (!updated) return prev;
        return { ...prev, [key]: updated };
      });
    },
    []
  );

  const removeProject = React.useCallback((key: string) => {
    setProjectMap((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const hydrateProject = React.useCallback(
    async (
      head: { identifier: string; name: string; created?: number; updated?: number },
      kind: 'public' | 'private',
      token: number
    ) => {
      const key = `${head.name}::${head.identifier}`;
      const parsedPrivate =
        kind === 'private' ? parsePrivateProjectIdentV2(head.identifier) : undefined;
      const shortId =
        kind === 'public'
          ? head.identifier.replace(QDeckId.prefixPublicProjects, '')
          : (parsedPrivate?.projectId ?? head.identifier);
      if (!shortId) return;

      const placeholder: ListedProject = {
        name: head.name,
        issuerName: head.name,
        shortId,
        identifier: head.identifier,
        title: kind === 'public' ? shortId : '(Private project)',
        createdAt: head.created,
        updatedAt: head.updated,
        visibility: kind === 'public' ? 'public' : 'private',
        service: kind === 'public' ? ('DOCUMENT' as const) : ('DOCUMENT_PRIVATE' as const),
        accessible: kind === 'public',
        status: kind === 'public' ? 'loading' : 'decrypting',
        statusMessage:
          kind === 'public' ? 'Fetching project metadata…' : 'Decrypting private project…',
        privMode: parsedPrivate?.mode,
      };

      if (loadTokenRef.current !== token) return;
      upsertProject(key, (prev) => ({ ...(prev ?? placeholder), ...placeholder }));

      try {
        const doc = await qdeckFetch<QDeckProject>(
          head.name,
          head.identifier,
          kind === 'private',
          parsedPrivate?.mode === 'group' ? parsedPrivate.groupId : undefined,
          parsedPrivate?.mode === 'group' ? !!parsedPrivate.isAdmins : undefined,
          parsedPrivate?.mode ?? 'group'
        );
        if (loadTokenRef.current !== token) return;
        if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') {
          removeProject(key);
          return;
        }
        upsertProject(key, (prev) => ({
          ...(prev ?? placeholder),
          title: doc.title,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          visibility: coerceVisibility(doc.visibility ?? prev?.visibility ?? 'public'),
          service: coerceService(doc.service ?? prev?.service ?? 'DOCUMENT'),
          accessible: true,
          boardsCount: Array.isArray(doc.boards) ? doc.boards.length : undefined,
          assetsCount: Array.isArray(doc.assetIds) ? doc.assetIds.length : undefined,
          status: 'loaded',
          statusMessage: 'Project metadata loaded.',
        }));
      } catch (error: any) {
        if (loadTokenRef.current !== token) return;
        const message =
          typeof error?.message === 'string' ? error.message : 'Unable to load project.';
        upsertProject(key, (prev) => ({
          ...(prev ?? placeholder),
          status: 'error',
          statusMessage: message,
          accessible: false,
        }));
      }
    },
    [removeProject, upsertProject]
  );

  const load = React.useCallback(async () => {
    const token = ++loadTokenRef.current;
    setProjectMap({});
    await busyWhile(async () => {
      const [pubRaw, privRaw] = await Promise.all([
        searchSimpleByIdPrefixOnly(QDeckId.prefixPublicProjects, false),
        searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateProjects, true),
      ]);
      if (loadTokenRef.current !== token) return;
      setStats({ pubFound: pubRaw.length, privFound: privRaw.length });
      [...pubRaw, ...privRaw].forEach((head) => {
        if (!head?.identifier || !head?.name) return;
        const kind = head.identifier.startsWith(QDeckId.prefixPrivateProjects)
          ? 'private'
          : 'public';
        hydrateProject(head, kind, token);
      });
    }, 'blocking:qdeck:allprojects');
  }, [busyWhile, hydrateProject]);

  React.useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const projectList = React.useMemo(() => {
    const values = Object.values(projectMap);
    const dedup = new Map<string, ListedProject>();
    values.forEach((entry) => {
      const existing = dedup.get(entry.shortId);
      if (!existing) {
        dedup.set(entry.shortId, entry);
        return;
      }
      const statusDiff = statusPriority[entry.status] - statusPriority[existing.status];
      if (statusDiff > 0) {
        dedup.set(entry.shortId, entry);
        return;
      }
      if (statusDiff === 0) {
        const tsDiff = (entry.updatedAt ?? 0) - (existing.updatedAt ?? 0);
        if (tsDiff > 0) dedup.set(entry.shortId, entry);
      }
    });
    return Array.from(dedup.values()).sort((a, b) => {
      const statusDiff = statusPriority[b.status] - statusPriority[a.status];
      if (statusDiff !== 0) return statusDiff;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }, [projectMap]);

  const filtered = React.useMemo(() => {
    if (!q) return projectList;
    const needle = q.toLowerCase();
    return projectList.filter(
      (p) =>
        p.title?.toLowerCase().includes(needle) ||
        p.name.toLowerCase().includes(needle) ||
        p.shortId.toLowerCase().includes(needle)
    );
  }, [projectList, q]);

  const hydratedCount = React.useMemo(
    () => projectList.filter((p) => p.status === 'loaded').length,
    [projectList]
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto' }}>
      {isLoadingPrefix('blocking:qdeck:allprojects') && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Loading all projects… decrypting private projects may take a moment.
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        spacing={{ xs: 1, sm: 2 }}
        sx={{ mb: { xs: 1.25, sm: 2 } }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
          <Typography variant="h5">All Projects</Typography>
          <Stack direction="row" spacing={1} sx={{ ml: { sm: 1 } }}>
            <Chip
              label="My projects"
              component={RouterLink}
              to="/qdeck/projects"
              variant="outlined"
              clickable
              color="primary"
            />
            <Chip label="All projects" color="primary" />
          </Stack>
        </Stack>
        <TextField
          size="small"
          label="Filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ width: { xs: '100%', sm: '22rem' } }}
        />
      </Stack>

      <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
        Public hits: {stats.pubFound} • Private hits: {stats.privFound} • Loaded: {hydratedCount}
      </Typography>

      {filtered.map((p) => {
        const targetId = p.identifier ?? p.shortId;
        const to = `/qdeck/projects/${encodeURIComponent(p.name)}/${encodeURIComponent(targetId)}`;
        const canOpen = p.visibility === 'public' || p.accessible;
        const statusColor =
          p.status === 'error'
            ? 'error.main'
            : p.status === 'loaded'
              ? 'success.main'
              : 'info.main';

        const chip =
          p.visibility === 'public' ? (
            <Chip
              size="small"
              icon={<PublicIcon fontSize="small" />}
              label="Public"
              variant="outlined"
              color="success"
            />
          ) : p.accessible ? (
            <Chip
              size="small"
              icon={<LockOpenIcon fontSize="small" />}
              label={p.privMode === 'group' ? 'Private (group access)' : 'Private (direct access)'}
              variant="outlined"
              color="primary"
            />
          ) : (
            <Chip
              size="small"
              icon={<LockIcon fontSize="small" />}
              label="Private (locked)"
              variant="outlined"
              color="warning"
            />
          );

        const content = (
          <>
            <Box sx={{ minWidth: 0 }}>
              {p.status === 'loaded' ? (
                <Typography
                  variant="subtitle1"
                  sx={{
                    lineHeight: 1.2,
                    maxWidth: { xs: '100%', sm: '40vw' },
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.title}
                </Typography>
              ) : (
                <Skeleton variant="text" width="60%" height={28} />
              )}

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 0.5, mt: 0.5, minWidth: 0, flexWrap: 'wrap' }}
              >
                {chip}
                {typeof p.boardsCount === 'number' && (
                  <Chip size="small" variant="outlined" label={`${p.boardsCount} boards`} />
                )}
                {typeof p.assetsCount === 'number' && (
                  <Chip size="small" variant="outlined" label={`${p.assetsCount} assets`} />
                )}
              </Stack>

              <Typography
                variant="caption"
                sx={{ opacity: 0.7, display: 'block', wordBreak: 'break-all' }}
              >
                {p.name} — {p.shortId}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                Updated {formatRelativeTime(p.updatedAt)} • Created{' '}
                {formatRelativeTime(p.createdAt)}
              </Typography>
              {p.statusMessage && (
                <Typography variant="caption" sx={{ display: 'block' }} color={statusColor}>
                  {p.statusMessage}
                </Typography>
              )}
            </Box>

            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
            >
              {canOpen ? (
                <Typography
                  variant="button"
                  sx={{ opacity: 0.7, pr: 0.5, display: { xs: 'none', sm: 'inline' } }}
                >
                  Open →
                </Typography>
              ) : (
                <Chip size="small" label="No access" variant="outlined" />
              )}
            </Stack>
          </>
        );

        const cardProps = {
          elevation: 0,
          sx: {
            p: { xs: 1.25, sm: 2 },
            display: 'grid',
            mb: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
            rowGap: { xs: '0.75rem', sm: 0 },
            alignItems: { xs: 'stretch', sm: 'center' },
            bgcolor: (t: any) => pastelBgFromId(p.shortId, t.palette.mode),
            border: (t: any) => `1px solid ${pastelBorderFromId(p.shortId, t.palette.mode)}`,
            textDecoration: 'none',
            cursor: canOpen ? 'pointer' : 'default',
            ...(isTouch
              ? {}
              : canOpen
                ? { '&:hover': { boxShadow: 2, transform: 'translateY(-0.1rem)' } }
                : {}),
            transition: 'transform 120ms ease, box-shadow 120ms ease',
          },
        };

        return canOpen ? (
          <Paper key={`${p.name}:${p.shortId}`} component={RouterLink} to={to} {...cardProps}>
            {content}
          </Paper>
        ) : (
          <Paper key={`${p.name}:${p.shortId}`} {...cardProps}>
            {content}
          </Paper>
        );
      })}
    </Box>
  );
}
