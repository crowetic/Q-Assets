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
      main: 'rgb(90, 152, 84) ',
      dark: 'rgb(48, 102, 17)',
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
      main: 'rgb(8, 15, 20)',
      dark: 'rgb(21, 41, 58)',
      // light: 'rgb(44, 104, 150)',
      light: 'rgba(10, 92, 139, 0.99)',
      contrastText: 'rgba(205, 224, 247, 0.72)'
    },
    secondary: {
      main: 'rgb(37, 72, 99)',
      dark: 'rgb(38, 56, 63)',
      light: 'rgb(134, 154, 180)',
    },
    background: {
      default: 'rgb(11, 14, 19)',
      paper: 'rgb(27, 45, 54)',
    },
    text: {
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgb(139, 139, 139)',
    },
    info: {
      main: 'rgb(137, 152, 84) ',
      dark: 'rgb(109, 103, 17)',
    },
    action: {
      hover: 'rgb(14, 14, 15)', 
      
    }
  },
});

export { lightTheme, darkTheme };
