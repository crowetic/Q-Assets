// QortalLinkHandler.tsx
import { useQortalLink } from './QortalLinkProvider';

export function QortalLinkHandler({ children }: { children: React.ReactNode }) {
  const { openQortalLink } = useQortalLink();

  const onClickCapture: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const el = e.target as Element | null;
    if (!el || el.nodeType !== 1) return;
    const a = (el as HTMLElement).closest('a');
    if (!a) return;

    const href = a.getAttribute('href') || '';
    if (!/^qortal:\/\//i.test(href)) return;

    console.log('[QortalLinkHandler] intercept', { href, a });
    e.preventDefault();
    e.stopPropagation();

    void openQortalLink(href);
  };

  return <div onClickCapture={onClickCapture}>{children}</div>;
}
