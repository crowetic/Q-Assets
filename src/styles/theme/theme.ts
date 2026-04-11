import { createTheme, alpha } from '@mui/material/styles';

const commonThemeOptions = {
  typography: {
    fontFamily: ['Exo2', 'Inter', 'NataSans', 'Orbitron'].join(','),
    h1: {
      fontSize: '2.5rem',
      fontWeight: 650,
      fontFamily: 'Exo2',
    },
    h2: {
      fontSize: '2.25rem',
      fontWeight: 550,
      fontFamily: 'Exo2',
    },
    h3: {
      fontSize: '2.0rem',
      fontWeight: 520,
      fontFamily: 'Exo2',
    },
    h4: {
      fontSize: '1.75rem',
      fontWeight: 510,
      fontFamily: 'Exo2',
    },
    h5: {
      fontSize: '1.5rem',
      fontWeight: 500,
      fontFamily: 'Exo2',
    },
    h6: {
      fontSize: '1.25rem',
      fontWeight: 475,
      fontFamily: 'Exo2',
    },
    body1: {
      fontSize: '1rem',
      fontWeight: 425,
      lineHeight: 1.5,
      letterSpacing: '0.5px',
      fontFamily: 'Exo2',
    },

    body2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: '0.2px',
      fontFamily: 'Inter',
    },
    p: {
      fontFamily: 'Exo2',
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
      contrastText: 'rgba(24, 40, 48, 0.99)',
    },
    secondary: {
      main: 'rgb(50, 110, 160)',
      dark: 'rgb(31, 65, 85)',
      light: 'rgb(17, 105, 163)',
    },
    background: {
      default: 'rgb(235, 235, 235)',
      paper: 'rgb(218, 217, 217)', // darker card background
    },
    text: {
      primary: 'rgba(1, 3, 7, 0.93)', // 87% black (slightly softened)
      secondary: 'rgba(1, 21, 39, 0.73)', // 60% black
    },
    info: {
      main: 'rgb(2, 80, 133)',
      light: 'rgb(28, 93, 146)',
      dark: 'rgb(0, 51, 80)',
      contrastText: 'rgba(128, 211, 250, 0.88)',
    },
    success: {
      main: 'rgba(7, 44, 18, 0.91) ',
      dark: 'rgba(7, 27, 15, 0.9)',
      light: 'rgb(48, 107, 53)',
      contrastText: 'rgba(6, 155, 51, 0.9)',
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
      contrastText: 'rgb(211, 113, 113)',
    },
    action: {
      hover: 'rgba(81, 132, 148, 0.72)', // your choice of light hover
    },
    link: {
      main: 'rgb(2, 80, 133)', // info.main
      hover: 'rgb(28, 93, 146)', // info.light
      visited: 'rgb(31, 31, 31)', // subtle purple for visited
      underline: 'rgba(2, 80, 133, .5)', // faint underline color
    },
  },

  components: {
    // Global link defaults (applies to <a>, ProseMirror, your QDN HTML boxes)
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        /* anchors */
        a: {
          color: theme.palette.link.main,
          textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
          textUnderlineOffset: '2px',
        },
        'a:hover': {
          color: theme.palette.link.hover,
          textDecoration: 'underline',
        },
        'a:visited': {
          color: theme.palette.link.visited,
        },
        'a:focus-visible': {
          outline: `2px solid ${alpha(theme.palette.link.main, 0.35)}`,
          outlineOffset: '2px',
          borderRadius: '2px',
        },

        /* TipTap content (ProseMirror) */
        '.ProseMirror a': {
          color: theme.palette.link.main,
          textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
        },

        /* Your QDN HTML containers (add className="qdn-html" to the Box) */
        '.qdn-html a': {
          color: theme.palette.link.main,
          textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
        },
      }),
    },

    // Optional: default MUI <Link> to inherit typography and underline-on-hover
    MuiLink: {
      defaultProps: { underline: 'hover', color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          color: theme.palette.link.main,
          '&:hover': { color: theme.palette.link.hover },
          '&:visited': { color: theme.palette.link.visited },
        }),
      },
    },

    // Optional: let <Typography> render links nicely inside it
    MuiTypography: {
      styleOverrides: {
        root: ({ theme }) => ({
          '& a': {
            color: theme.palette.link.main,
            textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
          },
          '& a:hover': {
            color: theme.palette.link.hover,
          },
          '& a:visited': {
            color: theme.palette.link.visited,
          },
        }),
      },
    },
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
      light: 'rgb(53, 54, 56)',
      contrastText: 'rgba(149, 191, 223, 0.81)',
    },
    secondary: {
      main: 'rgb(52, 75, 104)',
      // dark: 'rgba(17, 20, 54, 0.9)',
      dark: 'rgba(16, 23, 53, 0.94)',
      light: 'rgb(96, 165, 211)',
    },
    background: {
      default: 'rgb(11, 14, 19)',
      paper: 'rgba(22, 32, 43, 0.94)',
    },
    text: {
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgb(153, 168, 175)',
    },
    info: {
      main: 'rgb(42, 136, 199)',
      light: 'rgb(120, 196, 231)',
      dark: 'rgb(26, 107, 139)',
      contrastText: 'rgba(151, 216, 247, 0.88)',
    },
    success: {
      main: 'rgba(18, 146, 75, 0.86) ',
      dark: 'rgba(8, 53, 26, 0.79)',
      light: 'rgba(28, 192, 77, 0.78)',
      contrastText: 'rgba(104, 238, 144, 0.93)',
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
      hover: 'rgba(69, 79, 105, 0.61)',
    },
    link: {
      main: 'rgb(120, 196, 231)', // info.light
      hover: 'rgb(42, 136, 199)', // info.main (slightly deeper on hover)
      visited: 'rgb(189, 187, 190)', // soft violet
      underline: 'rgba(120, 196, 231, .55)',
    },
  },

  components: {
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none' } } },
    MuiPopover: { styleOverrides: { paper: { backgroundImage: 'none' } } },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        a: {
          color: theme.palette.link.main,
          textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
          textUnderlineOffset: '2px',
        },
        'a:hover': {
          color: theme.palette.link.hover,
          textDecoration: 'underline',
        },
        'a:visited': {
          color: theme.palette.link.visited,
        },
        'a:focus-visible': {
          outline: `2px solid ${alpha(theme.palette.link.main, 0.45)}`,
          outlineOffset: '2px',
          borderRadius: '2px',
        },
        '.ProseMirror a, .qdn-html a': {
          color: theme.palette.link.main,
          textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
        },
      }),
    },
    MuiLink: {
      defaultProps: { underline: 'hover', color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          color: theme.palette.link.main,
          '&:hover': { color: theme.palette.link.hover },
          '&:visited': { color: theme.palette.link.visited },
        }),
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: ({ theme }) => ({
          '& a': {
            color: theme.palette.link.main,
            textDecorationColor: theme.palette.link.underline ?? theme.palette.link.main,
          },
          '& a:hover': {
            color: theme.palette.link.hover,
          },
          '& a:visited': {
            color: theme.palette.link.visited,
          },
        }),
      },
    },
  },
});

export { lightTheme, darkTheme };
