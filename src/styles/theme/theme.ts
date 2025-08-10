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
      main: 'rgba(65, 101, 136, 0.76)',
      dark: 'rgb(47, 58, 73)',
      light: 'rgb(219, 219, 219)',
      contrastText: 'rgba(27, 52, 66, 0.99)'
    },
    secondary: {
      main: 'rgb(54, 136, 177)',
      dark: 'rgb(31, 65, 85)',
      light: 'rgb(17, 105, 163)',
    },
    background: {
      default: 'rgb(201, 202, 209)',
      paper: 'rgb(172, 172, 172)', // darker card background
    },
    text: {
      primary: 'rgba(1, 4, 14, 0.87)', // 87% black (slightly softened)
      secondary: 'rgba(0, 10, 19, 0.67)', // 60% black
    },
    info: {
      main: 'rgb(66, 141, 190)',
      light: 'rgb(129, 177, 199)',
      dark: 'rgb(7, 73, 99)',
      contrastText: 'rgba(128, 211, 250, 0.88)'
    },
    success: {
      main: 'rgba(84, 152, 115, 0.91) ',
      dark: 'rgba(11, 87, 41, 0.9)',
      light: 'rgb(99, 204, 116)',
      contrastText: 'rgba(96, 192, 125, 0.85)'
    },
    warning: {
      main: 'rgb(126, 74, 16)',
      light: 'rgb(230, 135, 58)',
      dark: 'rgb(100, 47, 11)',
      contrastText: 'rgb(199, 111, 52)',
    },
    error: {
      main: 'rgb(228, 24, 24)',
      light: 'rgb(197, 56, 56)',
      dark: 'rgb(71, 6, 6)'
    },
    action: {
      hover: 'rgba(81, 132, 148, 0.79)' // your choice of light hover
    }

  },
});

const darkTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: 'rgba(29, 47, 71, 0.93)',
      dark: 'rgb(15, 24, 36)',
      // light: 'rgb(44, 104, 150)',
      light: 'rgba(54, 117, 153, 0.81)',
      contrastText: 'rgba(149, 191, 223, 0.81)'
    },
    secondary: {
      main: 'rgb(50, 79, 117)',
      dark: 'rgba(16, 17, 32, 0.9)',
      light: 'rgb(134, 154, 180)',
    },
    background: {
      default: 'rgb(11, 14, 19)',
      paper: 'rgba(25, 33, 43, 0.9)',
    },
    text: {
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgb(139, 139, 139)',
    },
    info: {
      main: 'rgb(42, 136, 199)',
      light: 'rgb(129, 177, 199)',
      dark: 'rgb(26, 107, 139)',
      contrastText: 'rgba(128, 211, 250, 0.88)',
    },
    success: {
      main: 'rgba(30, 92, 58, 0.75) ',
      dark: 'rgba(8, 53, 26, 0.79)',
      light: 'rgba(11, 134, 59, 0.78)',
      contrastText: 'rgba(170, 214, 183, 0.85)',
    },
    warning: {
      main: 'rgb(126, 74, 16)',
      light: 'rgb(230, 135, 58)',
      dark: 'rgba(56, 29, 7, 0.86)',
      contrastText: 'rgba(228, 140, 82, 0.75)',
    },
    error: {
      main: 'rgb(117, 26, 26)',
      light: 'rgb(185, 22, 22)',
      dark: 'rgba(59, 7, 7, 0.88)',
      contrastText: 'rgba(230, 58, 58, 0.75)',
    },
    action: {
      hover: 'rgba(69, 79, 105, 0.77)', 
      
    }
  },
});

export { lightTheme, darkTheme };
