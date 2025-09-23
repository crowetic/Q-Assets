/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, useTransition, useRef } from 'react';
import {
  Card,
  CardContent,
  Stack,
  Paper,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Avatar,
  Alert,
  Pagination,
  useTheme,
  useMediaQuery,
} from '@mui/material';

import { useAlert } from '../alerts';

import TagChip from '../asset/TagChip';
import { useAuth, objectToBase64, Spacer } from 'qapp-core';
// import { useTheme } from '@mui/material';
import { assetCommentsPrefix, assetCommentId } from '../../constants/qdnConstants';
import { uniqueId6 } from '../../utils/ids';
import { base64ToObject } from '../../utils/data';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import TiptapEditor from '../TipTapEditor';

import type { ThreadComment } from '../../types/ThreadedComment';
import { buildCommentForest, pruneDeletedForest, stripPrefixId } from '../../utils/thread';
import { MINTER_GROUP_ID, DEV_GROUP_ID } from '../../constants/qdnConstants';

import { SkeletonComment } from '../common/Loading';
import BusyButton from '../common/BusyButton';
import { searchSimpleByIdentifierPrefix } from '../../utils/searchSimple';
import { addTagsForName, tagComments } from '../../utils/roles';

import type { ThreadNode } from '../../utils/thread';
// import { Pagination } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import EditToggleButton from '../buttons/EditToggleButton';
import InfoOutlineButton from '../buttons/InfoOutlineButton';

type NodeWithTags = ThreadComment & { roleTags: string[] };

type ThreadCommentWithFlags = ThreadComment & { roleTags?: string[]; deleted?: boolean };

function asWithFlags(n: ThreadNode): ThreadCommentWithFlags {
  return n as unknown as ThreadCommentWithFlags;
}

const DELETED_SENTINEL_RAW: string = 'x';
const DELETED_SENTINEL_LEN: number = 10;

const MAX_DEPTH = 8; // safety cap for replies
const AVATAR_SIZE = '3rem';
const INDENT_STEP = '1.25rem';

export interface CommentsSectionProps {
  assetId: number;
  primaryGroupId: number;
  isIssuer?: boolean;
  issuerName: string | null;
  type?: string;
  pageSize?: number; // default 10 roots per page
  collapsible?: boolean; // default false
  defaultCollapsed?: boolean; // default false
  onVisibilityChange?: (visible: boolean) => void; // optional callback
  lazyLoad?: boolean; // default true
  rootMargin?: string;
}

function base64ByteLength(b64: string): number {
  try {
    const bin = atob(b64);
    return bin.length;
  } catch {
    return -1;
  }
}

const toNode = (t: ThreadComment): NodeWithTags => ({
  ...t,
  roleTags: Array.isArray(t.roleTags) ? t.roleTags : [],
});

const byCreatedAsc = (a: { ts?: number; createdTs?: number; id?: string }, b: typeof a) => {
  const ta = Number.isFinite(a.createdTs) ? (a.createdTs as number) : (a.ts as number);
  const tb = Number.isFinite(b.createdTs) ? (b.createdTs as number) : (b.ts as number);
  if (ta !== tb) return ta - tb;
  // stable tiebreak
  return String(a.id || '').localeCompare(String(b.id || ''));
};

const byCreatedDesc = (a: any, b: any) => -byCreatedAsc(a, b);

export function dialogPaperSx(isXs: boolean) {
  return {
    width: isXs ? '100vw' : '75vw',
    height: isXs ? '100vh' : '75vh',
    maxWidth: '100vw',
    maxHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  } as const;
}

