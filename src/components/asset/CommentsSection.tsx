/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
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
} from '@mui/material';
import TagChip from './TagChip';
import { useAuth, objectToBase64 } from 'qapp-core';
import { useTheme } from '@mui/material';
import { assetCommentsPrefix, assetCommentId } from '../../constants/qdnConstants';
import { uniqueId6 } from '../../utils/ids';
import { base64ToObject } from '../../utils/data';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import TiptapEditor from '../TipTapEditor';

import type { ThreadComment } from '../../types/ThreadedComment';
import { buildCommentForest, stripPrefixId } from '../../utils/thread';

// import { isNameMemberOfGroupId } from '../../utils/access';
import { MINTER_GROUP_ID, DEV_GROUP_ID } from '../../constants/qdnConstants';
import {
  discoverEligibleCommentPublishers,
  type PublisherWithTags,
} from '../../utils/commentDiscovery';
import { SkeletonComment } from '../common/Loading';
import BusyButton from '../common/BusyButton';
import { searchSimpleByIdentifierPrefix } from '../../utils/searchSimple';
import { tagComments } from '../../utils/roles';
// import PublishedHtmlRenderer from '../PublishedHtmlRenderer';

type NodeWithTags = ThreadComment & { roleTags: string[] };

const MAX_DEPTH = 8; // safety cap for replies
const AVATAR_SIZE = '3rem';
const INDENT_STEP = '1.25rem';

export interface CommentsSectionProps {
  assetId: number;
  primaryGroupId: number;
  isIssuer: boolean;
  issuerName: string | null;
}

const toNode = (t: ThreadComment): NodeWithTags => ({
  ...t,
  roleTags: Array.isArray(t.roleTags) ? t.roleTags : [],
});

