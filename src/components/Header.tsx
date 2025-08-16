// src/components/Header.tsx
import { Link, useLocation } from 'react-router-dom';
import { Box, Button, useTheme, useMediaQuery } from '@mui/material';
import logoUrl from '../assets/Q-Assets-Logo.png';

const Header = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { pathname } = useLocation();

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

  const bigSize = isMobile ? 150 : 200;
  const smallSize = isMobile ? 40 : 56;

  const Nav = (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 2,
      }}
    >
      {navLinks.map(({ label, to }) => {
        const isActive = pathname === to;
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
      {utilityButtons.map(({ label, to }) => (
        <Button
          key={label}
          component={Link}
          to={to}
          variant="outlined"
          size="small"
          sx={{
            color: 'white',
            borderColor: 'white',
            textTransform: 'none',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' },
          }}
        >
          {label}
        </Button>
      ))}
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
        // Compact: single flex row — logo left, nav center, utilities right
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          {/* Left: logo */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Logo size={smallSize} />
          </Box>

          {/* Center: nav (grows) */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>{Nav}</Box>

          {/* Right: utilities */}
          {Utilities}
        </Box>
      ) : (
        <>
          {/* Row 1: utilities top-right */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{Utilities}</Box>

          {/* Row 2: big centered logo */}
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Logo size={bigSize} />
          </Box>

          {/* Row 3: centered nav */}
          {Nav}
        </>
      )}
    </Box>
  );
};

export default Header;
