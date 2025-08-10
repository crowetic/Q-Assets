import { styled, alpha } from '@mui/material/styles';
import Button from '@mui/material/Button';

interface EditToggleButtonProps {
  editing?: boolean;
}

const EditToggleButton = styled(Button, {
  shouldForwardProp: (prop) => prop !== 'editing', // don't pass 'editing' to DOM
})<EditToggleButtonProps>(({ theme, editing }) => {
  const { palette } = theme;

  const common = {
    textTransform: 'none' as const,
    fontWeight: 700,
    px: 2.5,
    py: 1,
    borderWidth: 2,
    borderStyle: 'solid' as const,
    borderRadius: 8,
    boxShadow: 'none',
    transition: 'all .2s ease',
    '&:active': { transform: 'translateY(1px)' },
    '&:focus-visible': {
      outline: `2px solid ${alpha(palette.info.light, 0.7)}`,
      outlineOffset: 2,
    },
  };

  if (!editing) {
    return {
      ...common,
      color: palette.info.light,
      borderColor: palette.info.dark,
      backgroundColor: alpha(palette.info.dark, 0.15),
      '&:hover': {
        borderColor: palette.info.main,
        backgroundColor: alpha(palette.info.main, 0.25),
        color: palette.background.default,
      },
    };
  }

  return {
    ...common,
    color: palette.background.default,
    borderColor: 'transparent',
    backgroundColor: palette.info.main,
    '&:hover': {
      backgroundColor: palette.info.dark,
    },
  };
});

export default EditToggleButton;
