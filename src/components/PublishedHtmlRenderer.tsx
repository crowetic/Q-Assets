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

// utils/linkifyQortal.ts
export function linkifyQortalHtml(html: string): string {
  if (!html || !html.includes('qortal://')) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const re = /(qortal:\/\/[^\s<>"']+)/gi; // only qortal://

  const ops: Array<{ node: Text; frag: DocumentFragment }> = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const text = n.nodeValue || '';
    if (!re.test(text)) continue;
    re.lastIndex = 0;

    const frag = doc.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const a = doc.createElement('a');
      a.href = m[0];
      a.rel = 'noopener';
      a.target = '_self';
      a.textContent = m[0];
      frag.append(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    ops.push({ node: n, frag });
  }
  for (const { node, frag } of ops) node.parentNode?.replaceChild(frag, node);

  return (doc.body.firstElementChild as HTMLElement)?.innerHTML ?? html;
}

export default function PublishedHtmlRenderer({
  html,
  scopeClassName = 'qdn-content qdn-html',
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

  const htmlinked = linkifyQortalHtml(html);

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
        dangerouslySetInnerHTML={{ __html: htmlinked }}
      />
    </>
  );
}
