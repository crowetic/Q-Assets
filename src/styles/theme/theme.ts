import { createTheme } from '@mui/material/styles';

const commonThemeOptions = {
  typography: {
    fontFamily: ['Inter'].join(','),
    h1: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h2: {
      fontSize: '1.75rem',
      fontWeight: 500,
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 500,
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 500,
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 500,
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 500,
    },
    body1: {
      fontSize: '1rem',
      fontWeight: 400,
      lineHeight: 1.5,
      letterSpacing: '0.5px',
    },

    body2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: '0.2px',
    },
  },
  spacing: 8,
  shape: {
    borderRadius: 4,
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        backgroundImage: 'none',
      },
    },
  },
  MuiPopover: {
    styleOverrides: {
      paper: {
        backgroundImage: 'none',
      },
    },
  },
};

const lightTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: 'rgb(36, 81, 92)',
      dark: 'rgb(27, 49, 53)',
      light: 'rgb(180, 200, 235)',
    },
    secondary: {
      main: 'rgba(194, 222, 236, 1)',
      dark: 'rgb(14, 70, 80)',
      light: 'rgb(137, 200, 216)',
    },
    background: {
      default: 'rgb(215, 217, 230)',
      paper: 'rgb(124, 156, 161)', // darker card background
    },
    text: {
      primary: 'rgba(0, 0, 0, 0.87)', // 87% black (slightly softened)
      secondary: 'rgba(0, 0, 0, 0.6)', // 60% black
    },
    action: {
      hover: 'rgb(81, 132, 148)' // your choice of light hover
    }

  },
});

const darkTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: 'rgb(12, 15, 17)',
      dark: 'rgb(21, 41, 58)',
      light: 'rgb(99, 162, 211)',
    },
    secondary: {
      main: 'rgb(26, 48, 65)',
      dark: 'rgb(24, 46, 43)',
      light: ' #ccd0f6',
    },
    background: {
      default: 'rgb(11, 14, 19)',
      paper: 'rgb(27, 45, 54)',
    },
    text: {
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgb(179, 179, 179)',
    },
    action: {
      hover: 'rgb(14, 14, 15)', 
      
    }
  },
});

export { lightTheme, darkTheme };