async function fetchHtmlComment(
  name: string,
  identifier: string,
  prefix: string
): Promise<ThreadComment | null> {
  try {
    const b64 = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name,
      identifier,
      encoding: 'base64',
    } as any);

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

    return {
      id,
      parentId,
      rootId,
      depth,
      ts: Number((obj as any).ts ?? Date.now()),
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
  isIssuer,
  issuerName,
}: CommentsSectionProps) {
  const { name: userName } = useAuth();
  const [items, setItems] = useState<NodeWithTags[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const [publishers, setPublishers] = useState<PublisherWithTags[]>([]);

  const [open, setOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadComment | null>(null);
  const [html, setHtml] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const prefix = useMemo(() => assetCommentsPrefix(assetId), [assetId]);
  // const forest = useMemo(() => buildCommentForest(items), [items]);
  const theme = useTheme();
  console.log('isIssuer?', isIssuer);

  // Load all existing comments (within the primary group namespace)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) One wide search: ALL results with this identifier prefix

        const hitsAll = await searchSimpleByIdentifierPrefix('DOCUMENT', prefix);

        const namesByIdentifier = hitsAll.reduce((m, h) => {
          const k = h.identifier;
          const arr = m.get(k) || [];
          arr.push(h.name);
          m.set(k, arr);
          return m;
        }, new Map<string, string[]>());

        // 2) sort
        const hits = hitsAll
          // stabilize order: by created, then identifier
          .sort(
            (a: any, b: any) => a.created - b.created || a.identifier.localeCompare(b.identifier)
          );

        // 3) Fetch each allowed doc → ThreadComment
        const initialDocs = await Promise.all(
          hits.map((h) => fetchHtmlComment(h.name, h.identifier, prefix))
        );
        const got = (initialDocs.filter(Boolean) as ThreadComment[]).filter(
          (() => {
            // de-dupe by id
            const seen = new Set<string>();
            return (d: ThreadComment) => (d.id && !seen.has(d.id) ? (seen.add(d.id), true) : false);
          })()
        );

        // 4) (Optional) backfill ancestors *only from allowed publishers*
        const haveIds = new Set(got.map((d) => d.id));
        const needIds = new Set<string>();
        for (const d of got) {
          if (d.parentId && !haveIds.has(d.parentId)) needIds.add(d.parentId);
          if (d.rootId && !haveIds.has(d.rootId)) needIds.add(d.rootId);
        }
        const backfilled: ThreadComment[] = [];
        for (const mid of needIds) {
          const fullIdentifier = `${prefix}${mid}`;
          // probe by the names that actually published this identifier (from hitsAll)
          const candidateNames = namesByIdentifier.get(fullIdentifier) ?? [];
          let found: ThreadComment | null = null;

          // try known publisher(s) first
          for (const nm of candidateNames) {
            // eslint-disable-next-line no-await-in-loop
            const doc = await fetchHtmlComment(nm, fullIdentifier, prefix);
            if (doc) {
              found = doc;
              break;
            }
          }

          // fallback: try any known authors from 'got' (last resort)
          if (!found && got.length) {
            const uniqueAuthors = Array.from(new Set(got.map((x) => x.author).filter(Boolean)));
            for (const nm of uniqueAuthors) {
              // eslint-disable-next-line no-await-in-loop
              const doc = await fetchHtmlComment(nm, fullIdentifier, prefix);
              if (doc) {
                found = doc;
                break;
              }
            }
          }

          if (found) {
            haveIds.add(found.id);
            backfilled.push(found);
          }
        }

        // 5) Attach role tags and sort
        const inputs = {
          primaryGroupId,
          MINTER_GROUP_ID,
          DEV_GROUP_ID,
          assetIssuer: issuerName || undefined,
        };
        // Tag once on the union
        const union = got.concat(backfilled);
        const finalTagged = await tagComments(union, inputs);

        // normalize author casing & sort by comment ts
        const flat = finalTagged
          .map(toNode)
          .map((c) => ({ ...c, author: (c.author || '').trim() })) // keep original case for display
          .sort((a, b) => a.ts - b.ts);

        if (!cancelled) setItems(flat);

        // 6) Avatars
        const authors = Array.from(new Set(flat.map((c) => c.author))).filter(Boolean);
        const kv = await Promise.all(
          authors.map(async (a) => [a, await fetchAccountAvatarDataUrl(a)] as const)
        );
        if (!cancelled) {
          const map: Record<string, string | null> = {};
          for (const [a, url] of kv) map[a] = url;
          setAvatars(map);
        }

        // Debug: prove it’s working
        console.log('[comments] hitsAll:', hitsAll.length, hitsAll.slice(0, 5));
        console.log('[comments] hitsAllowed:', hits.length, hits.slice(0, 5));
        console.log('[comments] docs fetched:', got.length);
        console.log('[comments] backfilled:', backfilled.length);
        console.log('[comments] forest roots:', buildCommentForest(flat).length);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load comments.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, primaryGroupId, prefix, issuerName]);

  // Eligibility: ISSUER, PRIMARY GROUP MEMBER/ADMIN, MINTER MEMBER/ADMIN, DEV MEMBER/ADMIN
  // const canPublish = useCallback(async (): Promise<boolean> => {
  //   if (isIssuer) return true;
  //   if (!userName) return false;

  //   const checks: Array<Promise<boolean>> = [];

  //   // PAG (member OR admin)
  //   if (Number.isFinite(primaryGroupId)) {
  //     checks.push(
  //       isNameMemberOfGroupId(userName as string, primaryGroupId)
  //         .then((r) => !!(r?.isMember || r?.isAdmin))
  //         .catch(() => false)
  //     );
  //   }

  //   // MINTER (member OR admin)
  //   if (Number.isFinite(MINTER_GROUP_ID)) {
  //     checks.push(
  //       isNameMemberOfGroupId(userName as string, MINTER_GROUP_ID)
  //         .then((r) => !!(r?.isMember || r?.isAdmin))
  //         .catch(() => false)
  //     );
  //   }

  //   // DEV (member OR admin)
  //   checks.push(
  //     isNameMemberOfGroupId(userName as string, DEV_GROUP_ID)
  //       .then((r) => !!(r?.isMember || r?.isAdmin))
  //       .catch(() => false)
  //   );

  //   if (!checks.length) return false;
  //   const results = await Promise.all(checks);
  //   return results.some(Boolean);
  // }, [userName, isIssuer, primaryGroupId]);

  const openNew = (parent?: ThreadComment | null) => {
    setReplyTo(parent ?? null);
    setHtml('');
    setOpen(true);
  };

  const publish = async () => {
    if (!userName) return alert('You need a Qortal name to publish.');
    // if (!(await canPublish())) return alert('You are not allowed to publish here.');
    const safeHtml = prepareHtmlForPublish(html, theme);
    if (!safeHtml.trim()) return alert('Comment is empty.');

    setPublishing(true);
    try {
      const id = uniqueId6();
      const parentId = replyTo ? replyTo.id : null;
      const rootId = replyTo ? replyTo.rootId || replyTo.id : id;
      const depth = replyTo ? Math.min(MAX_DEPTH, (replyTo.depth ?? 0) + 1) : 0;
      const myTags = publishers.find((p) => p.name === (userName as string))?.tags || [];

      const entry: ThreadComment = {
        id,
        rootId,
        parentId,
        depth,
        ts: Date.now(),
        author: userName,
        html: safeHtml,
        roleTags: Array.from(new Set(myTags)),
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

      setItems((prev) => [toNode(entry), ...prev]);
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

  const forest = useMemo(() => buildCommentForest(items), [items]);
  // const forest = items

  return (
    <>
      <Typography variant="h4" textAlign="center" sx={{ mt: '1rem' }}>
        Comments
      </Typography>

      <Card sx={{ mt: '0.5rem' }}>
        <CardContent>
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

          {!loading && !error && forest.length === 0 && (
            <Typography color="text.secondary" textAlign="center">
              No comments yet.
            </Typography>
          )}

          {!loading && !error && forest.length > 0 && (
            <Stack spacing={1}>
              {forest.map((node) => (
                <ThreadNodeView
                  key={`${node.identifier || node.id}::${node.rootId}`}
                  node={node}
                  avatars={avatars}
                  onReply={(n) => openNew(n)}
                />
              ))}
            </Stack>
          )}

          {/* Centered add button */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: '1rem' }}>
            <Button
              variant="outlined"
              onClick={() => openNew(null)}
              sx={{
                width: { xs: '100%', sm: 'auto' },
                minWidth: { sm: '12rem' },
                p: '0.5rem 1rem',
              }}
            >
              Add Comment
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{replyTo ? 'Reply' : 'Publish Comment'}</DialogTitle>
        <DialogContent dividers>
          {replyTo && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: '0.5rem' }}
            >
              Replying to <strong>{replyTo.author}</strong>
            </Typography>
          )}
          <TiptapEditor value={html} onChange={setHtml} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: '0.5rem', display: 'block' }}
          >
            NOTE - Only MINTERS, DEVS, and Primary Asset Group Members' comments will be
            displayed...
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <BusyButton variant="contained" onClick={publish} loading={publishing}>
            Publish
          </BusyButton>
        </DialogActions>
      </Dialog>
    </>
  );
}

