import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';

const CancelButton = styled(Button)(({ theme }) => ({
  borderRadius: '0.1rem',
  color: theme.palette.error.contrastText,
  borderColor: theme.palette.error.main,
  borderWidth: '0.2rem',
  borderStyle: 'solid',
  textTransform: 'none',
  fontFamily: 'Orbitron',
  fontWeight: 600,
  px: 2.5,
  py: 1,
  transition: 'all .2s ease',
  '&:hover': {
    borderColor: theme.palette.error.main,
    backgroundColor: theme.palette.error.dark,
  },
  '&:active': {
    transform: 'translateY(1px)',
  },
}));

export default CancelButton;
