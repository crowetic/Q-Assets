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
  Typography,
  Divider,
  IconButton,
  Tooltip,
  CircularProgress,
  useMediaQuery,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { useTheme } from '@mui/material';
import { useQDeck } from '../../components/qdeck/QDeckProvider';
import { QDeckCard, Priority } from '../../types/qdeck';
import { upvoteCard, contributeBounty } from '../../components/qdeck/logic';
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

export default function CardDialog(props: Props) {
  const { open, onClose, boardOwnerAddress, qassetsRevenueAddress, treasuryAddress, cardId } =
    props;
  const theme = useTheme();
  const { board, cards, updateCard } = useQDeck();
  const card = cards[cardId];
  const { address: userAddress, name: userName } = useAuth();

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
          (board.groupsAllowed ?? []) as Array<string | number>,
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
    typeof initialEta === 'number' ? initialEta : '',
  );

  // --- primary image ---
  const [imgDataUrl, setImgDataUrl] = React.useState<string | undefined>(undefined);
  const [uploading, setUploading] = React.useState(false);

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
        board.privateMeta?.isAdmins,
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
  }, [cardId, card?.seq, card]);

  // --- helpers ---
  const handleAddTag = (tag: string) => {
    const v = tag.trim();
    if (!v) return;
    setTags((prev) => (prev.includes(v) ? prev : [...prev, v]));
  };
  const handleRemoveTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  // Minimal name verification (keeps UI snappy; invalids can be edited/removed later)
  async function verifyQortalName(name: string): Promise<boolean> {
    const nm = encodeURIComponent(name.trim());
    if (!nm) return false;
    try {
      const data = await (window as any).qortalRequest?.({ action: 'GET_NAME_DATA', name: nm });
      return data?.name;
    } catch {
      try {
        const res = await fetch(`/names/${nm}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res) return false;
        const j = await res.json().catch(() => null);
        return !!j.name;
      } catch {
        return false;
      }
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

  if (!board || !card) return null;

  // Save
  const handleSave = async () => {
    if (!canEdit) return;
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
      updatedAt: Date.now(),
      seq: card.seq + 1,
    };
    await updateCard(next);
    onClose();
  };

  // Replace/upload image
  const onChooseImage = async (file: File | null) => {
    if (!file || !canEdit) return;
    try {
      setUploading(true);
      const ref = await publishPrimaryImageForCard(
        board.createdBy, // publish under board issuer
        board,
        card.cardId,
        file,
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
        board.createdBy,
        ref,
        board.privateMeta?.groupId,
        board.privateMeta?.isAdmins,
      );
      setImgDataUrl(url);
    } finally {
      setUploading(false);
    }
  };

  const doUpvote = async () => {
    await upvoteCard({
      issuerName: board.createdBy,
      board,
      cardId: card.cardId,
      currency: upvoteCurrency,
      amount: upvoteAmount,
      from: userAddress as string,
      ownerAddr: boardOwnerAddress,
      revenueAddr: qassetsRevenueAddress,
    });
  };

  const doContributeBounty = async () => {
    await contributeBounty({
      issuerName: board.createdBy,
      board,
      cardId: card.cardId,
      currency: bountyCurrency,
      amount: bountyAmount,
      from: userAddress as string,
      projectOwnerAddress: treasuryAddress,
    });
  };

  return (
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
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr' },
          alignItems: 'start',
          gap: '1rem',
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {/* LEFT: meta & content */}
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            disabled={!canEdit}
          />

          <Stack direction="row" spacing={2}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
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

            <FormControl size="small" sx={{ minWidth: 200 }}>
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

          {/* Tags */}
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
                <Chip key={t} label={t} onDelete={canEdit ? () => handleRemoveTag(t) : undefined} />
              ))}
            </Stack>
          </Stack>

          {/* Assignees */}
          <Divider />
          <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
            Assignees
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
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
            >
              Add
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {assignees.map((nm) => (
              <Chip key={nm} label={nm} onDelete={canEdit ? () => removeAssignee(nm) : undefined} />
            ))}
          </Stack>

          {/* Quick description */}
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

          {/* ETA */}
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              label="Estimated time (minutes)"
              type="number"
              inputProps={{ min: 0 }}
              value={etaMinutes}
              onChange={(e) => setEtaMinutes(e.target.value === '' ? '' : Number(e.target.value))}
              sx={{ width: 240 }}
              disabled={!canEdit}
            />
          </Stack>

          {/* Rich description */}
          <Divider />
          <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
            Description
          </Typography>
          <Box
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              p: 1,
              minHeight: '8rem',
            }}
          >
            <TiptapEditor value={html} onChange={setHtml} />
          </Box>
        </Stack>

        {/* RIGHT: image + contributions */}
        <Stack spacing={2}>
          <Box>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 0.5 }}
            >
              <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
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
                  maxHeight: isMdUp ? '50vh' : '35vh',
                }}
              />
            ) : (
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                No primary image.
              </Typography>
            )}
          </Box>

          <Divider />

          {/* Upvote */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">Paid Upvote</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 120 }}>
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
                sx={{ width: 140 }}
              />
              <Button variant="contained" onClick={doUpvote}>
                Upvote
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Initially split 10% fee then 66/33% Q-Assets/BoardOnwer. Percentages will be able to
              be modified in the future based on QARS Ratings, etc. See more details on Information
              Page under Q-Deck Initial Version Functionality.
            </Typography>
          </Stack>

          {/* Bounty */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">Contribute to Bounty</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 120 }}>
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
                sx={{ width: 140 }}
              />
              <Button variant="outlined" onClick={doContributeBounty}>
                Contribute
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Funds go to Q-Assets Escrow account now... Escrow AT in Phase-2.
            </Typography>
          </Stack>
          <Divider />

          <QDeckCommentsSection
            cardId={card.cardId}
            canComment={Boolean(userAddress)}
            showAdminsBadge={Boolean(board.privateMeta?.isAdmins)} // not used yet; keep for future
          />
        </Stack>
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
  );
}
