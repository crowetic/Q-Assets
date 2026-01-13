import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Stack,
  Typography,
  TextField,
  IconButton,
  Tooltip,
  Divider,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import type { QDeckBoard, QDeckList } from '../../types/qdeck';
import { uniqueId6 } from '../../utils/ids';

type DraftList = QDeckList & {
  colorHex: string;
  colorTouched: boolean;
};

export type ManageListsDialogHandle = {
  open: () => void;
  close: () => void;
};

type Props = {
  board: QDeckBoard | null;
  onSave: (lists: QDeckList[]) => Promise<void> | void;
};

const DEFAULT_COLOR = '#e0e0e0';
const FAINT_ALPHA = 0.08;

const toHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : { r, g, b };
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : { r, g, b };
  }
  return null;
};

const toHexColor = (color?: string) => {
  if (!color) return null;
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const rgb = hexToRgb(trimmed);
    return rgb ? `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}` : null;
  }
  const match = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 3) return null;
  const [r, g, b] = parts;
  if (![r, g, b].every((value) => Number.isFinite(value))) return null;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const toFaintColor = (hex: string) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${FAINT_ALPHA})`;
};

const seedDrafts = (lists: QDeckList[]): DraftList[] =>
  lists.map((list) => ({
    ...list,
    colorHex: toHexColor(list.faintColor) || DEFAULT_COLOR,
    colorTouched: false,
  }));

const ManageListsDialog = React.forwardRef<ManageListsDialogHandle, Props>(
  ({ board, onSave }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [drafts, setDrafts] = React.useState<DraftList[]>([]);

    const sortedLists = React.useMemo(
      () => (board?.lists ?? []).slice().sort((a, b) => a.order - b.order),
      [board?.lists]
    );
    const baseMap = React.useMemo(
      () => new Map((board?.lists ?? []).map((list) => [list.listId, list])),
      [board?.lists]
    );

    React.useImperativeHandle(
      ref,
      () => ({
        open: () => {
          if (!board) return;
          setOpen(true);
        },
        close: () => setOpen(false),
      }),
      [board]
    );

    React.useEffect(() => {
      if (!open) return;
      setDrafts(seedDrafts(sortedLists));
    }, [open, sortedLists]);

    const updateDraft = React.useCallback((listId: string, updater: (list: DraftList) => DraftList) => {
      setDrafts((prev) => prev.map((list) => (list.listId === listId ? updater(list) : list)));
    }, []);

    const handleMove = React.useCallback((listId: string, direction: 'up' | 'down') => {
      setDrafts((prev) => {
        const next = [...prev];
        const idx = next.findIndex((list) => list.listId === listId);
        if (idx === -1) return prev;
        const target = direction === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= next.length) return prev;
        const temp = next[target];
        next[target] = next[idx];
        next[idx] = temp;
        return next;
      });
    }, []);

    const handleRemove = React.useCallback((listId: string) => {
      setDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((list) => list.listId !== listId)));
    }, []);

    const handleAdd = React.useCallback(() => {
      const id = uniqueId6();
      setDrafts((prev) => [
        ...prev,
        {
          listId: id,
          title: 'NEW LIST',
          order: prev.length,
          faintColor: undefined,
          colorHex: DEFAULT_COLOR,
          colorTouched: false,
        },
      ]);
    }, []);

    const handleSave = React.useCallback(async () => {
      if (!board) return;
      const nextLists = drafts.map((draft, index) => {
        const base = baseMap.get(draft.listId);
        const { colorHex, colorTouched, ...rest } = draft;
        const trimmed = (rest.title || base?.title || '').trim();
        const title = trimmed ? trimmed.toUpperCase() : base?.title || 'UNTITLED';
        let faintColor = base?.faintColor;
        if (colorTouched) {
          if (rest.faintColor !== undefined) {
            faintColor = rest.faintColor;
          } else if (colorHex && colorHex !== DEFAULT_COLOR) {
            faintColor = toFaintColor(colorHex);
          } else {
            faintColor = undefined;
          }
        }
        return {
          ...base,
          ...rest,
          title,
          faintColor,
          order: index,
        } as QDeckList;
      });
      await onSave(nextLists);
      setOpen(false);
    }, [board, drafts, baseMap, onSave]);

    return (
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Manage lists</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {drafts.map((list, index) => (
              <Box
                key={list.listId}
                sx={{
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  borderRadius: 2,
                  p: 1.5,
                }}
              >
                <Stack spacing={1}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                  >
                    <TextField
                      fullWidth
                      size="small"
                      label="List title"
                      value={list.title}
                      onChange={(e) =>
                        updateDraft(list.listId, (current) => ({
                          ...current,
                          title: e.target.value,
                        }))
                      }
                    />
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: 1,
                          border: (theme) => `1px solid ${theme.palette.divider}`,
                          backgroundColor: list.faintColor || 'transparent',
                        }}
                      />
                      <Box
                        component="input"
                        type="color"
                        aria-label="List color"
                        value={list.colorHex}
                        onChange={(e) => {
                          const hex = e.target.value;
                          updateDraft(list.listId, (current) => ({
                            ...current,
                            colorHex: hex,
                            colorTouched: true,
                            faintColor: toFaintColor(hex),
                          }));
                        }}
                        sx={{
                          width: 36,
                          height: 32,
                          border: 'none',
                          background: 'none',
                          p: 0,
                        }}
                      />
                      <Button
                        size="small"
                        onClick={() =>
                          updateDraft(list.listId, (current) => ({
                            ...current,
                            colorHex: DEFAULT_COLOR,
                            colorTouched: true,
                            faintColor: undefined,
                          }))
                        }
                      >
                        Clear
                      </Button>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      Order: {index + 1}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Tooltip title="Move up">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleMove(list.listId, 'up')}
                            disabled={index === 0}
                          >
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleMove(list.listId, 'down')}
                            disabled={index >= drafts.length - 1}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Remove list">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemove(list.listId)}
                            disabled={drafts.length <= 1}
                          >
                            <DeleteForeverIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Stack>
              </Box>
            ))}
            {!drafts.length && (
              <Typography variant="body2" color="text.secondary">
                No lists found.
              </Typography>
            )}
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Button variant="outlined" startIcon={<PlaylistAddIcon />} onClick={handleAdd}>
            Add list
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
          <Button variant="contained" onClick={handleSave} disabled={!drafts.length}>
            Save changes
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
);

ManageListsDialog.displayName = 'ManageListsDialog';

export default ManageListsDialog;
