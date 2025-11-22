import { ParsedQortal } from './parseQortalHref';

const THIS_APP = 'Q-Assets';

/**
 * Turns qortal://APP/Q-Assets/<path...> into "/<path...>"
 * - If no path -> "/"
 * - Strips leading slashes on input path and re-adds one
 * - Encodes each segment (preserves literal "%23" as-is)
 */
export function buildInternal(p: ParsedQortal): string | undefined {
  if (!p) return;
  const isOurApp = p.service?.toUpperCase() === 'APP' && p.name === THIS_APP;
  if (!isOurApp) return '/';

  const raw = (p.path ?? '').replace(/^\/+/, ''); // drop leading "/"
  if (!raw) return '/';

  const encoded = raw
    .split('/')
    // .map(seg => encodeURIComponent(seg).replace(/%2523/gi, '%23')) // avoid double-encoding "%23"
    .join('/');

  return '/' + encoded;
}