function ReplyPreview({
  reply,
  avatarUrl,
  defaultCollapsed = true,
  collapsedHeight = '18vh', // compact height when collapsed
  expandedHeight = '45vh', // max height when expanded
}: {
  reply: ThreadComment;
  avatarUrl?: string | null;
  defaultCollapsed?: boolean;
  collapsedHeight?: string;
  expandedHeight?: string;
}) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const ts = reply.createdTs ?? reply.ts;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'),
        borderStyle: 'dashed',
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1 }}>
        <Avatar src={avatarUrl || undefined} sx={{ width: '2.5rem', height: '2.5rem' }}>
          {!avatarUrl ? (reply.author?.[0]?.toUpperCase() ?? '?') : null}
        </Avatar>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Replying to <strong>{reply.author || 'unknown'}</strong>
            {' — '}
            {new Date(ts || Date.now()).toLocaleString()}
          </Typography>

          <Box
            sx={{
              mt: 0.75,
              typography: 'body2',
              borderRadius: 1,
              p: 1,
              bgcolor: (t) =>
                t.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
              maxHeight: expanded ? expandedHeight : collapsedHeight,
              overflowY: 'auto',
              position: 'relative',
            }}
          >
            {/* Show the original HTML (you’re already rendering HTML elsewhere) */}
            <Box dangerouslySetInnerHTML={{ __html: reply.html || '' }} />

            {/* subtle fade at bottom when collapsed (purely visual) */}
            {!expanded && (
              <Box
                sx={{
                  pointerEvents: 'none',
                  position: 'sticky',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '2rem',
                  background: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'linear-gradient(180deg, rgba(18,18,18,0) 0%, rgba(18,18,18,0.9) 100%)'
                      : 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 100%)',
                }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
            <Button
              size="small"
              onClick={() => setExpanded((v) => !v)}
              sx={{ textTransform: 'none' }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </Button>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

async function fetchHtmlComment(
  name: string,
  identifier: string,
  prefix: string,
  createdFallback?: number,
  updatedFallback?: number
): Promise<ThreadComment | null> {
  try {
    const b64 = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name,
      identifier,
      encoding: 'base64',
    } as any);

    const rawLen = base64ByteLength(b64);

    if (rawLen <= DELETED_SENTINEL_LEN) {
      const id = stripPrefixId(identifier, prefix);
      // We don't have JSON fields here so we derive minimal viable info
      return {
        id,
        parentId: null,
        rootId: id,
        depth: 0,
        author: name,
        html: '',
        deleted: true,
      } as ThreadCommentWithFlags;
    }

    const obj = await base64ToObject(b64);
    if (!obj || typeof obj !== 'object') return null;

    const html = String((obj as any).html ?? '').trim();
    if (!html) return null;

    // Permit missing parent/root fields for future compatibility
    const id = stripPrefixId(identifier, prefix);
    const parentId = ((obj as any).parentId ?? null) ? String((obj as any).parentId) : null;
    const rootId = String((obj as any).rootId ?? id);
    const depthNum = Number((obj as any).depth ?? (parentId ? 1 : 0));
    const depth = Number.isFinite(depthNum) ? Math.max(0, Math.min(MAX_DEPTH, depthNum)) : 0;

    const createdTs = Number(
      (obj as any).createdTs ?? (obj as any).ts ?? createdFallback ?? Date.now()
    );
    const updatedTs = Number(
      (obj as any).updatedTs ?? (obj as any).ts ?? updatedFallback ?? createdTs
    );

    return {
      id,
      parentId,
      rootId,
      depth,
      ts: createdTs,
      createdTs,
      updatedTs,
      author: String((obj as any).author ?? name),
      html,
    };
  } catch {
    return null;
  }
}

export default function CommentsSection({
  assetId,
  primaryGroupId,
  // isIssuer,
  issuerName,
  pageSize: pageSizeProp,
  collapsible = true,
  defaultCollapsed = false,
  onVisibilityChange,
  lazyLoad = true,
  rootMargin = '5%',
}: CommentsSectionProps) {
  const { name: userName } = useAuth();
  const [items, setItems] = useState<NodeWithTags[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  // const [publishers, setPublishers] = useState<PublisherWithTags[]>([]);

  const [open, setOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadComment | null>(null);
  const [html, setHtml] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  //Edit State
  const [editMode, setEditMode] = useState<boolean>(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ThreadCommentWithFlags | null>(null);
  const [editHtml, setEditHtml] = useState<string>('');

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ThreadCommentWithFlags | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Structure State
  const prefix = useMemo(() => assetCommentsPrefix(assetId), [assetId]);
  const forestRaw = useMemo(() => buildCommentForest(items), [items]);
  const forest = useMemo(() => pruneDeletedForest(forestRaw as any), [forestRaw]);
  const forestRootsDesc = useMemo(() => [...forest].sort(byCreatedDesc), [forest]);
  const totalRoots = forestRootsDesc.length;
  const pageSize = Math.max(1, Number(pageSizeProp ?? 10));
  const totalPages = Math.max(1, Math.ceil(totalRoots / pageSize));

  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  //Pagination State
  const [page, setPage] = useState<number>(1);
  const [searchParams, setSearchParams] = useSearchParams();

  //Visibility State
  const [collapsed, setCollapsed] = useState<boolean>(!readVisibleFromUrl());
  const [visible, setVisible] = useState<boolean>(!lazyLoad); // if not lazy, load immediately

  const hostRef = useRef<HTMLDivElement | null>(null);

  // Clamp page if data changes (e.g., deletes remove roots)
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const [isPending, startTX] = useTransition();

  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, totalRoots);
  const pageRoots = forestRootsDesc.slice(start, end);

  const inputs = {
    primaryGroupId,
    MINTER_GROUP_ID,
    DEV_GROUP_ID,
    assetIssuer: issuerName || undefined,
  };

  // Yield helper (requestIdleCallback polyfilled)
  function yieldToMain(minTime = 8): Promise<void> {
    return new Promise((resolve) => {
      // @ts-ignore
      const ric: any = window.requestIdleCallback;
      if (typeof ric === 'function') {
        ric(() => resolve(), { timeout: 50 });
      } else {
        setTimeout(resolve, minTime);
      }
    });
  }

  useEffect(() => {
    if (!lazyLoad) return;
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect(); // load once
        }
      },
      { root: null, rootMargin, threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazyLoad, rootMargin]);

  // Very small concurrency limiter (no external dep)
  function pLimit(concurrency: number) {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => {
      active--;
      const fn = queue.shift();
      fn && fn();
    };
    return async function <T>(fn: () => Promise<T>): Promise<T> {
      if (active >= concurrency) {
        await new Promise<void>((r) => queue.push(r));
      }
      active++;
      try {
        return await fn();
      } finally {
        next();
      }
    };
  }

  function readPageFromUrl(): number {
    const raw = searchParams.get('cpage');
    const n = raw ? Number(raw) : 1;
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }

  // --- Optional collapsed state tied to URL (?cshow=1)
  function readVisibleFromUrl(): boolean {
    const raw = searchParams.get('cshow');
    if (raw === '0') return false;
    if (raw === '1') return true;
    // default fallback if not present:
    return !defaultCollapsed;
  }

  function goToPage(p: number, replace = false) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    const next = new URLSearchParams(searchParams);
    next.set('cpage', String(clamped));
    next.set('cshow', collapsed ? '0' : '1');
    setSearchParams(next, { replace });
  }

  const { alert } = useAlert();

  useEffect(() => {
    // only update if different (prevents loops)
    const p = readPageFromUrl();
    setPage((prev) => (prev !== p ? p : prev));

    const vis = readVisibleFromUrl();
    setCollapsed((prev) => (prev === !vis ? !vis : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  useEffect(() => {
    const clamped = Math.min(Math.max(1, page), totalPages);
    if (clamped !== page) {
      setPage(clamped);
      // also update URL
      const next = new URLSearchParams(searchParams);
      next.set('cpage', String(clamped));
      next.set('cshow', collapsed ? '0' : '1');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  // Load all existing comments (within the primary group namespace)
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    const ac = new AbortController();
    const limit = pLimit(6); // control network pressure
    const BATCH = 10; // update UI every N docs

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Find all identifiers quickly (cheap)
        const hitsAll = await searchSimpleByIdentifierPrefix('DOCUMENT', prefix);
        if (cancelled) return;

        // Sort stable (you had this already)
        const hits = hitsAll.sort(
          (a: any, b: any) => a.created - b.created || a.identifier.localeCompare(b.identifier)
        );

        // Build name map once (for backfill)
        const namesByIdentifier = hitsAll.reduce((m, h) => {
          const arr = m.get(h.identifier) || [];
          arr.push(h.name);
          m.set(h.identifier, arr);
          return m;
        }, new Map<string, string[]>());

        // 2) Fetch docs progressively with a concurrency cap
        const docs: ThreadComment[] = [];
        let sinceLastFlush = 0;

        await Promise.all(
          hits.map((h) =>
            limit(async () => {
              if (cancelled) return;
              const doc = await fetchHtmlComment(h.name, h.identifier, prefix);
              if (!doc) return;
              // de-dupe by id
              if (docs.find((d) => d.id === doc.id)) return;
              docs.push(doc);
              sinceLastFlush++;
              if (sinceLastFlush >= BATCH) {
                sinceLastFlush = 0;
                // yield to main to keep UI responsive
                await yieldToMain();
              }
            })
          )
        );

        if (cancelled) return;

        // 3) Backfill ancestors (light pass; keep your logic)
        const haveIds = new Set(docs.map((d) => d.id));
        const needIds = new Set<string>();
        for (const d of docs) {
          if (d.parentId && !haveIds.has(d.parentId)) needIds.add(d.parentId);
          if (d.rootId && !haveIds.has(d.rootId)) needIds.add(d.rootId);
        }

        const backfilled: ThreadComment[] = [];
        for (const mid of needIds) {
          if (cancelled) return;
          const fullIdentifier = `${prefix}${mid}`;
          const candidateNames = namesByIdentifier.get(fullIdentifier) ?? [];
          let found: ThreadComment | null = null;
          for (const nm of candidateNames) {
            // eslint-disable-next-line no-await-in-loop
            const doc = await fetchHtmlComment(nm, fullIdentifier, prefix);
            if (doc) {
              found = doc;
              break;
            }
          }
          if (!found && docs.length) {
            const uniqueAuthors = Array.from(new Set(docs.map((x) => x.author).filter(Boolean)));
            for (const nm of uniqueAuthors) {
              // eslint-disable-next-line no-await-in-loop
              const doc = await fetchHtmlComment(nm, fullIdentifier, prefix);
              if (doc) {
                found = doc;
                break;
              }
            }
          }
          if (found && !haveIds.has(found.id)) {
            haveIds.add(found.id);
            backfilled.push(found);
          }
          // let main thread breathe on big backfills
          if (backfilled.length % BATCH === 0) await yieldToMain();
        }

        // 4) Tag roles (can be heavy) → do in transition & chunks
        const union = docs
          .concat(backfilled)
          .map((c) => ({ ...c, author: (c.author || '').trim() }))
          .sort((a, b) => a.ts - b.ts);

        const inputs = {
          primaryGroupId,
          MINTER_GROUP_ID,
          DEV_GROUP_ID,
          assetIssuer: issuerName || undefined,
        };

        let tagged: ThreadComment[] = [];
        const CHUNK = 200; // tune as needed
        for (let i = 0; i < union.length; i += CHUNK) {
          const slice = union.slice(i, i + CHUNK);
          // eslint-disable-next-line no-await-in-loop
          const t = await tagComments(slice, inputs);
          tagged.push(...t);
          // incremental paint via transition
          startTX(() => {
            if (!cancelled) {
              setItems((prev) => {
                // replace entirely on first chunk; then append (dedupe by id)
                const base = i === 0 ? [] : prev;
                const seen = new Set(base.map((x) => x.id));
                const merged = base.concat(t.map(toNode).filter((x) => !seen.has(x.id)));
                return merged.sort(byCreatedAsc);
              });
            }
          });
          await yieldToMain();
        }

        if (cancelled) return;

        // 5) Avatars AFTER items paint; do not block
        const authors = Array.from(new Set(tagged.map((c) => c.author))).filter(Boolean);
        const avatarLimit = pLimit(4);
        await Promise.all(
          authors.map((a) =>
            avatarLimit(async () => {
              if (cancelled) return;
              const url = await fetchAccountAvatarDataUrl(a);
              startTX(() => {
                if (!cancelled) setAvatars((m) => (m[a] ? m : { ...m, [a]: url }));
              });
            })
          )
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load comments.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
    // include deps that change the dataset
  }, [visible, assetId, primaryGroupId, prefix, issuerName]);

  const openNew = (parent?: ThreadComment | null) => {
    setReplyTo(parent ?? null);
    setHtml('');
    setOpen(true);
  };

  const publish = async () => {
    if (!userName)
      return alert('You need a Qortal name to publish.', 'error', { severity: 'error' });
    const safeHtml = prepareHtmlForPublish(html, theme);
    if (!safeHtml.trim()) return alert('Comment is empty.');

    setPublishing(true);
    try {
      const id = uniqueId6();
      const parentId = replyTo ? replyTo.id : null;
      const rootId = replyTo ? replyTo.rootId || replyTo.id : id;
      const depth = replyTo ? Math.min(MAX_DEPTH, (replyTo.depth ?? 0) + 1) : 0;

      // ⬇️ Resolve role tags via the new method (issuer + groups). Never lowercase the name.
      let myTags: string[] = [];
      try {
        myTags = await addTagsForName(userName, inputs);
      } catch {
        // tagging is best-effort; we'll auto-correct on next load anyway
        myTags = [];
      }

      const entry: ThreadComment = {
        id,
        rootId,
        parentId,
        depth,
        ts: Date.now(),
        createdTs: Date.now(),
        author: userName,
        html: safeHtml,
        roleTags: Array.from(new Set(myTags)), // safe even if empty
      };

      const identifier = assetCommentId(assetId, id);
      const data64 = await objectToBase64(entry);

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        name: userName,
        service: 'DOCUMENT',
        identifier,
        data64,
      } as any);

      // optimistic UI: add the newly published comment at the top
      setItems((prev) => [toNode(entry), ...prev]);
      // If new root, jump to page 1 and sync URL so sharing/back works
      if (!replyTo) {
        goToPage(1); // will also update URL params
      }

      if (!avatars[userName]) {
        const url = await fetchAccountAvatarDataUrl(userName);
        setAvatars((m) => ({ ...m, [userName]: url }));
      }

      setOpen(false);
      setReplyTo(null);
      setHtml('');
    } finally {
      setPublishing(false);
    }
  };

  function openEdit(n: ThreadCommentWithFlags) {
    if (!userName)
      return alert('You need a Qortal name to edit.', 'Name Required', { severity: 'warning' });
    if (n.author !== userName)
      return alert('Only the original publisher can edit this comment.', 'orig publisher only', {
        severity: 'warning',
      });
    if (n.deleted)
      return alert('This comment is deleted.', 'Deleted Comment', { severity: 'warning' });
    setEditTarget(n);
    setEditHtml(n.html || '');
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!userName || !editTarget) return;
    const safeHtml = prepareHtmlForPublish(editHtml, theme);
    if (!safeHtml.trim()) {
      return alert('Comment is empty.', 'Empty Comment', { severity: 'warning' });
    }

    try {
      setPublishing(true); // reuse spinner
      // Re-publish SAME identifier with updated payload
      const entry: ThreadComment = {
        id: editTarget.id,
        rootId: editTarget.rootId || editTarget.id,
        parentId: editTarget.parentId ?? null,
        depth: editTarget.depth ?? 0,
        ts: editTarget.ts,
        createdTs: editTarget.ts,
        updatedTs: Date.now(),
        author: userName,
        html: safeHtml,
        // roleTags will be re-tagged on next load; keeping minimal here is fine
      };

      const identifier = assetCommentId(assetId, editTarget.id);
      const data64 = await objectToBase64(entry);

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        name: userName,
        service: 'DOCUMENT',
        identifier,
        data64,
      } as any);

      // Optimistic local update
      setItems((prev) =>
        prev.map((it) =>
          it.id === editTarget.id
            ? { ...it, html: safeHtml, ts: entry.ts, deleted: false, updatedTs: entry.updatedTs }
            : it
        )
      );

      setEditOpen(false);
      setEditTarget(null);
      setEditHtml('');
    } finally {
      setPublishing(false);
    }
  }

  function confirmDelete(n: ThreadCommentWithFlags) {
    if (!userName)
      return alert('You need a Qortal name to delete.', 'Name Required', { severity: 'warning' });
    if (n.author !== userName)
      return alert('Only the original publisher can delete this comment.', 'Only Orig. Publisher', {
        severity: 'warning',
      });
    if (n.deleted) return alert('Already deleted.', 'Already Deleted!', { severity: 'warning' });
    setDeleteTarget(n);
    setDeleteOpen(true);
  }

  async function performDelete() {
    if (!userName || !deleteTarget) return;
    try {
      setDeleting(true);
      const identifier = assetCommentId(assetId, deleteTarget.id);
      // Publish tiny sentinel payload (1 raw byte) – base64("x") = "eA=="
      const data64 = btoa(DELETED_SENTINEL_RAW);

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        name: userName,
        service: 'DOCUMENT',
        identifier,
        data64,
      } as any);

      // Optimistic local mark
      setItems((prev) =>
        prev
          .map((it) => (it.id === deleteTarget.id ? { ...it, html: '', deleted: true } : it))
          .sort(byCreatedAsc)
      );

      setDeleteOpen(false);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spacer height="1rem" width="1rem" />
        <Typography variant="h4" textAlign={'center'}>
          Comments
        </Typography>
        {isPending && (
          <Typography variant="caption" color="text.secondary">
            updating…
          </Typography>
        )}
        <Typography width={'1rem'} />
        {collapsible && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setCollapsed((v) => {
                const nv = !v;
                onVisibilityChange?.(!nv);
                const next = new URLSearchParams(searchParams);
                next.set('cshow', nv ? '0' : '1');
                // keep current page in URL too
                next.set('cpage', String(page));
                setSearchParams(next, { replace: false });
                return nv;
              });
            }}
          >
            {collapsed ? `Show (${totalRoots})` : 'Hide'}
          </Button>
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-around',
          alignContent: 'center',
          mt: '1rem',
        }}
      >
        {!collapsed && (
          <Card ref={hostRef} sx={{ mt: '0.5rem' }}>
            <CardContent>
              <>
                {loading && (
                  <Stack spacing={1}>
                    <SkeletonComment />
                    <SkeletonComment />
                    <SkeletonComment />
                  </Stack>
                )}

                {!loading && error && (
                  <Alert severity="error" sx={{ mb: '0.75rem' }}>
                    {error}
                  </Alert>
                )}

                {!loading && !error && (forest.length === 0 || totalRoots === 0) && (
                  <Typography color="text.secondary" textAlign="center">
                    No comments yet.
                  </Typography>
                )}

                {!loading && !error && totalRoots > 0 && (
                  <Stack spacing={1}>
                    {pageRoots.map((node) => (
                      <ThreadNodeView
                        key={`${node.identifier || node.id}::${node.rootId}`}
                        node={node}
                        avatars={avatars}
                        onReply={(n) => openNew(n)}
                        onEdit={(n) => openEdit(asWithFlags(n))}
                        onDelete={(n) => confirmDelete(asWithFlags(n))}
                        canEdit={
                          editMode && userName === (node.author || '') && !asWithFlags(node).deleted
                        }
                        isDeleted={Boolean(asWithFlags(node).deleted)}
                      />
                    ))}
                  </Stack>
                )}

                {/* Pagination controls */}
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mt: 2,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Showing newest {start + 1}-{end} of {totalRoots} threads
                  </Typography>
                  <Pagination
                    count={totalPages}
                    page={page}
                    onChange={(_, p) => goToPage(p)}
                    shape="rounded"
                    siblingCount={1}
                    boundaryCount={1}
                  />
                </Box>

                {/* Centered add button */}
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: '1rem' }}>
                  <InfoOutlineButton
                    variant="outlined"
                    onClick={() => openNew(null)}
                    sx={{
                      width: { xs: '100%', sm: 'auto' },
                      minWidth: { sm: '12rem' },
                      p: '0.5rem 1rem',
                    }}
                  >
                    Add Comment
                  </InfoOutlineButton>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: '0.5rem',
                  }}
                >
                  <Typography
                    variant="body2"
                    color="info.contrastText"
                    textAlign="right"
                    sx={{ mt: '1rem', flex: 1 }}
                  ></Typography>
                  <EditToggleButton
                    editing={editMode}
                    variant={editMode ? 'contained' : 'outlined'}
                    onClick={() => setEditMode((v) => !v)}
                    sx={{ ml: '1rem' }}
                  >
                    {editMode ? 'Disable Comment Edit Mode' : 'Enable Comment Edit Mode'}
                  </EditToggleButton>
                </Box>
              </>
            </CardContent>
          </Card>
        )}

        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          fullScreen={isXs} // full screen on phones
          fullWidth // still needed for layout
          maxWidth={false} // allow our custom width
          slotProps={{
            paper: { sx: dialogPaperSx(isXs) },
          }}
        >
          <DialogTitle>{replyTo ? 'Reply' : 'Publish Comment'}</DialogTitle>

          <DialogContent
            dividers
            sx={{
              // let the content scroll within the 75vh shell
              overflow: 'hidden',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            {/* reply preview (context) goes here */}

            {replyTo && (
              <ReplyPreview
                reply={replyTo}
                avatarUrl={avatars[replyTo.author || ''] ?? null}
                defaultCollapsed
              />
            )}

            <TiptapEditor value={html} onChange={setHtml} />

            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              NOTE - Only MINTERS, DEVS, and Primary Asset Group Members' comments will be
              displayed…
            </Typography>
          </DialogContent>

          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <BusyButton variant="contained" onClick={publish} loading={publishing}>
              {replyTo ? 'Reply' : 'Publish'}
            </BusyButton>
          </DialogActions>
        </Dialog>

        {/* Edit dialog */}
        <Dialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          fullScreen={isXs}
          fullWidth
          maxWidth={false}
          slotProps={{
            paper: { sx: dialogPaperSx(isXs) },
          }}
        >
          <DialogTitle>Edit Comment</DialogTitle>
          <DialogContent
            dividers
            sx={{
              // let the content scroll within the 75vh shell
              overflow: 'hidden',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <TiptapEditor value={editHtml} onChange={setEditHtml} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <BusyButton variant="contained" onClick={saveEdit} loading={publishing}>
              Save
            </BusyButton>
          </DialogActions>
        </Dialog>

        {/* Delete confirm */}
        <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Delete Comment?</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2">
              This will publish a small piece of data over the original comment, the original
              comment will no longer be available. If the comment is 'essential' to the comment
              threading, it will display 'content removed', if not, the comment will simply not show
              up at all.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <BusyButton
              color="error"
              variant="contained"
              onClick={performDelete}
              loading={deleting}
            >
              Delete
            </BusyButton>
          </DialogActions>
        </Dialog>
      </Box>
    </>
  );
}

type OnReply = (n: import('../../utils/thread').ThreadNode) => void;
type OnNode = (n: import('../../utils/thread').ThreadNode) => void;

function ThreadNodeView({
  node,
  avatars,
  onReply,
  onEdit,
  onDelete,
  canEdit,
  isDeleted,
}: {
  node: import('../../utils/thread').ThreadNode;
  avatars: Record<string, string | null>;
  onReply: OnReply;
  onEdit: OnNode;
  onDelete: OnNode;
  canEdit: boolean;
  isDeleted: boolean;
}) {
  const depth = Number.isFinite(node.depth) ? (node.depth as number) : 0;
  const kids = Array.isArray(node.children) ? node.children : [];
  const author = typeof node.author === 'string' && node.author ? node.author : 'unknown';
  // const ts = node.ts;
  const html = typeof node.html === 'string' ? node.html : '';
  const avatarUrl = avatars[author] ?? null;
  const isEdited =
    Number.isFinite(node.updatedTs) && (node.updatedTs as number) > (node.ts as number);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: '0.75rem',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        columnGap: '0.75rem',
        alignItems: 'flex-start',
        ml: `calc(${depth} * ${INDENT_STEP})`,
        opacity: isDeleted ? 0.7 : 1,
      }}
    >
      <Avatar
        src={avatarUrl || undefined}
        sx={{ width: `${AVATAR_SIZE}`, height: `${AVATAR_SIZE}` }}
      >
        {!avatarUrl ? (author[0]?.toUpperCase() ?? '?') : null}
      </Avatar>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {new Date(node.ts).toLocaleString()} — {author}
          {isEdited ? ` — edited ${new Date(node.updatedTs!).toLocaleString()}` : ''}
          {isDeleted ? ' — (deleted)' : ''}
        </Typography>

        {(node.roleTags?.length ?? 0) > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mt: '0.35rem', flexWrap: 'wrap', rowGap: '0.35rem' }}
          >
            {node.roleTags!.map((t, i) => (
              <TagChip key={`${node.identifier || node.id}-tag-${t}-${i}`} tag={t} />
            ))}
          </Stack>
        )}

        {!isDeleted && html ? (
          <Box
            sx={{ mt: '0.5rem', typography: 'body2', '& p': { mt: '0.5rem' } }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : isDeleted ? (
          <Typography sx={{ mt: '0.5rem' }} color="text.secondary" fontStyle="italic">
            (comment removed)
          </Typography>
        ) : (
          <Typography sx={{ mt: '0.5rem' }} color="text.secondary">
            (no content)
          </Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: '0.5rem' }}>
          <Button
            size="small"
            variant="text"
            onClick={() => onReply(node)}
            sx={{ fontSize: '0.9em', px: '0.5rem', py: '0.25rem' }}
            disabled={depth >= MAX_DEPTH || isDeleted}
          >
            Reply
          </Button>

          {canEdit && !isDeleted && (
            <Button
              size="small"
              variant="text"
              onClick={() => onEdit(node)}
              sx={{ fontSize: '0.9em', px: '0.5rem', py: '0.25rem' }}
            >
              Edit
            </Button>
          )}

          {canEdit && (
            <Button
              size="small"
              color="error"
              variant="text"
              onClick={() => onDelete(node)}
              sx={{ fontSize: '0.9em', px: '0.5rem', py: '0.25rem' }}
            >
              Delete
            </Button>
          )}
        </Stack>

        {kids.length > 0 && (
          <Stack spacing={1} sx={{ mt: '0.5rem' }}>
            {kids.map((child) => (
              <ThreadNodeView
                key={`${child.identifier || child.rootId}::${child.id}`}
                node={child}
                avatars={avatars}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                canEdit={canEdit && author === (child.author || '') && !(child as any).deleted}
                isDeleted={Boolean((child as any).deleted)}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
export { ThreadNodeView, ReplyPreview };
