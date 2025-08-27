/* eslint-disable @typescript-eslint/no-explicit-any */
const _avatarCache = new Map<string, string | null>(); // name -> dataUrl|null
const AVATAR_IDENTIFIER = 'qortal_avatar';

export async function fetchAccountAvatarDataUrl(name?: string | null): Promise<string | null> {
  if (!name) return null;
  const key = name.trim();
  if (!key) return null;

  const cached = _avatarCache.get(key);
  if (cached !== undefined) return cached;

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
}
