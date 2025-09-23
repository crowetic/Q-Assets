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
  useTheme,
  useMediaQuery,
} from '@mui/material';

import { useQDeck } from './QDeckProvider';
import TiptapEditor from '../TipTapEditor';
import { ThreadNodeView, ReplyPreview } from '../comments/CommentsSection';
import { Spacer } from 'qapp-core';
import { ThreadNode } from '../../utils/thread';

type Props = {
  cardId: string;
  canComment: boolean;
  showAdminsBadge?: boolean;
};

const MAX_DEPTH = 8;

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

  const [open, setOpen] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<UINode | null>(null);
  const [html, setHtml] = React.useState('');

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

  const forest = React.useMemo<ThreadNode[]>(
    () => buildThreadForestFromCardComments(items),
    [items]
  );

  const openNew = (parent?: ThreadNode | null) => {
    setReplyTo(parent ?? null);
    setHtml('');
    setOpen(true);
  };

  const publish = async () => {
    if (!html.trim() || !canComment) return;
    await addComment(cardId, html, replyTo?.id);
    setOpen(false);
    setReplyTo(null);
    setHtml('');
    await loadCommentsForCard(cardId);
  };

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
        <Typography variant="h4" textAlign="center">
          Comments
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: '1rem' }}>
        <Card sx={{ mt: '0.5rem', width: '100%' }}>
          <CardContent>
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
                    avatars={{}} // inject avatar map later if you want
                    onReply={(n: any) => openNew(n)}
                    onEdit={() => {
                      /* editing not yet implemented for Q-Deck */
                    }}
                    onDelete={() => {
                      /* deletion not yet implemented for Q-Deck */
                    }}
                    canEdit={false}
                    isDeleted={false}
                  />
                ))}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
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
            </Box>
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
            <Button variant="contained" onClick={publish} disabled={!canComment || !html.trim()}>
              {replyTo ? 'Reply' : 'Publish'}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </>
  );
}
