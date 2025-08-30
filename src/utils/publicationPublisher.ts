import { Theme } from '@mui/material/styles';
import { THEME_COLOR_TOKENS, themedColorCSSFromTheme } from '../tiptap/themeColorTokens';
// If you don't have types installed for dompurify, this default import will still work:
import DOMPurify from 'dompurify';

function replaceAllCompat(s: string, search: string, replacement: string) {
  // Works on ES5+: replaces ALL occurrences
  return s.split(search).join(replacement);
}

export function prepareHtmlForPublish(
  html: string,
  theme: Theme,
  opts?: {
    scopeClassName?: string;        // default "qdn-content"
    addSignatureComment?: boolean;  // default true
  }
) {
  if (html.includes('class="qdn-content"') || html.includes("class='qdn-'")) return html;

  const scopeClassName = (opts && opts.scopeClassName) || 'qdn-content';

  // Scope token CSS to your content wrapper, replace ".tiptap" without using replaceAll
  const css = replaceAllCompat(
    themedColorCSSFromTheme(THEME_COLOR_TOKENS, theme),
    '.tiptap',
    '.' + scopeClassName
  );

  const styleTag = `<style data-themed-colors-embedded>${css}</style>`;
  const wrapped =
    html.indexOf(`class="${scopeClassName}"`) >= 0
      ? html
      : `<div class="${scopeClassName}">${html}</div>`;

  const publication = styleTag + '\n' + wrapped;

  // Link policy helpers
  const isExternalHref = (s: string) => /^(?:https?:|ftp:|\/\/)/i.test(s.trim());
  const isAllowedHref = (s: string) => {
    const href = s.trim();
    if (!href) return true;
    if (/^qortal:\/\//i.test(href)) return true;
    if (href[0] === '#') return true;
    if (href[0] === '/' || href.slice(0, 2) === './' || href.slice(0, 3) === '../') return true;
    return !isExternalHref(href);
  };

  // Hook: after attributes sanitized, neuter only external anchors
  const onAfterAttrs = (node: Element) => {
    if (node.nodeType !== 1) return;

    // 1) Remove any <style> that isn't our embedded one
    if ((node as HTMLElement).tagName.toLowerCase() === 'style') {
      const ok = (node as HTMLElement).hasAttribute('data-themed-colors-embedded');
      if (!ok && node.parentNode) node.parentNode.removeChild(node);
      return;
    }

    // 2) Neuter external <a href="...">
    if ((node as HTMLElement).tagName.toLowerCase() === 'a') {
      const a = node as HTMLAnchorElement;
      const href = a.getAttribute('href');
      if (href && !isAllowedHref(href)) {
        a.removeAttribute('href');
        // optional: a.setAttribute('data-disabled-href', href);
      }
    }
  };

  // Use only hooks your typings will accept without needing DOMPurify namespace types
  (DOMPurify as any).addHook('afterSanitizeAttributes', onAfterAttrs);

  try {
    const sanitized = DOMPurify.sanitize(publication, {
      // Keep default allowed tags (so <hr> survives).
      // Add exactly our one allowed <style> tag and its identifying attribute:
      ADD_TAGS: ['style'],
      ADD_ATTR: ['data-themed-colors-embedded'],
      KEEP_CONTENT: true,
    });

    // Comments are stripped by DOMPurify; add the signature after
    const sig =
      opts && opts.addSignatureComment === false
        ? ''
        : `<!-- qassets: themed-colors embedded; scope=.${scopeClassName} -->\n`;

    return sig + sanitized;
  } finally {
    (DOMPurify as any).removeHook('afterSanitizeAttributes');
  }
}
