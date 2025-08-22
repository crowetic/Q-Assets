import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';

const InfoOutlineButton = styled(Button)(({ theme }) => ({
  color: theme.palette.info.light,
  borderColor: theme.palette.info.dark,
  borderWidth: 2,
  borderStyle: 'solid',
  textTransform: 'none',
  fontWeight: 600,
  borderRadius: 8,
  fontFamily: 'Orbitron',
  px: 2.5,
  py: 1,
  transition: 'all .2s ease',
  '&:hover': {
    borderColor: theme.palette.info.main, // outline color on hover
    backgroundColor: theme.palette.info.dark, // optional hover bg
    color: theme.palette.background.default, // text color when hovered
  },
  '&:active': {
    transform: 'translateY(1px)',
  },
}));

export default InfoOutlineButton;
