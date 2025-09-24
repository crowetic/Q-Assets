// src/components/Header.tsx
import { Link, useLocation } from 'react-router-dom';
import { Box, Button, useTheme, useMediaQuery, Typography } from '@mui/material';
import logoUrl from '../Q-Assets-Logo.png';
import { Q_ASSETS_VERSION } from '../constants/qdnConstants';

const Header = () => {
  const theme = useTheme();
  const isMdDown = useMediaQuery(theme.breakpoints.down('md'));
  const { pathname, hash } = useLocation();

  const compact = pathname.startsWith('/trade') || pathname.startsWith('/qdeck/'); // compact mode on trade routes

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
      case '/issue':
        return pathname.startsWith('/issue');
      case '/portfolio':
        return pathname.startsWith('/portfolio');
      case '/trade':
        return pathname.startsWith('/trade') || pathname.startsWith('/pair');
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
            sx={{
              flex: '0 1 auto',
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
              px: '0.9em',
              py: '0.55em',
              fontSize: { xs: '0.95rem', md: '1.05rem' },
              fontWeight: 700,
              fontFamily: 'Orbitron',
              textTransform: 'none',
              color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
              borderColor: theme.palette.text.secondary,
              backgroundColor: active ? theme.palette.primary.main : 'transparent',
              '&:hover': { backgroundColor: theme.palette.action.hover },
            }}
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
            sx={{
              flex: '0 1 auto',
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
              px: '0.85em',
              py: '0.45em',
              fontSize: { xs: '0.9rem', md: '0.95rem' },
              textTransform: 'none',
              color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
              borderColor: theme.palette.text.secondary,
              backgroundColor: active ? theme.palette.primary.main : 'transparent',
              '&:hover': { backgroundColor: theme.palette.action.hover },
            }}
          >
            {label}
          </Button>
        );
      })}
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
      {/** COMPACT MODE (trade pages) */}
      {compact ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            minWidth: 0,
          }}
        >
          {/* Row 1: Logo + Utilities (wrap-able) */}
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
            <Box sx={{ ml: 'auto' }}>{Utilities}</Box>
          </Box>

          {/* Row 2: Nav (centered, wraps) */}
          <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>{Nav}</Box>
        </Box>
      ) : (
        /** NORMAL MODE */
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            minWidth: 0,
          }}
        >
          {/* Utilities top-right (wrap-able) */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>{Utilities}</Box>

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

export default Header;
