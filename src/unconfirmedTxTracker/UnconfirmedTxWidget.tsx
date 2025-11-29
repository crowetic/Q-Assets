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
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useAuth } from 'qapp-core';

export const UnconfirmedTxWidget: React.FC = () => {
  const { state, clearConfirmed, dismiss } = useTxTracker();
  const { address: myAddress } = useAuth() as any;
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
  const resizeState = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const POSITION_KEY = 'qassets_tx_widget_pos';
  const SIZE_KEY = 'qassets_tx_widget_size';
  const [size, setSize] = useState<{ width: number; height: number } | null>(() => {
    try {
      const raw = localStorage.getItem(SIZE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          return parsed;
        }
      }
    } catch {
      /* ignore */
    }
    return { width: 320, height: 320 };
  });
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

  useEffect(() => {
    if (!size) return;
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch {
      /* ignore */
    }
  }, [size]);

  const list = useMemo(() => Object.values(state.byId), [state.byId]);
  const unconfirmed = list.filter((x) => x.status === 'unconfirmed');
  const confirmed = list.filter((x) => x.status === 'confirmed');

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

  const serviceLabel = (service?: number | string) => {
    if (service === undefined || service === null) return '';
    const lookup: Record<string, string> = {
      '1': 'QDN data',
      '2': 'Document',
      '3': 'Image',
      '4': 'Website',
      '5': 'Blog',
      '6': 'Video',
      '7': 'Audio',
      '8': 'Voice',
      '9': 'JSON',
    };
    const key = String(service);
    return lookup[key] || key;
  };

  const directionLabel = (tx: any) => {
    if (!myAddress) return undefined;
    const me = myAddress.trim();
    const sender = (tx.sender || tx.senderAddress || tx.creatorAddress || '').trim();
    const recipient = (tx.recipient || tx.recipientAddress || '').trim();
    if (me && sender && sender === me) return 'Outgoing';
    if (me && recipient && recipient === me) return 'Incoming';
    if (Array.isArray(tx?.payments)) {
      const hit = tx.payments.find((p: any) => (p?.recipient || '').trim() === me);
      if (hit) return 'Incoming';
    }
    return undefined;
  };

  const detailFieldsForTx = (tx: any) => {
    const type = tx?.type;
    const rows: Array<{ label: string; value: unknown }> = [];

    const direction = directionLabel(tx);
    if (direction) rows.push({ label: 'Direction', value: direction });

    if (type === 'PAYMENT' || type === 'MULTI_PAYMENT' || type === 'TRANSFER_ASSET') {
      rows.push({ label: 'Sender', value: tx.sender || tx.senderAddress || tx.creatorAddress });
      rows.push({ label: 'Recipient', value: tx.recipient || tx.recipientAddress });
      if (Array.isArray(tx?.payments) && tx.payments.length) {
        rows.push({ label: 'Payments', value: `${tx.payments.length} recipients` });
      }
      if (tx.amount !== undefined) rows.push({ label: 'Amount', value: tx.amount });
      if (tx.assetId !== undefined) rows.push({ label: 'Asset', value: tx.assetId });
    } else if (type === 'ARBITRARY') {
      rows.push({ label: 'Service', value: serviceLabel(tx.service) });
      rows.push({ label: 'Identifier', value: tx.identifier });
      rows.push({ label: 'Name', value: tx.name });
      rows.push({ label: 'Method', value: tx.method });
    } else if (type === 'CREATE_ASSET_ORDER' || type === 'CANCEL_ASSET_ORDER') {
      rows.push({ label: 'Order', value: tx.orderId });
      rows.push({ label: 'Have Asset', value: tx.haveAssetId });
      rows.push({ label: 'Want Asset', value: tx.wantAssetId });
    } else if (type === 'ISSUE_ASSET') {
      rows.push({ label: 'Asset Name', value: tx.assetName });
      rows.push({ label: 'Quantity', value: tx.quantity });
    } else if (type === 'CREATE_GROUP' || type === 'JOIN_GROUP' || type === 'LEAVE_GROUP') {
      rows.push({ label: 'Group Id', value: tx.groupId });
      rows.push({ label: 'Group Name', value: tx.groupName });
      rows.push({ label: 'Member', value: tx.member });
    } else {
      rows.push({ label: 'Creator', value: tx.creatorAddress });
      rows.push({ label: 'Name', value: tx.name });
      rows.push({ label: 'Identifier', value: tx.identifier });
    }

    rows.push({ label: 'Signature', value: tx.signature });
    return rows;
  };

  const container: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: '5%',
        padding: 8,
        zIndex: 1300,
      }
    : {
        position: 'fixed',
        width: size?.width ?? 320,
        zIndex: 1300,
        ...(position ? { left: position.x, top: position.y } : { right: '4%', bottom: '5%' }),
        maxWidth: '96vw',
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
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  };

  const onDrag = (e: PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    const nextW = size?.width ?? 320;
    const nextH = size?.height ?? 320;
    const nextX = Math.min(
      Math.max(0, ds.origX + dx),
      window.innerWidth - Math.min(nextW, window.innerWidth)
    );
    const nextY = Math.min(
      Math.max(0, ds.origY + dy),
      window.innerHeight - Math.min(nextH, window.innerHeight)
    );
    const next = { x: nextX, y: nextY };
    setPosition(next);
  };

  const endDrag = () => {
    dragState.current = null;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
  };

  const startResize: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (isMobile) return;
    if (!containerRef.current) return;
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    };
    window.addEventListener('pointermove', onResize);
    window.addEventListener('pointerup', endResize);
  };

  const onResize = (e: PointerEvent) => {
    const rs = resizeState.current;
    if (!rs) return;
    const dx = e.clientX - rs.startX;
    const dy = e.clientY - rs.startY;
    const nextW = Math.max(260, rs.startW + dx);
    const nextH = Math.max(220, rs.startH + dy);
    setSize({ width: nextW, height: nextH });
  };

  const endResize = () => {
    resizeState.current = null;
    window.removeEventListener('pointermove', onResize);
    window.removeEventListener('pointerup', endResize);
  };

  useEffect(() => endDrag, []);
  useEffect(() => endResize, []);

  if (list.length === 0) return null;

  return (
    <Box style={container} ref={containerRef}>
      <Paper
        elevation={6}
        sx={{
          p: 1.5,
          borderRadius: 2,
          overflow: 'hidden',
          cursor: isMobile ? 'default' : 'grab',
          position: 'relative',
        }}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          onPointerDown={startDrag}
          sx={{
            cursor: isMobile ? 'default' : 'grab',
            userSelect: 'none',
            '&:hover .drag-icon': { opacity: isMobile ? 0 : 1 },
          }}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="subtitle1" fontWeight={700}>
              Transactions
            </Typography>
            {!isMobile && (
              <DragIndicatorIcon
                className="drag-icon"
                fontSize="small"
                sx={{ opacity: 0.5, transition: 'opacity 120ms ease' }}
              />
            )}
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
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>

        {!isMobile && (
          <Box
            onPointerDown={startResize}
            sx={{
              position: 'absolute',
              width: 14,
              height: 14,
              right: 6,
              bottom: 6,
              cursor: 'se-resize',
              borderRight: `2px solid ${theme.palette.divider}`,
              borderBottom: `2px solid ${theme.palette.divider}`,
              borderRadius: 1,
            }}
          />
        )}
        {!isMobile && (
          <Box
            onPointerDown={startResize}
            sx={{
              position: 'absolute',
              width: 14,
              height: 14,
              left: 6,
              bottom: 6,
              cursor: 'sw-resize',
              borderLeft: `2px solid ${theme.palette.divider}`,
              borderBottom: `2px solid ${theme.palette.divider}`,
              borderRadius: 1,
            }}
          />
        )}

        {open && (
          <>
            <Divider sx={{ my: 1 }} />
            <Box
              display="flex"
              flexDirection="column"
              gap={1}
              maxHeight={isMobile ? 240 : (size?.height ?? 320)}
              sx={{ overflowY: 'auto' }}
            >
              {unconfirmed.map(({ tx }) => {
                const isExpanded = expanded.has(tx.signature);
                return (
                  <Paper key={tx.signature} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      gap={1}
                      onClick={() => toggleExpanded(tx.signature)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <Typography variant="body2" fontWeight={700} noWrap title={tx.signature}>
                        {tx.type}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(tx.signature);
                        }}
                      >
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
                        {detailFieldsForTx(tx).map((row) => (
                          <DetailRow
                            key={`${tx.signature}:${row.label}`}
                            label={row.label}
                            value={row.value}
                          />
                        ))}
                      </Box>
                    )}
                  </Paper>
                );
              })}

              {confirmed.map(({ tx }) => {
                const isExpanded = expanded.has(tx.signature);
                return (
                  <Paper key={tx.signature} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      gap={1}
                      onClick={() => toggleExpanded(tx.signature)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <Typography variant="body2" fontWeight={700} noWrap title={tx.signature}>
                        {tx.type}
                      </Typography>
                      <Box>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(tx.signature);
                          }}
                        >
                          {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            dismiss(tx.signature);
                          }}
                        >
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
                        {detailFieldsForTx(tx).map((row) => (
                          <DetailRow
                            key={`${tx.signature}:${row.label}`}
                            label={row.label}
                            value={row.value}
                          />
                        ))}
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Box>

            <Box mt={1} display="flex" justifyContent="flex-end">
              <Button
                size="small"
                variant="text"
                onClick={clearConfirmed}
                startIcon={!isMobile && size && size.width > 320 ? <DeleteSweepIcon /> : undefined}
              >
                Clear confirmed
              </Button>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
};
