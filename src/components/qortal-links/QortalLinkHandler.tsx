// QortalLinkHandler.tsx
import { useQortalLink } from './QortalLinkProvider';
import { useAlert } from '../alerts';

const HTTP_URL_PATTERN = /^https?:\/\//i;

const copyTextToClipboard = async (text: string) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to text area fallback
    }
  }

  if (typeof document === 'undefined') {
    return;
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  } catch {
    // best effort only
  }
};

export function QortalLinkHandler({ children }: { children: React.ReactNode }) {
  const { openQortalLink } = useQortalLink();
  const { alert } = useAlert();

  const alertExternalLinkCopied = async (url: string) => {
    await alert(
      `The external (internet) link ${url} has been copied to your clipboard. Qortal doesn't handle internet links, so you will need to paste it into your browser to access it.`,
      'External link copied',
      { severity: 'info' }
    );
  };

  const onClickCapture: React.MouseEventHandler<HTMLDivElement> = async (event) => {
    // const target = event.target;
    const node = event.target as Node | null;
    const el =
      node instanceof Element ? node : node && 'parentElement' in node ? node.parentElement : null;
    const anchor = el?.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute('href') ?? '';

    if (HTTP_URL_PATTERN.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      await copyTextToClipboard(href);
      await alertExternalLinkCopied(href);
      return;
    }

    if (/^qortal:\/\//i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      await openQortalLink(href);
      return;
    }
  };

  return <div onClickCapture={onClickCapture}>{children}</div>;
}
