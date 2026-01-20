import * as React from 'react';
import {
  Box,
  Card,
  CardContent,
  Stack,
  Typography,
  Button,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  FormControlLabel,
  Checkbox,
  useTheme,
  useMediaQuery,
} from '@mui/material';

import { useQDeck } from './QDeckProvider';
import TiptapEditor from '../TipTapEditor';
import { ThreadNodeView, ReplyPreview } from '../comments/CommentsSection';
import { ThreadNode } from '../../utils/thread';
import { useActiveAccountName } from '../../hooks/useActiveAccountName';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import pLimit from 'p-limit';

type Props = {
  cardId: string;
  canComment: boolean;
  showAdminsBadge?: boolean;
};

// const MAX_DEPTH = 8;

type UINode = {
  id: string;
  rootId?: string | null;
  parentId?: string | null;
  depth?: number;
  author?: string;
  html?: string;
  ts?: number;
  createdTs?: number;
  updatedTs?: number;
  children: UINode[];
};

export default function QDeckCommentsSection({ cardId, canComment }: Props) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const { comments, loadCommentsForCard, addComment } = useQDeck();
  const { activeName, availableNames, namesLoading } = useActiveAccountName();
  const [useGlobalName, setUseGlobalName] = React.useState(true);
  const [overrideName, setOverrideName] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<UINode | null>(null);
  const [html, setHtml] = React.useState('');
  const [avatars, setAvatars] = React.useState<Record<string, string | null>>({});
  const avatarsRef = React.useRef<Record<string, string | null>>(avatars);

  React.useEffect(() => {
    avatarsRef.current = avatars;
  }, [avatars]);

  React.useEffect(() => {
    if (useGlobalName) return;
    if (overrideName && availableNames.includes(overrideName)) return;
    const fallback = activeName ?? availableNames[0] ?? null;
    if (fallback) setOverrideName(fallback);
  }, [useGlobalName, overrideName, activeName, availableNames]);

  const publisherName = useGlobalName ? activeName : overrideName;

  function buildThreadForestFromCardComments(
    items: Array<{
      commentId: string;
      parentId?: string;
      author?: string;
      bodyHtml: string;
      createdAt: number;
      updatedAt?: number;
    }>
  ): ThreadNode[] {
    // 1) Normalize CardComment -> partial ThreadNode
    const byId = new Map<string, ThreadNode>();
    const roots: ThreadNode[] = [];

    for (const c of items) {
      if (!c?.commentId) continue;

      const node: ThreadNode = {
        // ---- ThreadComment fields (required) ----
        id: c.commentId,
        rootId: '', // fill later
        parentId: c.parentId ?? null, // ThreadComment allows null
        depth: 0, // fill later
        author: c.author || 'unknown',
        html: c.bodyHtml || '', // <-- map bodyHtml -> html
        ts: c.createdAt || 0, // display ts
        createdTs: c.createdAt || 0, // required by asset UI
        updatedTs: c.updatedAt, // optional is fine

        // ---- ThreadNode fields ----
        children: [], // will link below
        // identifier? optional — leave undefined
        // roleTags? optional — leave undefined
      };

      byId.set(node.id, node);
    }

    // 2) Link children, collect roots
    for (const node of byId.values()) {
      const pid = node.parentId;
      if (pid && byId.has(pid)) {
        byId.get(pid)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // 3) BFS to fill depth and rootId (required, string)
    const MAX_DEPTH = 8;
    const q: Array<{ n: ThreadNode; depth: number; root: string }> = [];

    for (const r of roots) q.push({ n: r, depth: 0, root: r.id });

    while (q.length) {
      const { n, depth, root } = q.shift()!;
      n.depth = Math.max(0, Math.min(MAX_DEPTH, depth));
      n.rootId = root; // <-- ensure string rootId

      for (const child of n.children) {
        q.push({ n: child, depth: depth + 1, root });
      }
    }

    // 4) Sort roots newest-first; children already in insertion order
    roots.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return roots;
  }

  // initial load
  React.useEffect(() => {
    if (!comments[cardId]) void loadCommentsForCard(cardId);
  }, [cardId, comments, loadCommentsForCard]);

  const thread = comments[cardId];
  const items = thread?.comments ?? [];
  const commentCount = items.length;

  const forest = React.useMemo<ThreadNode[]>(
    () => buildThreadForestFromCardComments(items),
    [items]
  );

  React.useEffect(() => {
    if (!items.length) return;
    const authors = Array.from(new Set(items.map((c) => (c.author || '').trim()).filter(Boolean)));
    if (!authors.length) return;

    let cancelled = false;
    const limit = pLimit(10);

    void Promise.all(
      authors.map((author) =>
        limit(async () => {
          if (cancelled) return;
          if (avatarsRef.current[author] !== undefined) return;
          const url = await fetchAccountAvatarDataUrl(author);
          if (cancelled) return;
          setAvatars((current) =>
            current[author] !== undefined ? current : { ...current, [author]: url }
          );
        })
      )
    );

    return () => {
      cancelled = true;
    };
  }, [items]);

  const openNew = (parent?: ThreadNode | null) => {
    setReplyTo(parent ?? null);
    setHtml('');
    setOpen(true);
  };

  const publish = async () => {
    if (!publisherName || !html.trim() || !canComment) return;
    await addComment(cardId, html, replyTo?.id, { publisherName });
    if (publisherName && avatarsRef.current[publisherName] === undefined) {
      const url = await fetchAccountAvatarDataUrl(publisherName);
      setAvatars((current) =>
        current[publisherName] !== undefined ? current : { ...current, [publisherName]: url }
      );
    }
    setOpen(false);
    setReplyTo(null);
    setHtml('');
    await loadCommentsForCard(cardId);
  };

  const addCommentButton = (
    <Button
      variant="outlined"
      onClick={() => openNew(null)}
      disabled={!canComment}
      sx={{
        width: { xs: '100%', sm: 'auto' },
        minWidth: { sm: '12rem' },
        p: '0.5rem 1rem',
      }}
    >
      Add Comment
    </Button>
  );

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: '1rem' }}>
        <Card sx={{ mt: '0.5rem', width: '100%' }}>
          <CardContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              justifyContent="space-between"
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="h6">Comments ({commentCount})</Typography>
                <Typography variant="body2" color="text.secondary">
                  Share updates, feedback, and follow-ups.
                </Typography>
              </Box>
              {addCommentButton}
            </Stack>

            {(!thread || items.length === 0) && (
              <Typography color="text.secondary" textAlign="center">
                No comments yet.
              </Typography>
            )}

            {items.length > 0 && (
              <Stack spacing={1}>
                {forest.map((node) => (
                  <ThreadNodeView
                    key={node.id}
                    node={node}
                    avatars={avatars}
                    onReply={(n: any) => openNew(n)}
                    onEdit={() => {
                      /* editing not yet implemented for Q-Deck */
                    }}
                    onDelete={() => {
                      /* deletion not yet implemented for Q-Deck */
                    }}
                    canEdit={false}
                    isDeleted={false}
                    headerLayout="name-first"
                  />
                ))}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', justifyContent: 'center' }}>{addCommentButton}</Box>
          </CardContent>
        </Card>

        {/* Compose dialog */}
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          fullScreen={isXs}
          fullWidth
          maxWidth={false}
          PaperProps={{
            sx: {
              width: isXs ? '100vw' : '75vw',
              height: isXs ? '100vh' : '75vh',
              maxWidth: '100vw',
              maxHeight: '100vh',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <DialogTitle>{replyTo ? 'Reply' : 'Publish Comment'}</DialogTitle>
          <DialogContent
            dividers
            sx={{ overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}
          >
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={useGlobalName}
                    onChange={(e) => setUseGlobalName(e.target.checked)}
                    disabled={namesLoading}
                  />
                }
                label="Use global active name"
              />
              {useGlobalName ? (
                <Typography variant="body2" color={publisherName ? 'text.secondary' : 'error'}>
                  {publisherName ? `Publishing as: ${publisherName}` : 'No active name selected'}
                </Typography>
              ) : (
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="qdeck-comment-name">Publish as</InputLabel>
                  <Select
                    labelId="qdeck-comment-name"
                    label="Publish as"
                    value={overrideName || ''}
                    onChange={(e) => {
                      const next = e.target.value ? String(e.target.value) : '';
                      setOverrideName(next || null);
                    }}
                    disabled={namesLoading || availableNames.length === 0}
                    displayEmpty
                  >
                    {availableNames.length === 0 && (
                      <MenuItem value="" disabled>
                        {namesLoading ? 'Loading names...' : 'No names available'}
                      </MenuItem>
                    )}
                    {availableNames.map((name) => (
                      <MenuItem key={name} value={name}>
                        {name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>
            {replyTo && (
              <ReplyPreview
                reply={
                  {
                    id: replyTo.id,
                    author: replyTo.author || 'unknown',
                    html: replyTo.html || '', // <-- ensure html is present
                    createdTs: replyTo.ts || Date.now(),
                  } as any
                }
                avatarUrl={null}
                defaultCollapsed
              />
            )}
            <TiptapEditor value={html} onChange={setHtml} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Comments are published under your QDN name and merged across issuers.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={publish}
              disabled={!publisherName || !canComment || !html.trim()}
            >
              {replyTo ? 'Reply' : 'Publish'}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </>
  );
}
