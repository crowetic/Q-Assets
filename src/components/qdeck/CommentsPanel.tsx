import * as React from 'react';
import { Box, Stack, Typography, Divider, Button, Chip } from '@mui/material';
import { useQDeck } from './QDeckProvider';
import TiptapEditor from '../TipTapEditor';

export default function CommentsPanel({
  cardId,
  canComment,
  showAdminsBadge = false,
}: {
  cardId: string;
  canComment: boolean;
  showAdminsBadge?: boolean; // purely visual; visibility routing is handled in qdeckApi
}) {
  const { comments, addComment, loadCommentsForCard } = useQDeck();
  const thread = comments[cardId];
  const [draftHtml, setDraftHtml] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!thread) void loadCommentsForCard(cardId);
  }, [thread, cardId, loadCommentsForCard]);

  const list = thread?.comments ?? [];

  const onPost = async () => {
    const html = (draftHtml || '').trim();
    if (!html) return;
    await addComment(cardId, html, replyTo ?? undefined);
    setDraftHtml('');
    setReplyTo(null);
    // reload to merge in our new comment + any concurrent writers
    void loadCommentsForCard(cardId);
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">Comments</Typography>
        {showAdminsBadge && <Chip size="small" label="Admins Scope" />}
      </Stack>
      <Divider />

      <Stack spacing={1}>
        {list.length === 0 && (
          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            No comments yet.
          </Typography>
        )}

        {list.map((c) => (
          <Box
            key={c.commentId}
            sx={{ p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
          >
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {c.author} · {new Date(c.createdAt).toLocaleString()}
            </Typography>
            <Box sx={{ mt: 0.5 }} dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
            {canComment && (
              <Button
                size="small"
                sx={{ mt: 0.5 }}
                variant={replyTo === c.commentId ? 'contained' : 'text'}
                onClick={() => setReplyTo((r) => (r === c.commentId ? null : c.commentId))}
              >
                {replyTo === c.commentId ? 'Cancel reply' : 'Reply'}
              </Button>
            )}
          </Box>
        ))}
      </Stack>

      {canComment && (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            {replyTo ? `Replying to #${replyTo.slice(0, 6)}…` : 'New comment'}
          </Typography>
          <Box sx={{ mt: 1 }}>
            <TiptapEditor value={draftHtml} onChange={setDraftHtml} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
            <Button
              size="small"
              onClick={() => {
                setDraftHtml('');
                setReplyTo(null);
              }}
            >
              Clear
            </Button>
            <Button size="small" variant="contained" onClick={onPost}>
              Post
            </Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
