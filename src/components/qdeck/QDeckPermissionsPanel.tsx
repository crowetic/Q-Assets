import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  loadCardDoc,
  resolveBoardForRead,
  saveBoardDoc,
  updateCardArchiveState,
  repairCardsIndex,
  loadNewestCardsIndex,
} from '../../utils/qdeckApi';
import { useAuth } from 'qapp-core';
import pLimit from 'p-limit';
import { getAccountGroups, type GroupSummary } from '../../utils/qortalApi';
import { fetchGroupMembers } from '../../utils/access';
import { isQAddressFormat } from '../../utils/address';

declare function qortalRequest<T = any>(request: any): Promise<T>;

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
  const { name: myName, address: myAddress } = useAuth() as any;
  const [boards, setBoards] = useState<EditableBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardsState, setCardsState] = useState<Record<string, BoardCardsState>>({});
  const limit = useMemo(() => pLimit(4), []);
  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  const [repairingBoards, setRepairingBoards] = useState<Record<string, boolean>>({});
  const [repairedBoardId, setRepairedBoardId] = useState<string | null>(null);
  const groupMemberCacheRef = useRef(new Map<number, Set<string>>());
  const nameAddressCacheRef = useRef(new Map<string, string>());
  const publicKeyCacheRef = useRef(new Map<string, string>());
  // const isPrivate = (b: QDeckBoard) => b.visibility === 'private';

  const resolveNameToAddress = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const cached = nameAddressCacheRef.current.get(trimmed);
    if (cached) return cached;
    if (isQAddressFormat(trimmed)) {
      nameAddressCacheRef.current.set(trimmed, trimmed);
      return trimmed;
    }
    try {
      const data = await qortalRequest({ action: 'GET_NAME_DATA', name: trimmed });
      const owner = data?.owner;
      if (typeof owner === 'string' && owner.trim()) {
        const addr = owner.trim();
        nameAddressCacheRef.current.set(trimmed, addr);
        return addr;
      }
    } catch {
      /* empty */
    }
    return null;
  }, []);

  const resolvePublicKey = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return null;
    const cached = publicKeyCacheRef.current.get(trimmed);
    if (cached) return cached;
    try {
      const data = await qortalRequest({ action: 'GET_ACCOUNT_DATA', address: trimmed });
      const publicKey = data?.publicKey;
      if (typeof publicKey === 'string' && publicKey.trim()) {
        const pk = publicKey.trim();
        publicKeyCacheRef.current.set(trimmed, pk);
        return pk;
      }
    } catch {
      /* empty */
    }
    return null;
  }, []);

  const loadGroupMemberSet = useCallback(async (groupId: number) => {
    const cached = groupMemberCacheRef.current.get(groupId);
    if (cached) return cached;
    const rows = await fetchGroupMembers(false, groupId).catch(() => []);
    const set = new Set(
      rows.map((row) => String(row?.address || row?.member || '').trim()).filter(Boolean)
    );
    groupMemberCacheRef.current.set(groupId, set);
    return set;
  }, []);

  const canAddPrivateMember = useCallback(
    async (board: EditableBoard, nameOrAddress: string) => {
      if (board.visibility !== 'private') return { ok: true };
      const mode =
        board.privateMeta?.mode ?? (board.privateMeta?.groupId != null ? 'group' : 'direct');

      if (mode === 'group') {
        const groupId = board.privateMeta?.groupId;
        if (!groupId) {
          return { ok: false, reason: 'Private board missing encryption group.' };
        }
        const address = await resolveNameToAddress(nameOrAddress);
        if (!address) {
          return { ok: false, reason: `Unable to resolve "${nameOrAddress}".` };
        }
        const members = await loadGroupMemberSet(groupId);
        if (!members.has(address)) {
          return {
            ok: false,
            reason: `Only members of group #${groupId} can be added to private boards.`,
          };
        }
        return { ok: true };
      }

      if (mode === 'direct') {
        const recipients = board.privateMeta?.recipients;
        if (!recipients?.length) {
          return { ok: false, reason: 'Direct encrypted boards can only add existing recipients.' };
        }
        const address = await resolveNameToAddress(nameOrAddress);
        if (!address) {
          return { ok: false, reason: `Unable to resolve "${nameOrAddress}".` };
        }
        const publicKey = await resolvePublicKey(address);
        if (!publicKey) {
          return { ok: false, reason: 'Unable to resolve account public key.' };
        }
        if (!recipients.includes(publicKey)) {
          return {
            ok: false,
            reason: 'Only existing encryption recipients can be added to private boards.',
          };
        }
      }

      return { ok: true };
    },
    [loadGroupMemberSet, resolveNameToAddress, resolvePublicKey]
  );

  const canAddPrivateGroup = useCallback((board: EditableBoard, groupId: number) => {
    if (board.visibility !== 'private') return { ok: true };
    const mode =
      board.privateMeta?.mode ?? (board.privateMeta?.groupId != null ? 'group' : 'direct');
    if (mode !== 'group') {
      return { ok: false, reason: 'Direct encrypted boards do not allow group-based permissions.' };
    }
    const privateGroupId = board.privateMeta?.groupId;
    if (!privateGroupId) {
      return { ok: false, reason: 'Private board missing encryption group.' };
    }
    if (groupId !== privateGroupId) {
      return {
        ok: false,
        reason: `Only group #${privateGroupId} can be added to this private board.`,
      };
    }
    return { ok: true };
  }, []);

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
        const resolved = await resolveBoardForRead(issuer, entry.boardId, entry.visibility).catch(
          () => null
        );

        const base = resolved || (entry as any);
        const ownerGroups = base.ownerGroups || [];
        const editorGroups = Array.from(
          new Set([...(base.editorGroups || base.groupsAllowed || []), ...ownerGroups])
        );
        const privMode =
          base.privateMeta?.mode ?? (base.privateMeta?.groupId != null ? 'group' : entry.mode);

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
              ? privMode === 'direct'
                ? 'Direct'
                : privMode === 'group'
                  ? 'Group'
                  : 'Private'
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
    if (!myAddress) {
      setMyGroups([]);
      return;
    }
    getAccountGroups(myAddress)
      .then((gs) => setMyGroups(gs))
      .catch(() => setMyGroups([]));
  }, [myAddress]);

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

  const addName = async (board: EditableBoard, field: 'owners' | 'editors', value?: string) => {
    const v = (value || '').trim();
    if (!v) return false;
    const allowed = await canAddPrivateMember(board, v);
    if (!allowed.ok) {
      setError(allowed.reason || 'Unable to add member.');
      return false;
    }
    setBoards((prev) =>
      prev.map((b) =>
        b.boardId === board.boardId
          ? { ...b, [field]: Array.from(new Set([...(b[field] || []), v])), isDirty: true }
          : b
      )
    );
    return true;
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

  const addOwnerGroup = async (board: EditableBoard, groupId: number) => {
    const allowed = canAddPrivateGroup(board, groupId);
    if (!allowed.ok) {
      setError(allowed.reason || 'Unable to add group.');
      return false;
    }
    setBoards((prev) =>
      prev.map((b) => {
        if (b.boardId !== board.boardId) return b;
        const ownerGroups = Array.from(new Set([...(b.ownerGroups || []), groupId]));
        const editorGroups = Array.from(new Set([...(b.editorGroups || []), groupId]));
        return { ...b, ownerGroups, editorGroups, isDirty: true };
      })
    );
    return true;
  };

  const addEditorGroup = async (board: EditableBoard, groupId: number) => {
    const allowed = canAddPrivateGroup(board, groupId);
    if (!allowed.ok) {
      setError(allowed.reason || 'Unable to add group.');
      return false;
    }
    setBoards((prev) =>
      prev.map((b) => {
        if (b.boardId !== board.boardId) return b;
        const editorGroups = Array.from(new Set([...(b.editorGroups || []), groupId]));
        return { ...b, editorGroups, isDirty: true };
      })
    );
    return true;
  };

  const dirtyCount = useMemo(() => boards.filter((b) => b.isDirty).length, [boards]);

  const loadCardsForBoard = async (entry: EditableBoard) => {
    if (!myName) return setError('Authenticate first.');
    setLoading(true);
    setError(null);
    try {
      const resolved = await resolveBoardForRead(myName, entry.boardId, entry.visibility as any);
      if (!resolved) throw new Error('Failed to load board doc');
      const idx =
        (await loadNewestCardsIndex(resolved, {
          issuerHints: [resolved.createdBy, myName].filter(Boolean) as string[],
        })) ?? null;
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

  const repairIndex = useCallback(
    async (entry: EditableBoard) => {
      if (!myName) return setError('Authenticate first.');
      setError(null);
      setRepairedBoardId(null);
      setRepairingBoards((prev) => ({ ...prev, [entry.boardId]: true }));
      try {
        const resolved = await resolveBoardForRead(
          myName,
          entry.boardId,
          entry.visibility ?? 'public'
        );
        if (!resolved) throw new Error('Failed to load board for repair');
        await repairCardsIndex(resolved.createdBy, resolved);
        await loadCardsForBoard(entry);
        setRepairedBoardId(entry.boardId);
      } catch (e: any) {
        setError(e?.message || 'Failed to repair cards index');
      } finally {
        setRepairingBoards((prev) => {
          const next = { ...prev };
          delete next[entry.boardId];
          return next;
        });
      }
    },
    [loadCardsForBoard, myName]
  );

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
            const privateMode =
              b.privateMeta?.mode ?? (b.privateMeta?.groupId != null ? 'group' : 'direct');
            const privateGroupId = b.privateMeta?.groupId;
            const groupSelectDisabled =
              isPriv && (privateMode !== 'group' || privateGroupId == null);
            const filteredGroups =
              isPriv && privateMode === 'group' && privateGroupId != null
                ? myGroups.filter((g) => g.groupId === privateGroupId)
                : myGroups;
            const groupOptions =
              filteredGroups.length === 0 && isPriv && privateMode === 'group' && privateGroupId
                ? [{ groupId: privateGroupId, groupName: undefined, isOpen: false }]
                : filteredGroups;
            const privateNote = isPriv
              ? privateMode === 'group'
                ? `Private board: only members of group #${
                    privateGroupId ?? 'unknown'
                  } can be added, and encryption settings stay fixed.`
                : 'Private board uses direct encryption; only existing recipients can be added.'
              : null;
            return (
              <Card key={b.boardId} variant="outlined">
                {privateNote && (
                  <Box sx={{ p: 1, pb: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {privateNote}
                    </Typography>
                  </Box>
                )}
                <CardContent>
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
                        />
                        <IconButton
                          color="primary"
                          onClick={async () => {
                            const ok = await addName(b, 'owners', (b as any).newOwner);
                            if (!ok) return;
                            setBoards((prev) =>
                              prev.map((x) =>
                                x.boardId === b.boardId ? { ...x, newOwner: '' } : x
                              )
                            );
                          }}
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
                          onChange={async (e) => {
                            const val = Number(e.target.value);
                            if (!Number.isFinite(val)) return;
                            await addOwnerGroup(b, val);
                          }}
                          disabled={groupSelectDisabled}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {groupOptions.map((g) => (
                            <MenuItem key={g.groupId} value={g.groupId}>
                              {g.groupName
                                ? `${g.groupName} (#${g.groupId})`
                                : `Group #${g.groupId}`}{' '}
                              {g.isOpen ? '(public)' : '(private)'}
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
                        />
                        <IconButton
                          color="primary"
                          onClick={async () => {
                            const ok = await addName(b, 'editors', (b as any).newEditor);
                            if (!ok) return;
                            setBoards((prev) =>
                              prev.map((x) =>
                                x.boardId === b.boardId ? { ...x, newEditor: '' } : x
                              )
                            );
                          }}
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
                          onChange={async (e) => {
                            const val = Number(e.target.value);
                            if (!Number.isFinite(val)) return;
                            await addEditorGroup(b, val);
                          }}
                          disabled={groupSelectDisabled}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {groupOptions.map((g) => (
                            <MenuItem key={g.groupId} value={g.groupId}>
                              {g.groupName
                                ? `${g.groupName} (#${g.groupId})`
                                : `Group #${g.groupId}`}{' '}
                              {g.isOpen ? '(public)' : '(private)'}
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
                        />
                      </Box>
                    </Tooltip>
                    <Tooltip title="Allow multiple publishes of the same card id and pick a preferred publisher.">
                      <Box>
                        <Typography variant="body2">Card variants</Typography>
                        <Switch
                          checked={!!b.featureFlags?.cardVariants}
                          onChange={() => updateFlag(b.boardId, 'cardVariants')}
                        />
                      </Box>
                    </Tooltip>
                    <Tooltip title="Archive cards instead of deleting; hides them from default view.">
                      <Box>
                        <Typography variant="body2">Card archiving</Typography>
                        <Switch
                          checked={!!b.featureFlags?.cardArchive}
                          onChange={() => updateFlag(b.boardId, 'cardArchive')}
                        />
                      </Box>
                    </Tooltip>
                  </Stack>

                  <Divider sx={{ my: 1.5 }} />

                  <Stack
                    direction="row"
                    alignItems="flex-start"
                    justifyContent="space-between"
                    mb={1}
                  >
                    <Typography variant="body2" fontWeight={700}>
                      Cards & Variants
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => loadCardsForBoard(b)}
                        disabled={loading}
                      >
                        Load cards
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => repairIndex(b)}
                        disabled={loading || !!repairingBoards[b.boardId]}
                      >
                        {repairingBoards[b.boardId] ? 'Repairing…' : 'Repair index'}
                      </Button>
                    </Stack>
                  </Stack>
                  {!!repairedBoardId && repairedBoardId === b.boardId && (
                    <Typography variant="caption" color="success.main" sx={{ mb: 1 }}>
                      Index repaired
                    </Typography>
                  )}

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
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
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
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
