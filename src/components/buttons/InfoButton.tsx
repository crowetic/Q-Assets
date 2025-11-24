import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';

const InfoButton = styled(Button)(({ theme }) => ({
  borderRadius: '0.1rem',
  color: theme.palette.info.main,
  borderColor: theme.palette.info.main,
  borderWidth: 2,
  borderStyle: 'solid',
  textTransform: 'none',
  fontWeight: 600,
  fontFamily: 'Orbitron',
  padding: theme.spacing(1, 2.5),
  transition: 'all .2s ease',
  '&:hover': {
    borderColor: theme.palette.info.light,
    backgroundColor: theme.palette.info.dark,
    color: theme.palette.info.contrastText,
  },
  '&:active': {
    transform: 'translateY(1px)',
  },
}));

export default InfoButton;
