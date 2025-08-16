import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';

const SellButton = styled(Button)(({ theme }) => ({
  borderRadius: '0.1rem',
  color: theme.palette.error.contrastText,
  borderColor: theme.palette.error.contrastText,
  backgroundColor: 'transparent',
  borderWidth: 3,
  borderStyle: 'solid',
  textTransform: 'none',
  fontWeight: 800,
  px: 2.5,
  py: 1,
  transition: 'all .2s ease',
  '&:hover': {
    borderColor: theme.palette.error.light,
    backgroundColor: theme.palette.error.dark,
  },
  '&:active': {
    transform: 'translateY(1px)',
  },
}));

export default SellButton;
