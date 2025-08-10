import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';

const SuccessButton = styled(Button)(({ theme }) => ({
  borderRadius: '0.1rem',
  color: theme.palette.success.contrastText,
  borderColor: theme.palette.success.contrastText,
  borderWidth: 2,
  borderStyle: 'solid',
  textTransform: 'none',
  fontWeight: 600,
  px: 2.5,
  py: 1,
  transition: 'all .2s ease',
  '&:hover': {
    borderColor: theme.palette.success.main,
    backgroundColor: theme.palette.success.dark,
  },
  '&:active': {
    transform: 'translateY(1px)',
  },
}));

export default SuccessButton;
