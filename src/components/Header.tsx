import { Link, useLocation } from 'react-router-dom';
import { Box, Button, useTheme, useMediaQuery, Typography } from '@mui/material';

const Header = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();

  const navLinks = [
    { label: 'Home', to: '/' },
    { label: 'Assets', to: '/assets' },
    { label: 'Issue', to: '/issue' },
    { label: 'Portfolio', to: '/portfolio' },
    { label: 'Trade', to: '/trade' },
  ];

  const utilityButtons = [
    { label: 'Information', to: '/info' },
    { label: 'Release Notes', to: '/releases' },
  ];

  return (
    <Box
      component="header"
      sx={{
        backgroundColor: theme.palette.background.default,
        px: 4,
        py: 3,
        position: 'relative',
        borderBottom: `1px solid ${theme.palette.divider}`,
      }}
    >
      {/* Top-right utility buttons */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          gap: 1,
        }}
      >
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
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.1)',
              },
            }}
          >
            {label}
          </Button>
        ))}
      </Box>

      {/* Logo */}
      <Box display="flex" justifyContent="center" alignItems="center" flexDirection="column">
        <img
          src="/src/assets/Q-Assets-Logo.png"
          alt="Q-Assets Logo"
          style={{
            height: isMobile ? 150 : 200,
            width: isMobile ? 150 : 200,
            objectFit: 'contain',
            marginBottom: theme.spacing(1),
          }}
        />
      </Box>

      {/* Main nav buttons */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 2,
          mt: 2,
        }}
      >
        {navLinks.map(({ label, to }) => {
          const isActive = location.pathname === to;

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
                '&:hover': {
                  backgroundColor: theme.palette.secondary.main,
                },
              }}
            >
              {label}
            </Button>
          );
        })}
      </Box>
    </Box>
  );
};

export default Header;
