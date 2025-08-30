import { Theme } from '@mui/material/styles';
import {
  THEME_COLOR_TOKENS,
  themedColorCSSFromTheme,
} from '../tiptap/themeColorTokens';
import DOMPurify from 'dompurify';


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
  const ALLOWED_URI = /^qortal:|^[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$)/i;

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
  
  const publication = `${sig}${styleTag}\n${wrapped}`

  return DOMPurify.sanitize(publication, {
    ALLOWED_TAGS: [/* your list or DOMPurify defaults */ 'a','p','b','i','strong','em','code','pre','ul','ol','li','img','span','div','br','h1','h2','h3','h4','h5','h6'],
    ALLOWED_ATTR: ['href','title','alt','style','class','src'],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    // ADD_ATTR: ['target','rel'],
  });
}
