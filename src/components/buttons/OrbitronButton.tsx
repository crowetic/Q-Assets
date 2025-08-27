// src/components/common/OrbitronButton.tsx
import { styled } from '@mui/material/styles';
import Button, { ButtonProps } from '@mui/material/Button';

// Extend props so we can pass "active" without TS errors
interface OrbitronButtonProps extends ButtonProps {
  active?: boolean;
}

const OrbitronButton = styled(Button, {
  shouldForwardProp: (prop) => prop !== 'active', // do not forward "active"
})<OrbitronButtonProps>(({ theme, active }) => ({
  flex: '0 1 auto',
  whiteSpace: 'nowrap',
  lineHeight: 1,
  padding: '0.75em 0.75em',
  fontSize: '0.75rem',
  fontWeight: 300,
  fontFamily: 'Orbitron',
  textTransform: 'none',
  color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
  borderColor: active ? theme.palette.secondary.light : theme.palette.info.dark,
  backgroundColor: active ? theme.palette.secondary.main : 'transparent',
  borderWidth: '0.05rem',
  borderStyle: 'solid',
  borderRadius: '0.25rem',
  transition: 'all .2s ease',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
    color: theme.palette.info.light,
  },
  // Responsive font sizing
  [theme.breakpoints.up('md')]: {
    fontSize: '0.85rem',
  },
}));

export default OrbitronButton;
