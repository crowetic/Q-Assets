import { Theme } from '@mui/material/styles';
import {
  THEME_COLOR_TOKENS,
  themedColorCSSFromTheme,
} from '../tiptap/themeColorTokens';

/**
 * Wraps raw HTML in a container and embeds a minimal <style> that maps
 * data-theme-color tokens to hex colors from the provided theme palette.
 * Safe to publish to QDN; viewers without your React app will still see colors.
 */
export function prepareHtmlForPublish(html: string, theme: Theme, opts?: {
  scopeClassName?: string;          // default "qdn-content"
  addSignatureComment?: boolean;    // default true
}) {
  if (html.includes('class="qdn-content"') || html.includes("class='qdn-'")) {
    return html; // already prepared
  }
  function replaceAllCompat(str: string, search: string, replacement: string) {
    return str.split(search).join(replacement);
  }
  const scopeClassName = opts?.scopeClassName ?? 'qdn-content';
  

  const css = replaceAllCompat(
      themedColorCSSFromTheme(THEME_COLOR_TOKENS, theme),
    '.tiptap',
    `.${scopeClassName}`
  );

  const styleTag =
    `<style data-themed-colors-embedded>\n${css}\n</style>`;

  const wrapped =
    html.includes(`class="${scopeClassName}"`)
      ? html
      : `<div class="${scopeClassName}">${html}</div>`;

  const sig = opts?.addSignatureComment !== false
    ? `<!-- qassets: themed-colors embedded; scope=.${scopeClassName} -->\n`
    : '';

  return `${sig}${styleTag}\n${wrapped}`;
}
