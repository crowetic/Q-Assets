import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQDeck } from '../components/qdeck/QDeckProvider';
import { BoardView } from '../components/qdeck/BoardView';
import {
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import { useAuth } from 'qapp-core';

export default function QDeckPage() {
  const { issuer, boardId } = useParams();
  const { loadBoardById, board } = useQDeck();
  const navigate = useNavigate();
  const user = useAuth();

  React.useEffect(() => {
    if (!issuer || !boardId) {
      const fallback = user?.name;
      if (fallback && boardId) {
        navigate(`/qdeck/${encodeURIComponent(fallback)}/${boardId}`, { replace: true });
      } else {
        navigate('/qdeck', { replace: true });
      }
      return;
    }

    loadBoardById(issuer, boardId).catch(console.error);
  }, [issuer, boardId, navigate, user?.name, user?.address, loadBoardById]);

  if (!board)
    return (
      <Typography sx={{ p: 2 }}>
        Loading Q-Deck… (Or just deleted, if just deleted go back to MyBoards)
      </Typography>
    );
  return <BoardView issuerName={issuer!} />;
}

export function RowLinkGuard({ children }: { children: React.ReactNode }) {
  const stopAll = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const stopKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Box
      role="group"
      onClick={stopAll}
      onMouseDown={stopAll}
      onTouchStart={stopAll}
      onKeyDown={stopKeys}
      sx={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {children}
    </Box>
  );
}

export function RowActions({
  onOpen,
  onDelete,
  canDelete,
}: {
  onOpen: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);
  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onOpen();
          }}
        >
          <ListItemIcon>
            <OpenInNewIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Open" />
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          disabled={!canDelete}
          sx={{ color: (t) => (canDelete ? t.palette.error.main : undefined) }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={canDelete ? 'Delete' : 'Delete (not allowed)'} />
        </MenuItem>
      </Menu>
    </>
  );
}
