export const THEME_COLOR_TOKENS = [
  'text.primary',
  'text.secondary',
  'primary.light',
  'primary.main',
  'primary.dark',
  'secondary.main',
  'success.main',
  'warning.main',
  'error.main',
  'info.main',
] as const;

export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];

/** CSS using MUI CSS vars (requires CssVarsProvider). */
export function themedColorCSS(tokens: readonly string[]) {
  const toVarName = (token: string) => `--mui-palette-${token.replace('.', '-')}`;
  // default `.tiptap` scope – renderer can rewrite it to its container class
  return tokens
    .map((t) => `.tiptap [data-theme-color="${t}"]{ color: var(${toVarName(t)}); }`)
    .join('\n');
}

/** CSS using *hex values* from a palette object (no CssVarsProvider required). */
export function themedColorCSSFromTheme(tokens: readonly string[], palette: Record<string, any>) {
  const resolve = (t: string) => {
    const [cat, shade] = t.split('.');
    const v = palette?.[cat]?.[shade as any];
    return typeof v === 'string' ? v : palette?.text?.primary || '#ddd';
  };
  return tokens.map((t) => `.tiptap [data-theme-color="${t}"]{ color: ${resolve(t)}; }`).join('\n');
}
