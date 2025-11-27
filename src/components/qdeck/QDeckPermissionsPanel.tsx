import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  Button,
  ListItem,
  List,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
// import GroupIcon from '@mui/icons-material/Group';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
// import DeleteIcon from '@mui/icons-material/Delete';
import { QDeckBoard } from '../../types/qdeck';
import {
  loadBoardsIndex,
  loadCardsIndex,
  loadCardDoc,
  resolveBoardForRead,
  saveBoardDoc,
  updateCardArchiveState,
} from '../../utils/qdeckApi';
import { useAuth } from 'qapp-core';
import pLimit from 'p-limit';
import { getAccountGroups, type GroupSummary } from '../../utils/qortalApi';

type EditableBoard = QDeckBoard & {
  isDirty?: boolean;
  newOwner?: string;
  newEditor?: string;
  newOwnerGroup?: string;
  newEditorGroup?: string;
  encryption?: string;
};

type CardVariantInfo = {
  cardId: string;
  title: string;
  publisher: string;
  updatedAt: number;
  createdAt?: number;
};

type BoardCardsState = {
  board: QDeckBoard;
  variants: Record<string, CardVariantInfo[]>;
  archived: Set<string>;
  preferred?: Record<string, string>;
};

export default function QDeckPermissionsPanel() {
  const { name: myName } = useAuth() as any;
  const [boards, setBoards] = useState<EditableBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardsState, setCardsState] = useState<Record<string, BoardCardsState>>({});
  const limit = useMemo(() => pLimit(6), []);
  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  // const isPrivate = (b: QDeckBoard) => b.visibility === 'private';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!myName) throw new Error('Authenticate to load your boards');
      const idx = await loadBoardsIndex(myName);
      const entries = idx?.boards ?? [];
      const mapped: EditableBoard[] = [];

      for (const entry of entries) {
        const issuer = entry.issuerName || idx?.issuerName || myName;
        // load full board doc for accurate perms (skip private for now)
        const resolved =
          entry.visibility === 'private'
            ? null
            : await resolveBoardForRead(issuer, entry.boardId, entry.visibility);

        const base = resolved || (entry as any);
        const ownerGroups = base.ownerGroups || [];
        const editorGroups = Array.from(
          new Set([...(base.editorGroups || base.groupsAllowed || []), ...ownerGroups])
        );

        mapped.push({
          ...(base as any),
          visibility: base.visibility ?? entry.visibility,
          owners: base.owners || [base.createdBy || issuer || myName],
          ownerGroups,
          editors: base.editors || base.usersAllowed || [],
          editorGroups,
          featureFlags: base.featureFlags || {},
          createdBy: base.createdBy || issuer || myName,
          // show encryption mode for private boards
          encryption:
            entry.visibility === 'private'
              ? base.privateMeta?.mode === 'direct'
                ? 'Direct'
                : 'Group'
              : undefined,
        });
      }
      setBoards(mapped);
    } catch (e: any) {
      setError(e?.message || 'Failed to load boards index');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [myName]);

  useEffect(() => {
    if (!myName) return;
    getAccountGroups(myName)
      .then((gs) => setMyGroups(gs))
      .catch(() => setMyGroups([]));
  }, [myName]);

  const updateFlag = (boardId: string, flag: keyof NonNullable<QDeckBoard['featureFlags']>) => {
    setBoards((prev) =>
      prev.map((b) =>
        b.boardId === boardId
          ? {
              ...b,
              featureFlags: { ...(b.featureFlags || {}), [flag]: !b.featureFlags?.[flag] },
              isDirty: true,
            }
          : b
      )
    );
  };

  const addName = (boardId: string, field: 'owners' | 'editors', value?: string) => {
    const v = (value || '').trim();
    if (!v) return;
    setBoards((prev) =>
      prev.map((b) =>
        b.boardId === boardId
          ? { ...b, [field]: Array.from(new Set([...(b[field] || []), v])), isDirty: true }
          : b
      )
    );
  };

  const removeName = (boardId: string, field: 'owners' | 'editors', value: string) => {
    setBoards((prev) =>
      prev.map((b) =>
        b.boardId === boardId
          ? { ...b, [field]: (b[field] || []).filter((x) => x !== value), isDirty: true }
          : b
      )
    );
  };

  const addOwnerGroup = (boardId: string, groupId: number) => {
    setBoards((prev) =>
      prev.map((b) => {
        if (b.boardId !== boardId) return b;
        const ownerGroups = Array.from(new Set([...(b.ownerGroups || []), groupId]));
        const editorGroups = Array.from(new Set([...(b.editorGroups || []), groupId]));
        return { ...b, ownerGroups, editorGroups, isDirty: true };
      })
    );
  };

  const addEditorGroup = (boardId: string, groupId: number) => {
    setBoards((prev) =>
      prev.map((b) => {
        if (b.boardId !== boardId) return b;
        const editorGroups = Array.from(new Set([...(b.editorGroups || []), groupId]));
        return { ...b, editorGroups, isDirty: true };
      })
    );
  };

  const dirtyCount = useMemo(() => boards.filter((b) => b.isDirty).length, [boards]);

  const loadCardsForBoard = async (entry: EditableBoard) => {
    if (!myName) return setError('Authenticate first.');
    setLoading(true);
    setError(null);
    try {
      const resolved = await resolveBoardForRead(myName, entry.boardId, entry.visibility as any);
      if (!resolved) throw new Error('Failed to load board doc');
      const idx = await loadCardsIndex(resolved.createdBy, resolved);
      const refs =
        idx?.entries && idx.entries.length
          ? idx.entries
          : idx?.cardIds?.map((cid) => ({ name: resolved.createdBy, cardId: cid })) || [];
      const archived = new Set(idx?.archivedIds ?? []);

      const cards = await Promise.all(
        refs.map((r) =>
          limit(async () => {
            try {
              const doc = await loadCardDoc(r.name, resolved, r.cardId);
              if (!doc || (doc as any)._type === 'QDECK_TOMBSTONE') return null;
              return doc;
            } catch {
              return null;
            }
          })
        )
      );

      const variants: Record<string, CardVariantInfo[]> = {};
      cards.filter(Boolean).forEach((c: any) => {
        variants[c.cardId] = variants[c.cardId] || [];
        variants[c.cardId].push({
          cardId: c.cardId,
          title: c.title,
          publisher: c.createdBy,
          updatedAt: c.updatedAt,
          createdAt: c.createdAt,
        });
      });

      setCardsState((prev) => ({
        ...prev,
        [entry.boardId]: {
          board: resolved,
          variants,
          archived,
          preferred: resolved.preferredVariants || {},
        },
      }));
    } catch (e: any) {
      setError(e?.message || 'Failed to load cards');
    } finally {
      setLoading(false);
    }
  };

  const setPreferred = (boardId: string, cardId: string, publisher: string) => {
    setCardsState((prev) => {
      const cs = prev[boardId];
      if (!cs) return prev;
      return {
        ...prev,
        [boardId]: {
          ...cs,
          preferred: { ...(cs.preferred || {}), [cardId]: publisher },
        },
      };
    });
    setBoards((prev) =>
      prev.map((b) =>
        b.boardId === boardId
          ? {
              ...b,
              isDirty: true,
              featureFlags: { ...(b.featureFlags || {}), cardVariants: true },
            }
          : b
      )
    );
  };

  const toggleArchive = async (boardId: string, cardId: string, archived: boolean) => {
    const cs = cardsState[boardId];
    if (!cs || !myName) return;
    setLoading(true);
    setError(null);
    try {
      await updateCardArchiveState(myName, cs.board, cardId, archived);
      setCardsState((prev) => {
        const cur = prev[boardId];
        if (!cur) return prev;
        const nextArchived = new Set(cur.archived);
        if (archived) nextArchived.add(cardId);
        else nextArchived.delete(cardId);
        return { ...prev, [boardId]: { ...cur, archived: nextArchived } };
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to update archive state');
    } finally {
      setLoading(false);
    }
  };

  const saveAll = async () => {
    if (!myName) return setError('Authenticate first.');
    const dirtyBoards = boards.filter((b) => b.isDirty);
    if (!dirtyBoards.length) return;
    setLoading(true);
    setError(null);

    try {
      for (const b of dirtyBoards) {
        // load full board doc with resolver (handles public/private)
        const resolved = await resolveBoardForRead(myName, b.boardId, b.visibility as any).catch(
          () => null
        );
        if (!resolved) {
          setError(`Failed to load board ${b.title} for save`);
          continue;
        }

        const next: QDeckBoard = { ...resolved };
        next.updatedAt = Date.now();
        next.featureFlags = { ...(next.featureFlags || {}), ...(b.featureFlags || {}) };
        next.owners = b.owners && b.owners.length ? b.owners : [next.createdBy];
        next.ownerGroups = b.ownerGroups ?? [];
        next.editors = b.editors ?? [];
        next.editorGroups = b.editorGroups ?? [];
        if (cardsState[b.boardId]?.preferred) {
          next.preferredVariants = cardsState[b.boardId].preferred;
          next.featureFlags = { ...(next.featureFlags || {}), cardVariants: true };
        }

        // Mirror to legacy fields for compatibility
        next.usersAllowed = next.editors;
        next.groupsAllowed = next.editorGroups?.length ? next.editorGroups : next.groupsAllowed;

        await saveBoardDoc(myName, next);
      }

      // reload list and clear dirty flags
      await load();
      setBoards((prev) => prev.map((b) => ({ ...b, isDirty: false })));
    } catch (e: any) {
      setError(e?.message || 'Failed to save changes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ p: 1.5 }}>
      <CardHeader
        title="Q-Deck Permissions"
        subheader="Manage admins/editors and enable enhanced permissions, variants, and archiving."
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Reload boards">
              <IconButton size="small" onClick={load} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveIcon />}
              disabled={dirtyCount === 0 || loading}
              onClick={saveAll}
            >
              Save changes
            </Button>
          </Stack>
        }
      />
      <Divider />
      {error && (
        <Typography color="error" variant="body2" sx={{ mt: 1, mb: 1 }}>
          {error}
        </Typography>
      )}
      {boards.length === 0 && !loading ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          No boards found for your account.
        </Typography>
      ) : (
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {boards.map((b) => {
            const isPriv = b.visibility === 'private';
            const disableProps = isPriv
              ? {
                  sx: { opacity: 0.6, pointerEvents: 'none' as const },
                }
              : {};
            return (
              <Card key={b.boardId} variant="outlined">
                {isPriv && (
                  <Box sx={{ p: 1, pb: 0, opacity: 0.7 }}>
                    <Typography variant="caption" color="text.secondary">
                      Private board permissions are read-only for now. Editing support coming soon.
                    </Typography>
                  </Box>
                )}
                <CardContent {...disableProps}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                    <Box>
                      <Typography variant="subtitle1">{b.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {b.boardId} · {b.visibility}
                        {b.encryption ? ` (${b.encryption})` : ''} · {b.createdBy}
                      </Typography>
                    </Box>
                    {b.isDirty && (
                      <Chip size="small" color="warning" label="Unsaved" sx={{ fontWeight: 600 }} />
                    )}
                  </Box>

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={700}>
                        Admins
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(b.owners || []).map((o) => (
                          <Chip
                            key={o}
                            label={o}
                            onDelete={() => removeName(b.boardId, 'owners', o)}
                            size="small"
                          />
                        ))}
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <TextField
                          size="small"
                          label="Add admin (name)"
                          value={(b as any).newOwner || ''}
                          onChange={(e) =>
                            setBoards((prev) =>
                              prev.map((x) =>
                                x.boardId === b.boardId ? { ...x, newOwner: e.target.value } : x
                              )
                            )
                          }
                          fullWidth
                          disabled={isPriv}
                        />
                        <IconButton
                          color="primary"
                          onClick={() => {
                            addName(b.boardId, 'owners', (b as any).newOwner);
                            setBoards((prev) =>
                              prev.map((x) =>
                                x.boardId === b.boardId ? { ...x, newOwner: '' } : x
                              )
                            );
                          }}
                          disabled={isPriv}
                        >
                          <AddIcon />
                        </IconButton>
                      </Stack>

                      <Typography variant="body2" fontWeight={700} sx={{ mt: 1 }}>
                        Admin Groups (admins of these groups)
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(b.ownerGroups || []).map((g) => {
                          const group = myGroups.find((mg) => mg.groupId === g);
                          const label = group ? `${group.groupName} (#${g})` : `Group ${g}`;
                          return (
                            <Chip
                              key={g}
                              label={label}
                              onDelete={() =>
                                setBoards((prev) =>
                                  prev.map((x) =>
                                    x.boardId === b.boardId
                                      ? {
                                          ...x,
                                          ownerGroups: (x.ownerGroups || []).filter(
                                            (id) => id !== g
                                          ),
                                          isDirty: true,
                                        }
                                      : x
                                  )
                                )
                              }
                              size="small"
                            />
                          );
                        })}
                      </Stack>
                      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                        <InputLabel>Add admin group</InputLabel>
                        <Select
                          label="Add admin group"
                          value=""
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (!Number.isFinite(val)) return;
                            addOwnerGroup(b.boardId, val);
                          }}
                          disabled={isPriv}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {myGroups.map((g) => (
                            <MenuItem key={g.groupId} value={g.groupId}>
                              {g.groupName} (#{g.groupId}) {g.isOpen ? '(public)' : '(private)'}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>

                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={700}>
                        Editors
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(b.editors || []).map((o) => (
                          <Chip
                            key={o}
                            label={o}
                            onDelete={() => removeName(b.boardId, 'editors', o)}
                            size="small"
                          />
                        ))}
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <TextField
                          size="small"
                          label="Add editor (name)"
                          value={(b as any).newEditor || ''}
                          onChange={(e) =>
                            setBoards((prev) =>
                              prev.map((x) =>
                                x.boardId === b.boardId ? { ...x, newEditor: e.target.value } : x
                              )
                            )
                          }
                          fullWidth
                          disabled={isPriv}
                        />
                        <IconButton
                          color="primary"
                          onClick={() => {
                            addName(b.boardId, 'editors', (b as any).newEditor);
                            setBoards((prev) =>
                              prev.map((x) =>
                                x.boardId === b.boardId ? { ...x, newEditor: '' } : x
                              )
                            );
                          }}
                          disabled={isPriv}
                        >
                          <AddIcon />
                        </IconButton>
                      </Stack>

                      <Typography variant="body2" fontWeight={700} sx={{ mt: 1 }}>
                        Editor Groups
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(b.editorGroups || []).map((g) => {
                          const group = myGroups.find((mg) => mg.groupId === g);
                          const label = group ? `${group.groupName} (#${g})` : `Group ${g}`;
                          return (
                            <Chip
                              key={g}
                              label={label}
                              onDelete={() =>
                                setBoards((prev) =>
                                  prev.map((x) =>
                                    x.boardId === b.boardId
                                      ? {
                                          ...x,
                                          editorGroups: (x.editorGroups || []).filter(
                                            (id) => id !== g
                                          ),
                                          isDirty: true,
                                        }
                                      : x
                                  )
                                )
                              }
                              size="small"
                            />
                          );
                        })}
                      </Stack>
                      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                        <InputLabel>Add editor group</InputLabel>
                        <Select
                          label="Add editor group"
                          value=""
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (!Number.isFinite(val)) return;
                            addEditorGroup(b.boardId, val);
                          }}
                          disabled={isPriv}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {myGroups.map((g) => (
                            <MenuItem key={g.groupId} value={g.groupId}>
                              {g.groupName} (#{g.groupId}) {g.isOpen ? '(public)' : '(private)'}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  </Stack>

                  <Divider sx={{ my: 1 }} />

                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <Tooltip title="Use owners/owner groups + editors/editor groups instead of legacy fields.">
                      <Box>
                        <Typography variant="body2">Enhanced permissions</Typography>
                        <Switch
                          checked={!!b.featureFlags?.enhancedPerms}
                          onChange={() => updateFlag(b.boardId, 'enhancedPerms')}
                          disabled={isPriv}
                        />
                      </Box>
                    </Tooltip>
                    <Tooltip title="Allow multiple publishes of the same card id and pick a preferred publisher.">
                      <Box>
                        <Typography variant="body2">Card variants</Typography>
                        <Switch
                          checked={!!b.featureFlags?.cardVariants}
                          onChange={() => updateFlag(b.boardId, 'cardVariants')}
                          disabled={isPriv}
                        />
                      </Box>
                    </Tooltip>
                    <Tooltip title="Archive cards instead of deleting; hides them from default view.">
                      <Box>
                        <Typography variant="body2">Card archiving</Typography>
                        <Switch
                          checked={!!b.featureFlags?.cardArchive}
                          onChange={() => updateFlag(b.boardId, 'cardArchive')}
                          disabled={isPriv}
                        />
                      </Box>
                    </Tooltip>
                  </Stack>

                  <Divider sx={{ my: 1.5 }} />

                  {isPriv ? (
                    <Typography variant="caption" color="text.secondary">
                      Ability to modify private board permissions coming in the future.
                    </Typography>
                  ) : (
                    <>
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        mb={1}
                      >
                        <Typography variant="body2" fontWeight={700}>
                          Cards & Variants
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => loadCardsForBoard(b)}
                          disabled={loading}
                        >
                          Load cards
                        </Button>
                      </Stack>

                      {cardsState[b.boardId] ? (
                        <List dense>
                          {Object.entries(cardsState[b.boardId].variants).map(([cardId, vars]) => {
                            const archived = cardsState[b.boardId].archived.has(cardId);
                            const preferred = cardsState[b.boardId].preferred?.[cardId];
                            return (
                              <ListItem
                                key={cardId}
                                alignItems="flex-start"
                                sx={{ flexDirection: 'column' }}
                              >
                                <Box
                                  width="100%"
                                  display="flex"
                                  justifyContent="space-between"
                                  alignItems="center"
                                >
                                  <ListItemText
                                    primary={
                                      <Box display="flex" alignItems="center" gap={1}>
                                        <Typography variant="body2" fontWeight={700}>
                                          {vars[0]?.title || cardId}
                                        </Typography>
                                        {archived && (
                                          <Chip size="small" label="Archived" color="default" />
                                        )}
                                      </Box>
                                    }
                                    secondary={
                                      <>
                                        <Typography variant="caption" color="text.secondary">
                                          {cardId} · {vars.length} variant
                                          {vars.length !== 1 ? 's' : ''}
                                        </Typography>
                                      </>
                                    }
                                  />
                                  <Stack direction="row" spacing={1}>
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      color={archived ? 'primary' : 'inherit'}
                                      onClick={() => toggleArchive(b.boardId, cardId, !archived)}
                                    >
                                      {archived ? 'Unarchive' : 'Archive'}
                                    </Button>
                                  </Stack>
                                </Box>
                                <Stack
                                  direction="row"
                                  spacing={0.5}
                                  flexWrap="wrap"
                                  sx={{ mt: 0.5 }}
                                >
                                  {vars.map((v) => (
                                    <Chip
                                      key={`${cardId}:${v.publisher}`}
                                      label={`${v.publisher}${preferred === v.publisher ? ' • preferred' : ''}`}
                                      color={preferred === v.publisher ? 'primary' : 'default'}
                                      onClick={() => setPreferred(b.boardId, cardId, v.publisher)}
                                    />
                                  ))}
                                </Stack>
                              </ListItem>
                            );
                          })}
                        </List>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Load cards to review variants and archiving.
                        </Typography>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
