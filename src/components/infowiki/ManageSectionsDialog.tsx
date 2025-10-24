import React, { memo, useEffect, useMemo, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Box,
  TextField,
  IconButton,
  Paper,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteIcon from '@mui/icons-material/Delete';
import type { WikiMenuItem } from '../../utils/access';

type Props = {
  open: boolean;
  initialMenu: WikiMenuItem[];
  onClose: () => void;
  onPublish: (cleaned: WikiMenuItem[]) => void;
  canPublish?: boolean;
};

const normId = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\- _]/g, '')
    .replace(/\s+/g, '-');

const ManageSectionsDialog = memo(function ManageSectionsDialog({
  open,
  initialMenu,
  onClose,
  onPublish,
  canPublish = true,
}: Props) {
  const [menu, setMenu] = useState<WikiMenuItem[]>([]);

  // seed/reset local draft when opened
  useEffect(() => {
    if (open) setMenu(initialMenu.map((m) => ({ ...m })));
  }, [open, initialMenu]);

  const moveItem = useCallback((idx: number, dir: -1 | 1) => {
    setMenu((list) => {
      const a = [...list];
      const j = idx + dir;
      if (j < 0 || j >= a.length) return a;
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });
  }, []);

  const removeItem = useCallback((idx: number) => {
    setMenu((list) => list.filter((_, i) => i !== idx));
  }, []);

  const addItem = useCallback(() => {
    setMenu((list) => [...list, { id: '', title: '', tags: [] }]);
  }, []);

  // Row component with local drafts for id/title/tags; commits on blur/Enter
  const Row = useCallback(
    ({ i, item }: { i: number; item: WikiMenuItem }) => {
      const [idDraft, setIdDraft] = useState(item.id ?? '');
      const [titleDraft, setTitleDraft] = useState(item.title ?? '');
      const [tagsDraft, setTagsDraft] = useState((item.tags || []).join(', '));

      useEffect(() => setIdDraft(item.id ?? ''), [item.id]);
      useEffect(() => setTitleDraft(item.title ?? ''), [item.title]);
      useEffect(() => setTagsDraft((item.tags || []).join(', ')), [item.tags]);

      const commit = () =>
        setMenu((list) => {
          const a = [...list];
          a[i] = {
            ...a[i],
            id: idDraft,
            title: titleDraft,
            tags: tagsDraft
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          };
          return a;
        });

      const onEnterCommit: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      };

      return (
        <Paper sx={{ p: 1 }} elevation={0}>
          <Box sx={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Section ID"
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={onEnterCommit}
              size="small"
              sx={{ flex: '1 1 12rem' }}
              slotProps={{ htmlInput: { inputMode: 'text', spellCheck: false } }}
            />
            <TextField
              label="Title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={onEnterCommit}
              size="small"
              sx={{ flex: '1 1 12rem' }}
            />
            <TextField
              label="Tags (comma sep)"
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={onEnterCommit}
              size="small"
              sx={{ flex: '2 1 16rem' }}
              slotProps={{ htmlInput: { inputMode: 'text', spellCheck: false } }}
            />
            <Box sx={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <IconButton size="small" onClick={() => moveItem(i, -1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => moveItem(i, +1)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => removeItem(i)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Paper>
      );
    },
    [moveItem, removeItem]
  );

  const cleaned = useMemo(
    () =>
      menu
        .map((m) => ({
          ...m,
          id: slug(normId(m.id)),
          title: (m.title || '').trim(),
          tags: (m.tags || []).map((t) => t.trim()).filter(Boolean),
        }))
        .filter((m) => m.id && m.title),
    [menu]
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Manage Sections (Menu)</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {menu.map((m, i) => (
            <Row key={i} i={i} item={m} />
          ))}
          <Box>
            <Button onClick={addItem}>Add Section</Button>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={() => onPublish(cleaned)} disabled={!canPublish}>
          Publish Menu
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default ManageSectionsDialog;
