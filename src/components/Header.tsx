// src/components/Header.tsx
import { Link, useLocation } from 'react-router-dom';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  useTheme,
  useMediaQuery,
  Typography,
} from '@mui/material';
import logoUrl from '../Q-Assets-Logo.png';
import { Q_ASSETS_VERSION } from '../constants/qdnConstants';
import { NotificationBell } from '../notifications/NotificationBell';
import { AuthTracker } from './AuthTracker';
import { useActiveAccountName } from '../hooks/useActiveAccountName';
import { useAuth } from 'qapp-core';

const Header = () => {
  const theme = useTheme();
  const isMdDown = useMediaQuery(theme.breakpoints.down('md'));
  const { pathname, hash } = useLocation();

  // compact mode on trade & qdeck routes
  const compact =
    pathname.startsWith('/trade') ||
    pathname.startsWith('/qdeck/') ||
    pathname.startsWith('/manage/') ||
    pathname.startsWith('/xqlore');

  const navLinks = [
    { label: 'Home', to: '/' },
    { label: 'Assets', to: '/assets' },
    { label: 'Issue', to: '/issue' },
    { label: 'Portfolio', to: '/portfolio' },
    { label: 'Trade', to: '/trade' },
  ];

  const utilityButtons = [
    { label: 'Q-Deck', to: '/qdeck' }, // Q-Deck Project Management
    { label: 'Info + Wiki', to: '/info' },
    { label: 'Release Notes', to: '/info#release-notes' },
  ];

  // Active matcher
  const isActiveLink = (to: string) => {
    switch (to) {
      case '/':
        return pathname === '/';
      case '/assets':
        return pathname.startsWith('/assets') || pathname.startsWith('/asset');
      case '/xqlore':
        return pathname.startsWith('/xqlore');
      case '/issue':
        return pathname.startsWith('/issue');
      case '/portfolio':
        return pathname.startsWith('/portfolio');
      case '/trade':
        return pathname.startsWith('/trade') || pathname.startsWith('/pair');
      case '/manage':
        return pathname.startsWith('/manage');
      case '/qdeck': // Q-Deck
        return pathname.startsWith('/qdeck'); // matches /qdeck and /qdeck/:issuer/:boardId
      case '/info':
        return pathname === '/info' && (!hash || hash === '' || hash === '#top');
      case '/info#release-notes':
        return pathname === '/info' && hash === '#release-notes';
      default:
        return pathname === to;
    }
  };

  const Logo = ({ mode }: { mode: 'compact' | 'normal' }) => (
    <Link to="/" style={{ display: 'inline-flex' }}>
      <img
        src={logoUrl}
        alt="Q-Assets Logo"
        style={{
          height:
            mode === 'compact'
              ? 'clamp(2.25rem, 6vw, 3.5rem)' // compact stays modest
              : 'clamp(6rem, 15vw, 10rem)', // normal mode gets much larger
          width: 'auto',
          objectFit: 'contain',
        }}
      />
    </Link>
  );

  const buttonStyles = (active: boolean) => ({
    flex: '0 1 auto',
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
    px: '0.9em',
    py: '0.55em',
    fontSize: { xs: '0.95rem', md: '1.05rem' },
    fontWeight: 700,
    fontFamily: 'Orbitron',
    textTransform: 'none' as const,
    color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
    borderColor: theme.palette.text.secondary,
    backgroundColor: active ? theme.palette.primary.main : 'transparent',
    '&:hover': { backgroundColor: theme.palette.action.hover },
  });

  const smallButtonStyles = (active: boolean) => ({
    flex: '0 1 auto',
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
    px: '0.85em',
    py: '0.45em',
    fontSize: { xs: '0.9rem', md: '0.95rem' },
    textTransform: 'none' as const,
    color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
    borderColor: theme.palette.text.secondary,
    backgroundColor: active ? theme.palette.primary.main : 'transparent',
    '&:hover': { backgroundColor: theme.palette.action.hover },
  });

  const ManageButton = ({ size = 'medium' as 'small' | 'medium' }) => {
    const active = isActiveLink('/manage');
    return (
      <Button
        component={Link}
        to="/manage"
        variant={active ? 'contained' : 'outlined'}
        size={size}
        sx={size === 'small' ? smallButtonStyles(active) : buttonStyles(active)}
      >
        Manage
      </Button>
    );
  };

  const XqloreButton = ({ size = 'medium' as 'small' | 'medium' }) => {
    const active = isActiveLink('/xqlore');
    return (
      <Button
        component={Link}
        to="/xqlore"
        variant={active ? 'contained' : 'outlined'}
        size={size}
        sx={size === 'small' ? smallButtonStyles(active) : buttonStyles(active)}
      >
        Xqlore
      </Button>
    );
  };

  const LeftButtons = ({ size = 'medium' as 'small' | 'medium' }) => (
    <Box sx={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <ManageButton size={size} />
      <XqloreButton size={size} />
    </Box>
  );

  const Nav = (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        justifyContent: { xs: 'center', md: 'center' },
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      {navLinks.map(({ label, to }) => {
        const active = isActiveLink(to);
        return (
          <Button
            key={to}
            component={Link}
            to={to}
            variant={active ? 'contained' : 'outlined'}
            size={isMdDown ? 'small' : 'medium'}
            sx={buttonStyles(active)}
          >
            {label}
          </Button>
        );
      })}
    </Box>
  );

  const Utilities = (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        justifyContent: { xs: 'flex-end', md: 'flex-end' },
        minWidth: 0,
      }}
    >
      {utilityButtons.map(({ label, to }) => {
        const active = isActiveLink(to);
        return (
          <Button
            key={to}
            component={Link}
            to={to}
            variant={active ? 'contained' : 'outlined'}
            size="small"
            sx={smallButtonStyles(active)}
          >
            {label}
          </Button>
        );
      })}
      <ActiveNameSelector />
      <AuthTracker />
      <NotificationBell />
      <Typography
        variant="caption"
        sx={{
          ml: 1,
          fontWeight: 600,
          color: theme.palette.text.secondary,
          whiteSpace: 'nowrap',
        }}
      >
        v{Q_ASSETS_VERSION}
      </Typography>
    </Box>
  );

  return (
    <Box
      component="header"
      sx={{
        backgroundColor: theme.palette.background.default,
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0 : '1rem',
        px: { xs: '1rem', md: '2rem' },
        py: compact ? '0.75rem' : '1.5rem',
        minWidth: 0,
      }}
    >
      {/* COMPACT MODE (trade/qdeck pages) */}
      {compact ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            minWidth: 0,
          }}
        >
          {/* Row 1: Logo + Manage (right of logo) + Utilities (far right) */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              minWidth: 0,
            }}
          >
            <Box sx={{ flex: '0 0 auto' }}>
              <Logo mode="compact" />
            </Box>
            {/* Manage sits to the right of the logo in compact mode */}
            <LeftButtons size="small" />
            <Box sx={{ ml: 'auto' }}>{Utilities}</Box>
          </Box>

          {/* Row 2: Nav (centered, wraps) */}
          <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>{Nav}</Box>
        </Box>
      ) : (
        /* NORMAL MODE */
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            minWidth: 0,
          }}
        >
          {/* Row 1: Manage top-left, Utilities top-right */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              gap: 1,
            }}
          >
            <Box sx={{ flex: '0 0 auto' }}>
              <LeftButtons />
            </Box>
            <Box sx={{ ml: 'auto' }}>{Utilities}</Box>
          </Box>

          {/* Centered logo */}
          <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            <Logo mode="normal" />
          </Box>

          {/* Centered nav */}
          <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>{Nav}</Box>
        </Box>
      )}
    </Box>
  );
};

