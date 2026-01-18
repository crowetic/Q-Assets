import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Select,
  InputLabel,
  FormControl,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Typography,
} from '@mui/material';
import type { QDeckVisibility } from '../../types/qdeck';
import { useAuth } from 'qapp-core';
import { getAccountGroups, GroupSummary } from '../../utils/qortalApi';

type CreateBoardDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (opts: {
    title: string;
    visibility: QDeckVisibility;
    privateMeta?: { groupId?: number; isAdmins?: boolean };
    groupsAllowed: number[]; // normalized to numbers
    usersAllowed?: string[];
  }) => Promise<boolean | void> | boolean | void;
  busy?: boolean;
};

export const CreateBoardDialog: React.FC<CreateBoardDialogProps> = ({
  open,
  onClose,
  onCreate,
  busy = false,
}) => {
  const [title, setTitle] = React.useState('');
  const [visibility, setVisibility] = React.useState<QDeckVisibility>('public');

  // Private-only settings
  const [groupId, setGroupId] = React.useState<number | null>(null);
  const [isAdmins, setIsAdmins] = React.useState(false);

  // ACLs
  const [groupsAllowed, setGroupsAllowed] = React.useState<number[]>([]);
  const [usersAllowed, setUsersAllowed] = React.useState<string>(''); // CSV text box

  const [groupOptions, setGroupOptions] = React.useState<GroupSummary[]>([]);
  const auth = useAuth();
  const myAddress = auth?.address ?? '';

  React.useEffect(() => {
    if (!open || !myAddress) return;
    let alive = true;
    (async () => {
      try {
        const gs = await getAccountGroups(myAddress);
        if (alive) setGroupOptions(gs);
      } catch {
        if (alive) setGroupOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, myAddress]);

  const usersAllowedList = React.useMemo(
    () =>
      usersAllowed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [usersAllowed]
  );

  const isPrivate = visibility === 'private';
  const createDisabled =
    busy || !title.trim() || (isPrivate && (groupId == null || Number.isNaN(groupId)));

  const handleSubmit = async () => {
    const payload = {
      title: title.trim(),
      visibility,
      privateMeta: isPrivate ? { groupId: groupId ?? undefined, isAdmins } : undefined,
      groupsAllowed,
      usersAllowed: usersAllowedList.length ? usersAllowedList : undefined,
    };
    const shouldClose = await onCreate(payload);
    if (shouldClose !== false) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create board</DialogTitle>

      <DialogContent dividers sx={{ display: 'grid', gap: '0.75rem' }}>
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          fullWidth
          size="small"
        />

        {/* Visibility */}
        <FormControl size="small" fullWidth>
          <InputLabel id="vis">Visibility</InputLabel>
          <Select
            labelId="vis"
            label="Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as QDeckVisibility)}
          >
            <MenuItem value="public">public</MenuItem>
            <MenuItem value="private">private</MenuItem>
          </Select>
        </FormControl>

        {/* Private options */}
        {isPrivate && (
          <Box sx={{ display: 'grid', gap: '0.5rem' }}>
            <FormControl size="small" fullWidth>
              <InputLabel id="gid">Private group</InputLabel>
              <Select
                labelId="gid"
                label="Private group"
                value={groupId ?? ''}
                onChange={(e) => {
                  const v = e.target.value as number | string;
                  setGroupId(v === '' ? null : Number(v));
                }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {groupOptions.map((g) => (
                  <MenuItem key={g.groupId} value={g.groupId}>
                    {g.groupName} (#{g.groupId}){g.isAdmin ? ' — admin' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Checkbox checked={isAdmins} onChange={(e) => setIsAdmins(e.target.checked)} />
              }
              label="Encrypt to admins-only channel"
            />

            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              Private boards are stored under DOCUMENT_PRIVATE and require the selected group to
              decrypt.
            </Typography>
          </Box>
        )}

        {/* Groups allowed to edit (IDs) */}
        <FormControl size="small" fullWidth>
          <InputLabel id="edit-groups">Groups allowed to edit</InputLabel>
          <Select
            labelId="edit-groups"
            label="Groups allowed to edit"
            multiple
            value={groupsAllowed}
            onChange={(e) => {
              const raw = e.target.value as (string | number)[];
              // If "__none" is selected, treat as open-edit (no groups)
              if (raw.includes('__none')) {
                setGroupsAllowed([]);
                return;
              }
              const vals = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
              setGroupsAllowed(vals);
            }}
            renderValue={(selected) => {
              if (!selected || (selected as any[]).length === 0) return 'Anyone can edit';
              const ids = new Set(selected as number[]);
              const names = groupOptions
                .filter((g) => ids.has(g.groupId))
                .map((g) => `${g.groupName} (#${g.groupId})`);
              return names.join(', ');
            }}
          >
            <MenuItem value="__none">
              <Checkbox checked={groupsAllowed.length === 0} />
              <Typography sx={{ ml: 1 }}>No groups (public editable)</Typography>
            </MenuItem>
            {groupOptions.map((g) => (
              <MenuItem key={g.groupId} value={g.groupId}>
                <Checkbox checked={groupsAllowed.includes(g.groupId)} />
                <Typography sx={{ ml: 1 }}>
                  {g.groupName} (#{g.groupId})
                </Typography>
              </MenuItem>
            ))}
          </Select>
          {groupsAllowed.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              Leave empty to allow anyone to edit this public board.
            </Typography>
          )}
        </FormControl>

        {/* Users allowed (names/addresses CSV) */}
        <TextField
          label="Users allowed (names/addresses, comma-separated)"
          placeholder="alice, bob, Qabcd..."
          value={usersAllowed}
          onChange={(e) => setUsersAllowed(e.target.value)}
          size="small"
          fullWidth
          helperText="Optional: restrict by names/addresses. Leave empty for open edits."
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={createDisabled} onClick={handleSubmit}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};
