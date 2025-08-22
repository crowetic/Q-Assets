import { createTheme } from '@mui/material/styles';

const commonThemeOptions = {
  typography: {
    FontFamily: ['Orbitron', 'Inter', 'NataSans', 'Exo2'].join(','),
    h1: {
      fontSize: '2.5rem',
      fontWeight: 650,
      fontFamily: 'Orbitron'
    },
    h2: {
      fontSize: '2.25rem',
      fontWeight: 550,
      fontFamily: 'Orbitron'
    },
    h3: {
      fontSize: '2.0rem',
      fontWeight: 520,
      fontFamily: 'Orbitron'
    },
    h4: {
      fontSize: '1.75rem',
      fontWeight: 510,
      fontFamily: 'Orbitron'
    },
    h5: {
      fontSize: '1.5rem',
      fontWeight: 500,
      fontFamily: 'Orbitron'
    },
    h6: {
      fontSize: '1.25rem',
      fontWeight: 475,
      fontFamily: 'Orbitron'
    },
    body1: {
      fontSize: '1rem',
      fontWeight: 425,
      lineHeight: 1.5,
      letterSpacing: '0.5px',
      fontFamily: 'Exo2'
    },

    body2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: '0.2px',
      fontFamily: 'Inter'
    },
    p: {
      fontFamily: 'Exo2'
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
      main: 'rgba(43, 72, 102, 0.76)',
      dark: 'rgb(29, 50, 80)',
      light: 'rgb(158, 158, 158)',
      contrastText: 'rgba(24, 40, 48, 0.99)'
    },
    secondary: {
      main: 'rgb(50, 110, 160)',
      dark: 'rgb(31, 65, 85)',
      light: 'rgb(17, 105, 163)',
    },
    background: {
      default: 'rgb(235, 235, 235)',
      paper: 'rgb(197, 197, 197)', // darker card background
    },
    text: {
      primary: 'rgba(1, 3, 7, 0.93)', // 87% black (slightly softened)
      secondary: 'rgba(1, 21, 39, 0.73)', // 60% black
    },
    info: {
      main: 'rgb(2, 80, 133)',
      light: 'rgb(28, 93, 146)',
      dark: 'rgb(0, 51, 80)',
      contrastText: 'rgba(128, 211, 250, 0.88)'
    },
    success: {
      main: 'rgba(7, 44, 18, 0.91) ',
      dark: 'rgba(7, 27, 15, 0.9)',
      light: 'rgb(48, 107, 53)',
      contrastText: 'rgba(6, 155, 51, 0.9)'
    },
    warning: {
      main: 'rgb(126, 74, 16)',
      light: 'rgb(230, 135, 58)',
      dark: 'rgb(100, 47, 11)',
      contrastText: 'rgb(199, 111, 52)',
    },
    error: {
      main: 'rgb(185, 14, 14)',
      light: 'rgb(197, 56, 56)',
      dark: 'rgb(71, 6, 6)',
      contrastText: 'rgb(211, 113, 113)'
    },
    action: {
      hover: 'rgba(81, 132, 148, 0.72)' // your choice of light hover
    }

  },
});

const darkTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: 'rgba(65, 112, 173, 0.93)',
      dark: 'rgb(15, 24, 36)',
      // light: 'rgb(44, 104, 150)',
      light: 'rgb(59, 62, 65)',
      contrastText: 'rgba(149, 191, 223, 0.81)'
    },
    secondary: {
      main: 'rgb(55, 73, 97)',
      dark: 'rgba(17, 20, 54, 0.9)',
      light: 'rgb(96, 165, 211)',
    },
    background: {
      default: 'rgb(11, 14, 19)',
      paper: 'rgba(25, 33, 43, 0.9)',
    },
    text: {
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgb(153, 168, 175)',
    },
    info: {
      main: 'rgb(42, 136, 199)',
      light: 'rgb(129, 177, 199)',
      dark: 'rgb(26, 107, 139)',
      contrastText: 'rgba(128, 211, 250, 0.88)',
    },
    success: {
      main: 'rgba(16, 100, 54, 0.86) ',
      dark: 'rgba(8, 53, 26, 0.79)',
      light: 'rgba(0, 150, 45, 0.78)',
      contrastText: 'rgba(81, 247, 131, 0.93)',
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
      contrastText: 'rgba(253, 45, 45, 0.75)',
    },
    action: {
      hover: 'rgba(69, 79, 105, 0.75)', 
      
    }
  },
  
});


export { lightTheme, darkTheme };
