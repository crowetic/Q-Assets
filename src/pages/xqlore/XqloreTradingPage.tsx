import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link } from 'react-router-dom';

const XqloreTradingPage = () => {
  const theme = useTheme();

  const surfaceSx = {
    borderRadius: '24px',
    border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
    background: `linear-gradient(135deg, ${alpha(
      theme.palette.background.paper,
      0.92
    )} 0%, ${alpha(theme.palette.background.default, 0.9)} 100%)`,
    boxShadow: `0 20px 50px ${alpha(theme.palette.common.black, 0.18)}`,
    position: 'relative',
    overflow: 'hidden',
  } as const;

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100%',
        px: { xs: 2, md: 4 },
        py: { xs: 3, md: 5 },
        background: `radial-gradient(circle at 10% 10%, ${alpha(
          theme.palette.info.light,
          0.2
        )} 0%, transparent 45%), linear-gradient(180deg, ${alpha(
          theme.palette.background.default,
          0.98
        )} 0%, ${alpha(theme.palette.background.paper, 0.92)} 100%)`,
      }}
    >
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="h4" sx={{ fontFamily: 'Orbitron' }}>
              Trading Overview
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Trading intelligence and liquidity heatmaps are coming soon to Xqlore. Until then,
              jump to the live markets.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button component={Link} to="/xqlore" variant="outlined">
                Back to Xqlore
              </Button>
              <Button variant="contained" component={Link} to="/trade">
                Open Trade Markets
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default XqloreTradingPage;
