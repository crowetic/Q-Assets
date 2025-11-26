import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTxTracker } from './TxTrackerProvider';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  LinearProgress,
  Tooltip,
  Button,
  Divider,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

export const UnconfirmedTxWidget: React.FC = () => {
  const { state, clearConfirmed, dismiss } = useTxTracker();
  const theme = useTheme();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const POSITION_KEY = 'qassets_tx_widget_pos';
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    if (!position) return;
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      /* ignore */
    }
  }, [position]);

  useEffect(() => endDrag, []);

  const list = useMemo(() => Object.values(state.byId), [state.byId]);
  const unconfirmed = list.filter((x) => x.status === 'unconfirmed');
  const confirmed = list.filter((x) => x.status === 'confirmed');

  if (list.length === 0) return null;

  const detailValue = (value: unknown) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return value || null;
    return String(value);
  };

  const DetailRow = ({ label, value }: { label: string; value: unknown }) => {
    const v = detailValue(value);
    if (!v) return null;
    return (
      <Box display="flex" justifyContent="space-between" gap={1} mb={0.5}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
          {v}
        </Typography>
      </Box>
    );
  };

  const container: React.CSSProperties = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: '5%', padding: 8, zIndex: 1300 }
    : {
        position: 'fixed',
        width: 320,
        zIndex: 1300,
        ...(position ? { left: position.x, top: position.y } : { right: '4%', bottom: '5%' }),
      };

  const toggleExpanded = (sig: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });

  const startDrag: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (isMobile) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  };

  const onDrag = (e: PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    const next = { x: ds.origX + dx, y: ds.origY + dy };
    setPosition(next);
  };

  const endDrag = () => {
    dragState.current = null;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
  };

  return (
    <Box style={container} ref={containerRef}>
      <Paper
        elevation={6}
        sx={{ p: 1.5, borderRadius: 2, overflow: 'hidden', cursor: isMobile ? 'default' : 'grab' }}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          onPointerDown={startDrag}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="subtitle1" fontWeight={700}>
              Transactions
            </Typography>
            {unconfirmed.length > 0 && (
              <Tooltip title="Unconfirmed (mempool)">
                <Box
                  display="flex"
                  alignItems="center"
                  gap={0.5}
                  color={theme.palette.warning.main}
                >
                  <HourglassEmptyIcon fontSize="small" />
                  <Typography variant="body2">{unconfirmed.length}</Typography>
                </Box>
              </Tooltip>
            )}
            {confirmed.length > 0 && (
              <Tooltip title="Confirmed">
                <Box
                  display="flex"
                  alignItems="center"
                  gap={0.5}
                  color={theme.palette.success.main}
                >
                  <CheckCircleOutlineIcon fontSize="small" />
                  <Typography variant="body2">{confirmed.length}</Typography>
                </Box>
              </Tooltip>
            )}
          </Box>
          <IconButton size="small" onClick={() => setOpen((o) => !o)}>
            {open ? <ExpandMoreIcon /> : <ExpandLessIcon />}
          </IconButton>
        </Box>

        {open && (
          <>
            <Divider sx={{ my: 1 }} />
            <Box
              display="flex"
              flexDirection="column"
              gap={1}
              maxHeight={isMobile ? 240 : 320}
              sx={{ overflowY: 'auto' }}
            >
              {unconfirmed.map(({ tx }) => {
                const isExpanded = expanded.has(tx.signature);
                return (
                  <Paper key={tx.signature} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                      <Typography variant="body2" fontWeight={700} noWrap title={tx.signature}>
                        {tx.type}
                      </Typography>
                      <IconButton size="small" onClick={() => toggleExpanded(tx.signature)}>
                        {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </Box>
                    <Box mt={1}>
                      <LinearProgress />
                    </Box>
                    {isExpanded && (
                      <Box
                        mt={1}
                        sx={{ pl: 0.5, borderLeft: `2px solid ${theme.palette.divider}` }}
                      >
                        <DetailRow label="Signature" value={tx.signature} />
                        <DetailRow label="Creator" value={tx.creatorAddress} />
                        <DetailRow label="Service" value={tx.service} />
                        <DetailRow label="Identifier" value={tx.identifier} />
                        <DetailRow label="Name" value={tx.name} />
                        <DetailRow label="Method" value={tx.method} />
                      </Box>
                    )}
                  </Paper>
                );
              })}

              {confirmed.map(({ tx }) => {
                const isExpanded = expanded.has(tx.signature);
                return (
                  <Paper key={tx.signature} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                      <Typography variant="body2" fontWeight={700} noWrap title={tx.signature}>
                        {tx.type}
                      </Typography>
                      <Box>
                        <IconButton size="small" onClick={() => toggleExpanded(tx.signature)}>
                          {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                        <IconButton size="small" onClick={() => dismiss(tx.signature)}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                    <Typography variant="caption" color="success.main">
                      CONFIRMED
                    </Typography>
                    {isExpanded && (
                      <Box
                        mt={1}
                        sx={{ pl: 0.5, borderLeft: `2px solid ${theme.palette.divider}` }}
                      >
                        <DetailRow label="Signature" value={tx.signature} />
                        <DetailRow label="Creator" value={tx.creatorAddress} />
                        <DetailRow label="Service" value={tx.service} />
                        <DetailRow label="Identifier" value={tx.identifier} />
                        <DetailRow label="Name" value={tx.name} />
                        <DetailRow label="Method" value={tx.method} />
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Box>

            <Box mt={1} display="flex" justifyContent="flex-end">
              <Button size="small" variant="text" onClick={clearConfirmed}>
                Clear confirmed
              </Button>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
};
