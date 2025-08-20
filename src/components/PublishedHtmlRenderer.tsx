// src/components/PublishedHtmlRenderer.tsx
import * as React from 'react';
import { Box, useTheme } from '@mui/material';
import {
  THEME_COLOR_TOKENS,
  themedColorCSS,
  themedColorCSSFromTheme,
} from '../tiptap/themeColorTokens';

type Props = {
  html: string;
  /** Scope class applied to the wrapper; used in generated CSS selectors. */
  scopeClassName?: string; // default: "qdn-content"
  /** Prefer CSS variables (requires CssVarsProvider). */
  useCssVars?: boolean; // default: auto-detect
  /** Additional CSS to inject (optional). */
  extraCss?: string;
  /** Extra Box.sx for the wrapper (optional). */
  sx?: any;
};

export default function PublishedHtmlRenderer({
  html,
  scopeClassName = 'qdn-content',
  useCssVars,
  extraCss,
  sx,
}: Props) {
  const theme = useTheme();

  // Auto-detect CssVarsProvider if useCssVars wasn't explicitly provided
  const hasCssVars = React.useMemo(() => {
    const t: any = theme;
    return Boolean(t?.vars) || typeof t?.getCssVar === 'function';
  }, [theme]);
  const shouldUseCssVars = useCssVars ?? hasCssVars;

  const alreadyHasThemedStyle = /\bdata-themed-colors\b/.test(html);

  const replaceAllCompat = (str: string, search: string, replacement: string) =>
    str.split(search).join(replacement);

  const mappingCss = React.useMemo(() => {
    if (alreadyHasThemedStyle) return ''; // avoid double-inject
    const base = shouldUseCssVars
      ? themedColorCSS(THEME_COLOR_TOKENS) // uses CSS vars (live theme)
      : themedColorCSSFromTheme(THEME_COLOR_TOKENS, (theme as any).palette); // bakes hex

    // rewrite default ".tiptap" scope to our wrapper class
    const scoped = replaceAllCompat(base, '.tiptap', `.${scopeClassName}`);
    return `${scoped}${extraCss ? `\n${extraCss}` : ''}`;
  }, [alreadyHasThemedStyle, shouldUseCssVars, theme, scopeClassName, extraCss]);

  return (
    <>
      {!alreadyHasThemedStyle && mappingCss && <style data-themed-colors>{mappingCss}</style>}
      <Box
        className={scopeClassName}
        sx={{
          '& h1,h2,h3,h4,h5,h6': { mt: 2 },
          '& p': { mt: 1.5 },
          '& ul': { pl: '1.5rem', listStyleType: 'disc', my: 1.5 },
          '& ol': { pl: '1.5rem', listStyleType: 'decimal', my: 1.5 },
          '& img': { maxWidth: '100%', height: 'auto', display: 'block', my: 2 },
          ...sx,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
