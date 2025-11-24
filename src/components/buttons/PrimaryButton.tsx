import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';

const PrimaryButton = styled(Button)(({ theme }) => ({
  borderRadius: '0.1rem',
  color: theme.palette.primary.main,
  borderColor: theme.palette.primary.main,
  borderWidth: 2,
  borderStyle: 'solid',
  textTransform: 'none',
  fontWeight: 600,
  fontFamily: 'Orbitron',
  padding: theme.spacing(1, 2.5),
  transition: 'all .2s ease',
  '&:hover': {
    borderColor: theme.palette.primary.light,
    backgroundColor: theme.palette.primary.dark,
    color: theme.palette.primary.contrastText,
  },
  '&:active': {
    transform: 'translateY(1px)',
  },
}));

export default PrimaryButton;
