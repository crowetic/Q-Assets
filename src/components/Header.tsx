// src/components/Header.tsx
import { Link, useLocation } from 'react-router-dom';
import { Box, Button, useTheme, useMediaQuery } from '@mui/material';
import logoUrl from '../assets/Q-Assets-Logo.png';

const Header = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { pathname, hash } = useLocation(); // <-- grab hash too

  const compact = pathname.startsWith('/trade'); // compact mode

  const navLinks = [
    { label: 'Home', to: '/' },
    { label: 'Assets', to: '/assets' },
    { label: 'Issue', to: '/issue' },
    { label: 'Portfolio', to: '/portfolio' },
    { label: 'Trade', to: '/trade' },
  ];

  const utilityButtons = [
    { label: 'Information', to: '/info' },
    { label: 'Release Notes', to: '/info#release-notes' },
  ];

  // 🔑 Centralized active matcher
  const isActiveLink = (to: string) => {
    switch (to) {
      case '/':
        return pathname === '/';

      // Assets: any asset list/details/editor routes you have
      case '/assets':
        return (
          pathname.startsWith('/assets') || // e.g. /assets, /assets/123
          pathname.startsWith('/asset') // e.g. /asset/:id, /asset/details/:id
        );

      case '/issue':
        return pathname.startsWith('/issue');

      case '/portfolio':
        return pathname.startsWith('/portfolio');

      // Trade: any trade page (same logic you used for compact)
      case '/trade':
        return (
          pathname.startsWith('/trade') || // e.g. /trade, /trade/6
          pathname.startsWith('/pair') // if you use /pair/:assetId
        );

      // Utilities (hash-aware)
      case '/info':
        // active for the generic Information button when you're on /info but NOT the release notes anchor
        return pathname === '/info' && (!hash || hash === '' || hash === '#top');

      case '/info#release-notes':
        return pathname === '/info' && hash === '#release-notes';

      default:
        return pathname === to;
    }
  };

  const bigSize = isMobile ? 150 : 200;
  const smallSize = isMobile ? 40 : 56;

  const Nav = (
    <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 2 }}>
      {navLinks.map(({ label, to }) => {
        const isActive = isActiveLink(to);
        return (
          <Button
            key={to}
            component={Link}
            to={to}
            variant={isActive ? 'contained' : 'outlined'}
            sx={{
              color: isActive ? theme.palette.primary.contrastText : theme.palette.text.primary,
              borderColor: theme.palette.text.secondary,
              fontSize: '1.1rem',
              fontWeight: 'bold',
              textTransform: 'none',
              backgroundColor: isActive ? theme.palette.primary.main : 'transparent',
              '&:hover': { backgroundColor: theme.palette.secondary.main },
            }}
          >
            {label}
          </Button>
        );
      })}
    </Box>
  );

  const Utilities = (
    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
      {utilityButtons.map(({ label, to }) => {
        const isActive = isActiveLink(to);
        return (
          <Button
            key={to}
            component={Link}
            size="small"
            to={to}
            variant={isActive ? 'contained' : 'outlined'}
            sx={{
              color: isActive ? theme.palette.primary.contrastText : theme.palette.text.primary,
              borderColor: theme.palette.text.secondary,
              fontSize: '1.1rem',
              textTransform: 'none',
              backgroundColor: isActive ? theme.palette.primary.main : 'transparent',
              '&:hover': { backgroundColor: theme.palette.secondary.main },
            }}
          >
            {label}
          </Button>
        );
      })}
    </Box>
  );

  const Logo = ({ size }: { size: number }) => (
    <Link to="/" style={{ display: 'inline-flex' }}>
      <img
        src={logoUrl}
        alt="Q-Assets Logo"
        style={{ height: size, width: size, objectFit: 'contain' }}
      />
    </Link>
  );

  return (
    <Box
      component="header"
      sx={{
        backgroundColor: theme.palette.background.default,
        px: { xs: 2, md: 4 },
        py: compact ? 1.25 : 3,
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0 : 2,
      }}
    >
      {compact ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Logo size={smallSize} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>{Nav}</Box>
          {Utilities}
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{Utilities}</Box>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Logo size={bigSize} />
          </Box>
          {Nav}
        </>
      )}
    </Box>
  );
};

export default Header;
