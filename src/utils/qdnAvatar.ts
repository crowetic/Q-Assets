const _avatarCache = new Map<string, string | null>(); // name -> dataUrl|null
const _avatarInflight = new Map<string, Promise<string | null>>();
const AVATAR_IDENTIFIER = 'qortal_avatar';

function normalizeAvatarName(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  if (!trimmed.includes('%')) return trimmed;
  try {
    const decoded = decodeURIComponent(trimmed).trim();
    return decoded || trimmed;
  } catch {
    return trimmed;
  }
}

export function peekAccountAvatarDataUrl(name?: string | null): string | null | undefined {
  const key = normalizeAvatarName(name);
  if (!key) return undefined;
  return _avatarCache.get(key);
}

export async function fetchAccountAvatarDataUrl(name?: string | null): Promise<string | null> {
  const key = normalizeAvatarName(name);
  if (!key) return null;

  const cached = _avatarCache.get(key);
  if (cached !== undefined) return cached;

  const inflight = _avatarInflight.get(key);
  if (inflight) return inflight;

  const run = (async () => {
    try {
      const b64 = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        service: 'THUMBNAIL',
        name: key,
        identifier: AVATAR_IDENTIFIER,
        encoding: 'base64',
        rebuild: false,
      } as any);

      if (typeof b64 === 'string' && b64.length) {
        const dataUrl = `data:image/*;base64,${b64}`;
        _avatarCache.set(key, dataUrl);
        return dataUrl;
      }
    } catch {
      // ignore
    }
    _avatarCache.set(key, null);
    return null;
  })();

  _avatarInflight.set(key, run);
  try {
    return await run;
  } finally {
    _avatarInflight.delete(key);
  }
}
