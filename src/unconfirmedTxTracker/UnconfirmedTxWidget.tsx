import React, { useMemo, useState } from 'react';
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

  const list = useMemo(() => Object.values(state.byId), [state.byId]);
  const unconfirmed = list.filter((x) => x.status === 'unconfirmed');
  const confirmed = list.filter((x) => x.status === 'confirmed');

  if (list.length === 0) return null;

  const container: React.CSSProperties = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, padding: 8, zIndex: 1300 }
    : { position: 'fixed', right: '3%', bottom: '3%', width: '20%', zIndex: 1300 };

  return (
    <Box style={container}>
      <Paper elevation={6} sx={{ p: 1.5, borderRadius: 2, overflow: 'hidden' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
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
              {unconfirmed.map(({ tx }) => (
                <Paper key={tx.signature} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                  <Typography variant="body2" fontWeight={700} noWrap title={tx.signature}>
                    {tx.type}
                  </Typography>
                  <Box mt={1}>
                    <LinearProgress />
                  </Box>
                </Paper>
              ))}

              {confirmed.map(({ tx }) => (
                <Paper key={tx.signature} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                    <Typography variant="body2" fontWeight={700} noWrap title={tx.signature}>
                      {tx.type}
                    </Typography>
                    <IconButton size="small" onClick={() => dismiss(tx.signature)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <Typography variant="caption" color="success.main">
                    CONFIRMED
                  </Typography>
                </Paper>
              ))}
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