type OnReply = (n: import('../../utils/thread').ThreadNode) => void;
/* ------------------ Presentational subcomponent (recursive) ------------------ */
function ThreadNodeView({
  node,
  avatars,
  onReply,
}: {
  node: import('../../utils/thread').ThreadNode;
  avatars: Record<string, string | null>;
  onReply: OnReply;
}) {
  const depth = Number.isFinite(node.depth) ? (node.depth as number) : 0;
  const kids = Array.isArray(node.children) ? node.children : [];
  const author = typeof node.author === 'string' && node.author ? node.author : 'unknown';
  const ts = typeof node.ts === 'number' ? node.ts : Date.now();
  const html = typeof node.html === 'string' ? node.html : '';
  const avatarUrl = avatars[author] ?? null;

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
          {new Date(ts).toLocaleString()} — {author}
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

        {html ? (
          <Box
            sx={{ mt: '0.5rem', typography: 'body2', '& p': { mt: '0.5rem' } }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <Typography sx={{ mt: '0.5rem' }} color="text.secondary">
            (no content)
          </Typography>
        )}

        <Box sx={{ mt: '0.5rem' }}>
          <Button
            size="small"
            variant="text"
            onClick={() => onReply(node)}
            sx={{ fontSize: '0.9em', px: '0.5rem', py: '0.25rem' }}
            disabled={depth >= MAX_DEPTH}
          >
            Reply
          </Button>
        </Box>

        {kids.length > 0 && (
          <Stack spacing={1} sx={{ mt: '0.5rem' }}>
            {kids.map((child) => (
              <ThreadNodeView
                key={`${child.identifier || child.rootId}::${child.id}`}
                node={child}
                avatars={avatars}
                onReply={onReply}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
