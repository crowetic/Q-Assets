import { getAssetIdentifiers } from '../constants/qdnConstants';

// Optional: configure the QDN name that owns override avatars for core assets
const APP_OWNER_NAME =
  // (import.meta as any)?.env?.VITE_QASSETS_OWNER_NAME ||
  // (window as any)?._qassetsOwnerName ||
  undefined;

// ---------------- Core-asset helpers ----------------

type CoreKey = 'qort' | 'legacy-qora' | 'qort-from-qora';

// map aliases -> canonical key
const CORE_ASSET_ALIASES: Record<string, CoreKey> = {
  'qort': 'qort',
  'qortal': 'qort',
  'legacy-qora': 'legacy-qora',
  'legacy_qora': 'legacy-qora',                
  'qort-from-qora': 'qort-from-qora',
  'qort_from_qora': 'qort-from-qora',
};

function canonicalCoreKey(assetName: string): CoreKey | null {
  const k = CORE_ASSET_ALIASES[assetName.trim().toLowerCase()];
  return k || null;
}

// local static assets shipped with the app (ensure these files exist)
function staticCoreAssetPath(key: CoreKey): string {
  switch (key) {
    case 'qort': return '/src/core-assets/QORT-logo-512.png';
    case 'legacy-qora': return '/src/core-assets/QORA-logo-GOOD.png';
    case 'qort-from-qora': return '/src/core-assets/QORT-to-QORA-logo.png';
  }
}

// QDN override identifier for core assets (owned by app owner)
function coreOverrideIdentifier(key: CoreKey) {
  // keep this simple and documented so the app owner can publish/replace
  // e.g. publish IMAGE with identifier: "coreAvatar_qort" under APP_OWNER_NAME
  return `coreAvatar_${key}`;
}

// ---------------- MIME sniffing ----------------

function guessImageMimeFromBase64(base64: string): string {
  const binary = atob(base64.slice(0, 50));
  const b = Array.from(binary).map(ch => ch.charCodeAt(0));
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp';
  return 'application/octet-stream';
}

// simple in-memory cache to avoid repeated fetches
const avatarMemo = new Map<string, string | null>();

export const fetchAssetAvatar = async (
  issuerName: string,
  assetName: string
): Promise<string | null> => {
  const memoKey = `${issuerName}::${assetName}`;
  if (avatarMemo.has(memoKey)) return avatarMemo.get(memoKey)!;

  const coreKey = canonicalCoreKey(assetName);

  // 1) normal: issuer publish, correct ID-based identifier
  try {
    const publishInfo = await getAssetIdentifiers(assetName);
    try {
      const base64 = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: issuerName,
        service: publishInfo.services.avatar,
        identifier: publishInfo.identifiers.avatar,
        encoding: 'base64',
      });
      const mime = guessImageMimeFromBase64(base64);
      const url = `data:${mime};base64,${base64}`;
      avatarMemo.set(memoKey, url);
      return url;
    } catch {
      // fall through to issuer fallback search
    }

    // 1b) issuer fallback search for wrong-ID publishes
    try {
      const results = await qortalRequest({
        action: 'SEARCH_QDN_RESOURCES',
        service: publishInfo.services.avatar,
        name: issuerName,
        query: 'asset',
        default: false,
        includeStatus: false,
        includeMetadata: false,
        followedOnly: false,
        excludeBlocked: false,
        limit: 20,
        offset: 0,
        reverse: true,
        names: [],
        keywords: [],
        exactMatchNames: true,
        prefix: true,
      });

      const match = results.find(
        (r: any) => typeof r.identifier === 'string' && r.identifier.includes(`_${assetName}_`)
      );

      if (match) {
        const base64 = await qortalRequest({
          action: 'FETCH_QDN_RESOURCE',
          name: issuerName,
          service: match.service,
          identifier: match.identifier,
          encoding: 'base64',
        });
        const mime = guessImageMimeFromBase64(base64);
        const url = `data:${mime};base64,${base64}`;
        avatarMemo.set(memoKey, url);
        return url;
      }
    } catch {
      // ignore, move to core overrides
    }
  } catch (e) {
    console.warn('[fetchAssetAvatar] identifier resolution failed:', e);
  }

  // 2) core-asset owner override (QDN), if applicable
  if (coreKey && APP_OWNER_NAME) {
    try {
      const overrideId = coreOverrideIdentifier(coreKey);
      const base64 = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: APP_OWNER_NAME,
        service: 'IMAGE',
        identifier: overrideId,
        encoding: 'base64',
      });
      const mime = guessImageMimeFromBase64(base64);
      const url = `data:${mime};base64,${base64}`;
      avatarMemo.set(memoKey, url);
      return url;
    } catch {
      // no override present—fall through to static
    }
  }

  // 3) static fail-safe from app bundle
  if (coreKey) {
    const staticUrl = staticCoreAssetPath(coreKey);
    avatarMemo.set(memoKey, staticUrl);
    return staticUrl; // not base64; fine for <img src=...>
  }

  // out of options
  avatarMemo.set(memoKey, null);
  return null;
};
