import React, { FC } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
// import { ThemeProvider } from '@emotion/react';
import { lightTheme, darkTheme } from './theme';
import { EnumTheme, themeAtom } from '../../state/global/system';
import { useAtom } from 'jotai';
import { useEffect } from 'react';

interface ThemeProviderWrapperProps {
  children: React.ReactNode;
}

const ThemeProviderWrapper: FC<ThemeProviderWrapperProps> = ({ children }) => {
  const [theme] = useAtom(themeAtom);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === EnumTheme.DARK) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, [theme]);

  const currentTheme = theme === EnumTheme.LIGHT ? lightTheme : darkTheme;

  return (
    <ThemeProvider theme={currentTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
};

export default ThemeProviderWrapper;
