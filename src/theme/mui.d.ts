// src/theme/mui.d.ts
import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
    link: {
      main: string;
      hover: string;
      visited: string;
      underline?: string;
    };
  }
  interface PaletteOptions {
    link?: Partial<Palette['link']>;
  }
}
