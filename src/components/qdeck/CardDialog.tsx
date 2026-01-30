import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Stack,
  Chip,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Checkbox,
  FormControlLabel,
  Typography,
  Divider,
  IconButton,
  Tooltip,
  CircularProgress,
  useMediaQuery,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FlagIcon from '@mui/icons-material/Flag';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import { useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useQDeck } from '../../components/qdeck/QDeckProvider';
import { QDeckCard, Priority } from '../../types/qdeck';
import { upvoteCard, contributeBounty } from '../../components/qdeck/logic';
import { priorityMeta } from './ui';
import TiptapEditor from '../TipTapEditor';
import { resolvePrimaryImageDataUrl, publishPrimaryImageForCard } from '../../utils/qdeckApi';
import { useAuth } from 'qapp-core';
import { userCanEditBoard } from '../../utils/qortalApi';
import QDeckCommentsSection from './QDeckCommentsSection';

type Props = {
  open: boolean;
  onClose: () => void;
  boardOwnerAddress: string;
  qassetsRevenueAddress: string;
  treasuryAddress: string;
  cardId: string;
};

const priorities: Priority[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

const pad2 = (value: number) => value.toString().padStart(2, '0');

const toLocalInputValue = (stamp?: number) => {
  if (!stamp) return '';
  const d = new Date(stamp);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const fromLocalInputValue = (value: string) => {
  if (!value) return undefined;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : undefined;
};

export default function CardDialog(props: Props) {
  const { open, onClose, boardOwnerAddress, qassetsRevenueAddress, treasuryAddress, cardId } =
    props;
  const theme = useTheme();
  const { board, cards, updateCard, publishCardAttachment } = useQDeck();
  const card = cards[cardId];
  const { address: userAddress, name: userName } = useAuth();
  const pMeta = React.useMemo(
    () => priorityMeta(theme, card?.priority ?? 'NORMAL'),
    [theme, card?.priority]
  );

  // --- edit rights ---
  const [isInAllowedGroup, setIsInAllowedGroup] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!userAddress || !board) {
          if (alive) setIsInAllowedGroup(false);
          return;
        }
        const ok = await userCanEditBoard(
          userAddress,
          (board.groupsAllowed ?? []) as Array<string | number>
        );
        if (alive) setIsInAllowedGroup(ok);
      } catch {
        if (alive) setIsInAllowedGroup(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userAddress, board?.groupsAllowed]);

  const usersAllowed = board?.usersAllowed ?? [];
  const norm = (x?: string | null) => encodeURIComponent(x ?? '');
  const isInUsersAllowlist =
    usersAllowed.map(norm).includes(norm(userName)) ||
    usersAllowed.map(norm).includes(norm(userAddress));
  const isPublisher = card?.createdBy === userName || card?.creatorAddress === userAddress;
  const canEdit = Boolean(card) && (isPublisher || isInAllowedGroup || isInUsersAllowlist);

  // --- local state (meta) ---
  const [title, setTitle] = React.useState(() => card?.title ?? '');
  const [priority, setPriority] = React.useState<Priority>(card?.priority ?? 'NORMAL');
  const [tags, setTags] = React.useState<string[]>(card?.tags ?? []);
  const [statusListId, setStatusListId] = React.useState(card?.statusListId ?? '');
  const [quick, setQuick] = React.useState(card?.quickDescription ?? '');
  const [html, setHtml] = React.useState(card?.descriptionHtml ?? '');
  const [assignees, setAssignees] = React.useState<string[]>(card?.assignees ?? []);
  const [assigneeDraft, setAssigneeDraft] = React.useState('');

  // ETA
  const initialEta = (card as any)?.estimatedCompletionTimeMinutes;
  const [etaMinutes, setEtaMinutes] = React.useState<number | ''>(
    typeof initialEta === 'number' ? initialEta : ''
  );

  const [scheduleStart, setScheduleStart] = React.useState(() =>
    toLocalInputValue(card?.scheduledStart)
  );
  const [scheduleEnd, setScheduleEnd] = React.useState(() => toLocalInputValue(card?.scheduledEnd));
  const [scheduleAllDay, setScheduleAllDay] = React.useState(!!card?.scheduledAllDay);

  // --- primary image ---
  const [imgDataUrl, setImgDataUrl] = React.useState<string | undefined>(undefined);
  const [uploading, setUploading] = React.useState(false);
  const [attachmentsUploading, setAttachmentsUploading] = React.useState(false);

  // --- payments ---
  const [upvoteAmount, setUpvoteAmount] = React.useState(1);
  const [upvoteCurrency, setUpvoteCurrency] = React.useState<'QORT' | 'QASSET'>('QASSET');
  const [bountyAmount, setBountyAmount] = React.useState(5);
  const [bountyCurrency, setBountyCurrency] = React.useState<'QORT' | 'QASSET'>('QASSET');

  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!board || !card) {
        if (alive) setImgDataUrl(undefined);
        return;
      }
      if (!card.primaryImage) {
        if (alive) setImgDataUrl(undefined);
        return;
      }
      const url = await resolvePrimaryImageDataUrl(
        board.createdBy,
        card.primaryImage,
        board.privateMeta?.groupId,
        board.privateMeta?.isAdmins
      );
      if (alive) setImgDataUrl(url);
    })();
    return () => {
      alive = false;
    };
  }, [
    card?.primaryImage?.identifier,
    board?.createdBy,
    board?.privateMeta?.groupId,
    board?.privateMeta?.isAdmins,
  ]);

  // Reset on card change
  React.useEffect(() => {
    if (!card) return;
    setTitle(card.title);
    setPriority(card.priority);
    setTags(card.tags ?? []);
    setStatusListId(card.statusListId);
    setQuick(card.quickDescription ?? '');
    setHtml(card.descriptionHtml ?? '');
    setAssignees(card.assignees ?? []);
    setEtaMinutes((card as any).estimatedCompletionTimeMinutes ?? '');
    setScheduleStart(toLocalInputValue(card.scheduledStart));
    setScheduleEnd(toLocalInputValue(card.scheduledEnd));
    setScheduleAllDay(!!card.scheduledAllDay);
  }, [cardId, card?.seq, card]);

  // --- helpers ---
  const handleAddTag = (tag: string) => {
    const v = tag.trim();
    if (!v) return;
    setTags((prev) => (prev.includes(v) ? prev : [...prev, v]));
  };
  const handleRemoveTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));
  const formatBytes = (value?: number) => {
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let current = value;
    let unit = 0;
    while (current >= 1024 && unit < units.length - 1) {
      current /= 1024;
      unit += 1;
    }
    const fixed = current >= 100 ? 0 : current >= 10 ? 1 : 2;
    return `${current.toFixed(fixed)} ${units[unit]}`;
  };
  const formatAttachmentMeta = (attachment: NonNullable<QDeckCard['attachments']>[number]) => {
    const parts: string[] = [];
    if (attachment.size) parts.push(formatBytes(attachment.size));
    if (attachment.uploadedBy) parts.push(attachment.uploadedBy);
    if (attachment.uploadedAt) parts.push(new Date(attachment.uploadedAt).toLocaleString());
    return parts.join(' · ');
  };

  // Minimal name verification (keeps UI snappy; invalids can be edited/removed later)
  async function verifyQortalName(name: string): Promise<boolean> {
    const nm = name.trim();
    if (!nm) return false;
    try {
      const data = await (window as any).qortalRequest?.({ action: 'GET_NAME_DATA', name: nm });
      if (data && (data.name === nm || data?.owner)) return true;
    } catch {
      /* fall through */
    }
    try {
      const res = await fetch(`/names/${encodeURIComponent(nm)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return false;
      const j = await res.json().catch(() => null);
      return !!j && (j.name === nm || j?.owner);
    } catch {
      return false;
    }
  }

  const addAssignee = async () => {
    const nm = assigneeDraft.trim();
    if (!nm) return;
    let ok = true;
    try {
      ok = await verifyQortalName(nm);
    } catch {
      /* empty */
    }
    if (!ok) {
      alert(`Could not verify Qortal name "${nm}". Added anyway—please double check.`);
    }
    setAssignees((prev) => (prev.includes(nm) ? prev : [...prev, nm]));
    setAssigneeDraft('');
  };
  const removeAssignee = (nm: string) => setAssignees((prev) => prev.filter((x) => x !== nm));

  // Save
  const handleSave = async () => {
    if (!canEdit) return;
    const startStamp = fromLocalInputValue(scheduleStart);
    const endStampRaw = fromLocalInputValue(scheduleEnd);
    let endStamp = endStampRaw;
    if (startStamp && endStamp && endStamp < startStamp) endStamp = startStamp;
    const hasSchedule = !!startStamp || !!endStamp;
    const next: QDeckCard = {
      ...card,
      title,
      descriptionHtml: html,
      quickDescription: quick,
      estimatedCompletionTimeMinutes: etaMinutes === '' ? undefined : Number(etaMinutes),
      priority,
      tags,
      statusListId,
      assignees,
      scheduledStart: startStamp,
      scheduledEnd: endStamp,
      scheduledAllDay: hasSchedule ? scheduleAllDay : undefined,
      updatedAt: Date.now(),
      seq: card.seq + 1,
    };
    await updateCard(next);
    onClose();
  };

  // Replace/upload image
  const onChooseImage = async (file: File | null) => {
    if (!file || !canEdit || !board) return;
    const activeBoard = board;
    try {
      setUploading(true);
      const ref = await publishPrimaryImageForCard(
        activeBoard.createdBy, // publish under board issuer
        activeBoard,
        card.cardId,
        file
      );
      const next: QDeckCard = {
        ...card,
        primaryImage: ref,
        updatedAt: Date.now(),
        seq: card.seq + 1,
      };
      await updateCard(next);
      // refresh preview
      const url = await resolvePrimaryImageDataUrl(
        activeBoard.createdBy,
        ref,
        activeBoard.privateMeta?.groupId,
        activeBoard.privateMeta?.isAdmins
      );
      setImgDataUrl(url);
    } finally {
      setUploading(false);
    }
  };

  const onChooseAttachments = async (files: FileList | null) => {
    if (!files || !canEdit || !card || !board) return;
    const list = Array.from(files).filter(Boolean);
    if (!list.length) return;
    try {
      setAttachmentsUploading(true);
      for (const file of list) {
        await publishCardAttachment(card.cardId, file);
      }
    } catch (err) {
      console.error('Failed to publish attachments', err);
      alert('Failed to publish attachments. Please try again.');
    } finally {
      setAttachmentsUploading(false);
    }
  };

  const doUpvote = async () => {
    if (!board) return;
    const activeBoard = board;
    await upvoteCard({
      issuerName: activeBoard.createdBy,
      board: activeBoard,
      cardId: card.cardId,
      currency: upvoteCurrency,
      amount: upvoteAmount,
      from: userAddress as string,
      ownerAddr: boardOwnerAddress,
      revenueAddr: qassetsRevenueAddress,
    });
  };

  const doContributeBounty = async () => {
    if (!board) return;
    const activeBoard = board;
    await contributeBounty({
      issuerName: activeBoard.createdBy,
      board: activeBoard,
      cardId: card.cardId,
      currency: bountyCurrency,
      amount: bountyAmount,
      from: userAddress as string,
      projectOwnerAddress: treasuryAddress,
    });
  };

  const sectionSx = {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
    p: { xs: 1.5, sm: 2 },
    backgroundColor: theme.palette.action.hover,
  };

  const updateCardWithRetry = React.useCallback(
    async (nextCard: QDeckCard, contextLabel: string) => {
      try {
        await updateCard(nextCard);
      } catch (err: any) {
        if (err?.message?.includes('Stale write')) {
          console.warn(`Retrying ${contextLabel} after stale seq`, err);
          const retry = { ...nextCard, seq: nextCard.seq + 1 };
          try {
            await updateCard(retry);
          } catch (retryErr) {
            console.error(`Failed to ${contextLabel} on retry`, retryErr);
          }
        } else {
          console.error(`Failed to ${contextLabel}`, err);
        }
      }
    },
    [updateCard]
  );

  const [completionDialogOpen, setCompletionDialogOpen] = React.useState(false);
  const [completionDraft, setCompletionDraft] = React.useState('');
  const completionResolveRef = React.useRef<((value: string | null) => void) | null>(null);

  const requestCompletionComment = React.useCallback(() => {
    setCompletionDraft('');
    setCompletionDialogOpen(true);
    return new Promise<string | null>((resolve) => {
      completionResolveRef.current = resolve;
    });
  }, []);

  const closeCompletionDialog = React.useCallback((value: string | null) => {
    const resolver = completionResolveRef.current;
    completionResolveRef.current = null;
    setCompletionDialogOpen(false);
    resolver?.(value);
  }, []);

  const me = userName?.trim();
  const isTaskCompleted = Boolean(card?.isDone);
  const hasStarted = Boolean(card?.scheduledStart);
  const isAssignee = Boolean(me && card?.assignees?.includes(me));
  const canUseTaskAction = Boolean(card && canEdit && me && !card.isDone);
  const canJoinTask = Boolean(card && canEdit && me && !card.isDone && hasStarted && !isAssignee);
  const canCompleteTask = Boolean(
    card && canEdit && me && !card.isDone && hasStarted && isAssignee
  );
  const canCancelStart = Boolean(card && canEdit && me && !card.isDone && hasStarted && isAssignee);
  const isTaskInProgressForMe = Boolean(
    me && card?.scheduledStart && card?.assignees?.includes(me)
  );
  const taskButtonLabel = React.useMemo(() => {
    if (!card) return 'Start task';
    if (card.isDone) return 'Completed';
    if (canCompleteTask) return 'Complete task';
    if (canJoinTask) return 'Join task';
    return 'Start task';
  }, [card, canCompleteTask, canJoinTask]);
  const taskIcon = isTaskCompleted ? (
    <CheckCircleIcon fontSize="small" />
  ) : canJoinTask ? (
    <GroupAddIcon fontSize="small" />
  ) : isTaskInProgressForMe ? (
    <FlagIcon fontSize="small" />
  ) : (
    <PlayArrowIcon fontSize="small" />
  );

  const handleTaskAction = async () => {
    if (!card) return;
    if (!me || !canEdit) return;
    const now = Date.now();
    const existingAssignees = card.assignees ?? [];
    const nextAssignees = Array.from(new Set([...existingAssignees, me]));
    const nextWorkedBy = Array.from(new Set([...(card.workedBy ?? []), me]));
    const started = Boolean(card.scheduledStart);
    const isAlreadyAssignee = existingAssignees.includes(me);

    if (!started) {
      const nextCard: QDeckCard = {
        ...card,
        assignees: nextAssignees,
        workedBy: nextWorkedBy,
        scheduledStart: now,
        updatedAt: now,
        seq: card.seq + 1,
      };
      if (board) {
        const inProgressList = board.lists.find((l) => {
          const normalized = (l.title ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
          return normalized.includes('in progress');
        });
        if (inProgressList && inProgressList.listId !== card.statusListId) {
          nextCard.startedFromListId = card.statusListId;
          nextCard.statusListId = inProgressList.listId;
        }
      }
      await updateCardWithRetry(nextCard, 'start task');
      return;
    }

    if (!isAlreadyAssignee) {
      const nextCard: QDeckCard = {
        ...card,
        assignees: nextAssignees,
        workedBy: nextWorkedBy,
        updatedAt: now,
        seq: card.seq + 1,
      };
      await updateCardWithRetry(nextCard, 'join task');
      return;
    }

    const completionNote = await requestCompletionComment();
    if (completionNote === null) return;
    const completionComment = completionNote.trim() || undefined;
    const nextCard: QDeckCard = {
      ...card,
      assignees: nextAssignees,
      workedBy: nextWorkedBy,
      scheduledStart: card.scheduledStart ?? now,
      scheduledEnd: card.scheduledEnd ?? now,
      isDone: true,
      completedAt: now,
      completionComment,
      isCollapsed: true,
      collapsedWhenDone: true,
      updatedAt: now,
      seq: card.seq + 1,
    };
    if (board) {
      const doneList = board.lists.find((l) => l.title?.toLowerCase().includes('done'));
      if (doneList && doneList.listId !== card.statusListId) {
        nextCard.statusListId = doneList.listId;
      }
    }
    await updateCardWithRetry(nextCard, 'complete task');
  };

  const handleCancelStart = async () => {
    if (!card || !me || !canEdit) return;
    if (card.isDone || !card.scheduledStart) return;
    const now = Date.now();
    const remaining = (card.assignees ?? []).filter((name) => name !== me);
    const nextCard: QDeckCard = {
      ...card,
      assignees: remaining,
      updatedAt: now,
      seq: card.seq + 1,
    };
    if (remaining.length === 0 && board) {
      nextCard.scheduledStart = undefined;
      nextCard.scheduledEnd = undefined;
      if (card.startedFromListId) {
        nextCard.statusListId = card.startedFromListId;
      }
      nextCard.startedFromListId = undefined;
    }
    await updateCardWithRetry(nextCard, 'cancel start');
  };

  if (!board || !card) return null;
  const attachments = card.attachments ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        fullScreen={isXs}
        maxWidth="lg"
        PaperProps={{
          sx: isXs
            ? { width: '100%', height: '100%', m: 0 }
            : { width: '90vw', height: '90vh', display: 'flex' },
        }}
      >
        <DialogTitle>{canEdit ? 'Edit Card' : 'Card Details'}</DialogTitle>

        <DialogContent
          dividers
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
          }}
        >
          <Box sx={sectionSx}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Card details
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
                disabled={!canEdit}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: '100%' }}>
                <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 160 }, flex: 1 }}>
                  <InputLabel id="priority">Priority</InputLabel>
                  <Select
                    labelId="priority"
                    label="Priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    disabled={!canEdit}
                  >
                    {priorities.map((p) => (
                      <MenuItem key={p} value={p}>
                        {p}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 }, flex: 1 }}>
                  <InputLabel id="status">List / Status</InputLabel>
                  <Select
                    labelId="status"
                    label="List / Status"
                    value={statusListId}
                    onChange={(e) => setStatusListId(e.target.value as string)}
                    disabled={!canEdit}
                  >
                    {board.lists
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((l) => (
                        <MenuItem key={l.listId} value={l.listId}>
                          {l.title}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <TextField
                  size="small"
                  label="Add tag"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = (e.target as HTMLInputElement).value.trim();
                      handleAddTag(v);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                  disabled={!canEdit}
                />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {tags.map((t) => (
                    <Chip
                      key={t}
                      label={t}
                      onDelete={canEdit ? () => handleRemoveTag(t) : undefined}
                    />
                  ))}
                </Stack>
              </Stack>

              <Divider />

              <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
                Assignees
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                flexWrap="wrap"
                sx={{ width: '100%' }}
              >
                <TextField
                  size="small"
                  label="Add assignee (Qortal name)"
                  value={assigneeDraft}
                  onChange={(e) => setAssigneeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addAssignee();
                    }
                  }}
                  disabled={!canEdit}
                />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={addAssignee}
                  disabled={!canEdit || !assigneeDraft.trim()}
                  sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
                >
                  Add
                </Button>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {assignees.map((nm) => (
                  <Chip
                    key={nm}
                    label={nm}
                    onDelete={canEdit ? () => removeAssignee(nm) : undefined}
                  />
                ))}
              </Stack>

              <Divider />

              <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
                Quick description
              </Typography>
              <TextField
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                fullWidth
                size="small"
                multiline
                minRows={3}
                disabled={!canEdit}
              />

              <TextField
                label="Estimated time (minutes)"
                type="number"
                inputProps={{ min: 0 }}
                value={etaMinutes}
                onChange={(e) => setEtaMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                sx={{ width: { xs: '100%', sm: 240 } }}
                disabled={!canEdit}
              />

              <Divider />

              <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
                Schedule
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
                <TextField
                  label="Start"
                  type="datetime-local"
                  value={scheduleStart}
                  onChange={(e) => setScheduleStart(e.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1, minWidth: 200 }}
                  disabled={!canEdit}
                />
                <TextField
                  label="End"
                  type="datetime-local"
                  value={scheduleEnd}
                  onChange={(e) => setScheduleEnd(e.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1, minWidth: 200 }}
                  disabled={!canEdit}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={scheduleAllDay}
                    onChange={(e) => setScheduleAllDay(e.target.checked)}
                    disabled={!canEdit}
                  />
                }
                label="All-day"
              />
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                If no end time is set, the calendar defaults to a 1-hour block.
              </Typography>
            </Stack>
          </Box>

          <Box sx={sectionSx}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Actions
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Button
                size="small"
                variant={isTaskCompleted || isTaskInProgressForMe ? 'contained' : 'outlined'}
                color={isTaskCompleted || isTaskInProgressForMe ? 'success' : 'primary'}
                startIcon={taskIcon}
                onClick={handleTaskAction}
                disabled={!canUseTaskAction}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  color: !isTaskCompleted && !isTaskInProgressForMe ? pMeta.border : undefined,
                  borderColor:
                    !isTaskCompleted && !isTaskInProgressForMe ? pMeta.border : undefined,
                  '&:hover':
                    !isTaskCompleted && !isTaskInProgressForMe
                      ? { borderColor: pMeta.border, backgroundColor: alpha(pMeta.border, 0.08) }
                      : undefined,
                  '&.Mui-disabled': {
                    opacity: 1,
                    color: (t) =>
                      isTaskCompleted ? t.palette.common.white : t.palette.text.disabled,
                  },
                }}
              >
                {taskButtonLabel}
              </Button>
              {canCancelStart && (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={handleCancelStart}
                  sx={{ textTransform: 'none', borderRadius: '999px' }}
                >
                  Cancel start
                </Button>
              )}
              {!userName?.trim() && (
                <Typography variant="caption" color="text.secondary">
                  Sign in with a name to start tasks.
                </Typography>
              )}
            </Stack>
          </Box>

          <Box sx={sectionSx}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Description
            </Typography>
            <Box
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2,
                p: 1,
                minHeight: '10rem',
                backgroundColor: theme.palette.background.paper,
              }}
            >
              <TiptapEditor value={html} onChange={setHtml} />
            </Box>
          </Box>

          <Box sx={sectionSx}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Primary image
              </Typography>
              {canEdit && (
                <Tooltip title="Replace primary image">
                  <IconButton component="label" size="small">
                    {uploading ? (
                      <CircularProgress size={18} />
                    ) : (
                      <PhotoCameraIcon fontSize="small" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => onChooseImage(e.target.files?.[0] ?? null)}
                    />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>

            {imgDataUrl ? (
              <Box
                component="img"
                src={imgDataUrl}
                alt=""
                sx={{
                  width: '100%',
                  borderRadius: 2,
                  objectFit: 'cover',
                  maxHeight: isMdUp ? '40vh' : '35vh',
                }}
              />
            ) : (
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                No primary image.
              </Typography>
            )}
          </Box>

          <Box sx={sectionSx}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Attachments
              </Typography>
              {canEdit && (
                <Tooltip title="Add attachment">
                  <IconButton component="label" size="small" disabled={attachmentsUploading}>
                    {attachmentsUploading ? (
                      <CircularProgress size={18} />
                    ) : (
                      <AttachFileIcon fontSize="small" />
                    )}
                    <input
                      type="file"
                      hidden
                      multiple
                      onChange={(e) => {
                        onChooseAttachments(e.target.files);
                        e.currentTarget.value = '';
                      }}
                    />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            {attachments.length ? (
              <Stack spacing={1}>
                {attachments.map((attachment) => {
                  const meta = formatAttachmentMeta(attachment);
                  return (
                    <Box
                      key={attachment.attachmentId}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 1,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ minWidth: 0, flex: 1 }}
                      >
                        <AttachFileIcon fontSize="small" />
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {attachment.fileName || attachment.identifier}
                        </Typography>
                      </Stack>
                      {meta ? (
                        <Typography variant="caption" color="text.secondary">
                          {meta}
                        </Typography>
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                No attachments.
              </Typography>
            )}
          </Box>

          <Box sx={sectionSx}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Support this card
            </Typography>

            <Stack spacing={1.5}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">Paid Upvote</Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 120 } }}>
                    <InputLabel id="upvoteCur">Currency</InputLabel>
                    <Select
                      labelId="upvoteCur"
                      label="Currency"
                      value={upvoteCurrency}
                      onChange={(e) => setUpvoteCurrency(e.target.value as any)}
                    >
                      <MenuItem value="QASSET">Q-Asset</MenuItem>
                      <MenuItem value="QORT">QORT</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    label="Amount"
                    value={upvoteAmount}
                    onChange={(e) => setUpvoteAmount(Number(e.target.value))}
                    sx={{ width: { xs: '100%', sm: 140 } }}
                  />
                  <Button variant="contained" onClick={doUpvote}>
                    Upvote
                  </Button>
                </Stack>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Initially split 10% fee then 66/33% Q-Assets/BoardOnwer. Percentages will be able
                  to be modified in the future based on QARS Ratings, etc. See more details on
                  Information Page under Q-Deck Initial Version Functionality.
                </Typography>
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="subtitle2">Contribute to Bounty</Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 120 } }}>
                    <InputLabel id="bountyCur">Currency</InputLabel>
                    <Select
                      labelId="bountyCur"
                      label="Currency"
                      value={bountyCurrency}
                      onChange={(e) => setBountyCurrency(e.target.value as any)}
                    >
                      <MenuItem value="QASSET">Q-Asset</MenuItem>
                      <MenuItem value="QORT">QORT</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    label="Amount"
                    value={bountyAmount}
                    onChange={(e) => setBountyAmount(Number(e.target.value))}
                    sx={{ width: { xs: '100%', sm: 140 } }}
                  />
                  <Button variant="outlined" onClick={doContributeBounty}>
                    Contribute
                  </Button>
                </Stack>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Funds go to Q-Assets Escrow account now... Escrow AT in Phase-2.
                </Typography>
              </Stack>
            </Stack>
          </Box>

          <Box sx={sectionSx}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Comments
            </Typography>
            <QDeckCommentsSection
              cardId={card.cardId}
              canComment={Boolean(userAddress)}
              showAdminsBadge={Boolean(board.privateMeta?.isAdmins)} // not used yet; keep for future
            />
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: { xs: 1, sm: 2 }, py: { xs: 1, sm: 1.5 } }}>
          <Button onClick={onClose}>Close</Button>
          {canEdit && (
            <Button variant="contained" onClick={handleSave}>
              Save
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={completionDialogOpen}
        onClose={() => closeCompletionDialog(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Completion comment</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            value={completionDraft}
            onChange={(event) => setCompletionDraft(event.target.value)}
            placeholder="Optional note about the completion…"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeCompletionDialog('')}>Skip</Button>
          <Button variant="contained" onClick={() => closeCompletionDialog(completionDraft)}>
            Complete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