const ActiveNameSelector = () => {
  const { address } = useAuth();
  const { activeName, setActiveName, availableNames, namesLoading, namesError } =
    useActiveAccountName({ autoAuth: false });

  if (!address) return null;

  const names =
    activeName && !availableNames.includes(activeName)
      ? [activeName, ...availableNames]
      : availableNames;

  const disabled = namesLoading || names.length === 0;
  const renderValue = (value: unknown) => {
    const str = String(value || '');
    if (str) return str;
    if (namesLoading) return 'Loading names...';
    if (!names.length) return 'No names';
    return 'Select name';
  };

  return (
    <Tooltip title={namesError || 'Active name used for publishing'}>
      <FormControl size="small" sx={{ minWidth: 170 }}>
        <InputLabel id="active-name-select">Active name</InputLabel>
        <Select
          labelId="active-name-select"
          label="Active name"
          value={activeName || ''}
          onChange={(e) => {
            const next = e.target.value ? String(e.target.value) : '';
            setActiveName(next || null);
          }}
          disabled={disabled}
          displayEmpty
          renderValue={renderValue}
        >
          {names.length === 0 && (
            <MenuItem value="" disabled>
              {namesLoading ? 'Loading names...' : 'No names found'}
            </MenuItem>
          )}
          {names.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Tooltip>
  );
};

export default Header;
