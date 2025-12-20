const PRIVATE_STRUCTURED_METADATA_PREFIX = 'qassets-private:';

type PrivateStructuredPayload = {
  version: 1;
  path?: string | null;
  fileName?: string | null;
};

const encodeBase64 = (value: string) => {
  if (typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function') {
    return globalThis.btoa(encodeURIComponent(value));
  }
  const bufferCtor = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
  if (bufferCtor) {
    return bufferCtor.from(value, 'utf-8').toString('base64');
  }
  throw new Error('Unable to base64 encode value.');
};

const decodeBase64 = (value: string) => {
  if (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function') {
    return decodeURIComponent(globalThis.atob(value));
  }
  const bufferCtor = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
  if (bufferCtor) {
    return bufferCtor.from(value, 'base64').toString('utf-8');
  }
  throw new Error('Unable to base64 decode value.');
};

const normalizeDescription = (description?: string) =>
  description?.trim().replace(/\s+$/g, '') ?? '';

export const encodePrivateStructuredMetadata = (payload: {
  path?: string | null;
  fileName?: string | null;
}) => {
  const normalized: PrivateStructuredPayload = {
    version: 1,
    path: payload.path || undefined,
    fileName: payload.fileName || undefined,
  };
  const data = JSON.stringify(normalized);
  return `${PRIVATE_STRUCTURED_METADATA_PREFIX}${encodeBase64(data)}`;
};

export const extractPrivateStructuredDescription = (description?: string) => {
  if (!description) return { base: '', encoded: null };
  const trimmed = description.trim();
  const match = trimmed.match(new RegExp(`${PRIVATE_STRUCTURED_METADATA_PREFIX}([A-Za-z0-9+/=]+)`));
  if (!match) return { base: trimmed, encoded: null };
  const encoded = `${PRIVATE_STRUCTURED_METADATA_PREFIX}${match[1]}`;
  const base = trimmed.replace(encoded, '').trim();
  return { base, encoded };
};

export const withPrivateStructuredDescription = (
  description: string | undefined,
  encodedMetadata: string | null | undefined
) => {
  if (!encodedMetadata) return normalizeDescription(description);
  const { base } = extractPrivateStructuredDescription(description);
  if (base) {
    return `${encodedMetadata}\n${base}`;
  }
  return encodedMetadata;
};

export const decodePrivateStructuredMetadata = (
  description?: string
): { path?: string; fileName?: string } | null => {
  const { encoded } = extractPrivateStructuredDescription(description);
  if (!encoded) return null;
  let payload = encoded.slice(PRIVATE_STRUCTURED_METADATA_PREFIX.length).trim();
  if (!payload) return null;
  try {
    const pad = payload.length % 4;
    if (pad) payload = `${payload}${'='.repeat(4 - pad)}`;
    const decoded = decodeBase64(payload);
    let jsonText = decoded;
    try {
      jsonText = decodeURIComponent(decoded);
    } catch {
      // fallback to raw decoded content
    }
    try {
      const parsed = JSON.parse(jsonText) as PrivateStructuredPayload;
      return {
        path: parsed.path || undefined,
        fileName: parsed.fileName || undefined,
      };
    } catch {
      const trimmed = jsonText.trim();
      if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
        const needsQuote = trimmed.split('"').length % 2 === 0;
        const repaired = `${trimmed}${needsQuote ? '"' : ''}}`;
        const parsed = JSON.parse(repaired) as PrivateStructuredPayload;
        return {
          path: parsed.path || undefined,
          fileName: parsed.fileName || undefined,
        };
      }
      return null;
    }
  } catch {
    return null;
  }
};
