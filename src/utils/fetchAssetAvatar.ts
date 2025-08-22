import { getAssetIdentifiers } from '../constants/qdnConstants';

// Optional: configure the QDN name that owns override avatars for core assets
const APP_OWNER_NAME =
  "Q-Assets"
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
const DEFAULT_AVATAR_IDENTIFIERS = [
  'assetAvatar_default',        // preferred
  'coreAvatar_default',         // legacy alias
  'qassets_default_avatar',     // legacy alias
];

// ---------------- MIME sniffing ----------------

function guessImageMimeFromBase64(base64: string): string {
  if (!base64) return 'application/octet-stream';
  // read a small slice
  const sample = atob(base64.slice(0, 64));
  const b = Array.from(sample).map(ch => ch.charCodeAt(0));

  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  // JPEG
  if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  // BMP
  if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
  // WEBP ("RIFF....WEBP")
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp';
  // SVG (text: "<svg")
  if (b[0] === 0x3C && b[1] === 0x73 && b[2] === 0x76 && b[3] === 0x67) return 'image/svg+xml';

  return 'application/octet-stream';
}

// simple in-memory cache to avoid repeated fetches
const avatarMemo = new Map<string, string | null>();
const memoOk = (k: string) => avatarMemo.has(k) ? avatarMemo.get(k)! : null;
const memoSet = (k: string, v: string | null) => { avatarMemo.set(k, v); return v; };

async function fetchOwnerImageByIdentifiers(ids: string[]): Promise<string | null> {
  if (!APP_OWNER_NAME) return null;
  for (const identifier of ids) {
    try {
      const base64 = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: APP_OWNER_NAME,
        service: 'IMAGE',
        identifier,
        encoding: 'base64',
      });
      if (base64 && typeof base64 === 'string') {
        const mime = guessImageMimeFromBase64(base64);
        return `data:${mime};base64,${base64}`;
      }
    } catch {/* try next id */}
  }
  return null;
}

export const fetchAssetAvatar = async (
  issuerName: string,
  assetName: string
): Promise<string | null> => {
  const memoKey = `${issuerName}::${assetName}`;
  const hit = memoOk(memoKey);
  if (hit !== null) return hit;

  const coreKey = canonicalCoreKey(assetName);

  // 1) Issuer’s canonical publish (ID-based identifier)
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
      return memoSet(memoKey, `data:${mime};base64,${base64}`);
    } catch {
      // fall through
    }

    // 1b) Issuer fallback: fuzzy search (wrong-ID publishes)
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

      const match = (Array.isArray(results) ? results : [results]).find(
        (r: any) => typeof r?.identifier === 'string' && r.identifier.includes(`_${assetName}_`)
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
        return memoSet(memoKey, `data:${mime};base64,${base64}`);
      }
    } catch {
      // ignore, move on
    }
  } catch (e) {
    console.warn('[fetchAssetAvatar] identifier resolution failed:', e);
  }

  // 2) App owner: DEFAULT avatar on QDN (for any asset lacking a custom image)
  try {
    const ownerDefault = await fetchOwnerImageByIdentifiers(DEFAULT_AVATAR_IDENTIFIERS);
    if (ownerDefault) return memoSet(memoKey, ownerDefault);
  } catch {/* continue */ }
  
  

  // 3) App owner: core-asset override (QDN) if applicable
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
      return memoSet(memoKey, `data:${mime};base64,${base64}`);
    } catch {/* fall through */}
  }

  // 4) Static bundle (last resort)
  if (coreKey) return memoSet(memoKey, staticCoreAssetPath(coreKey));

  // Out of options
  return memoSet(memoKey, null);
};