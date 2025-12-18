export const MAX_INLINE_FILE_SIZE = 25 * 1024 * 1024; // 25 MB for inlined files
export const DEFAULT_CHUNK_SIZE = 25 * 1024 * 1024; // 25 MB per chunk (adjust if needed)
export const CHUNK_FORCED_THRESHOLD = 100 * 1024 * 1024; // 100 MB enforce chunked

export interface FileChunkDescriptor {
  index: number;
  identifier: string;
  size: number;
}

export interface ChunkedFileManifest {
  version: 1;
  fileName: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  chunks: FileChunkDescriptor[];
  encryption?: {
    mode: 'none' | 'group' | 'direct';
    groupId?: number;
    adminsOnly?: boolean;
    recipientCount?: number;
  };
}

export async function* iterateFileChunks(
  file: File,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): AsyncGenerator<{ index: number; uint8: Uint8Array; size: number }, void, void> {
  let offset = 0;
  let index = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const slice = file.slice(offset, end);
    const buf = await slice.arrayBuffer();
    const uint8 = new Uint8Array(buf);
    yield { index, uint8, size: uint8.length };
    offset = end;
    index += 1;
  }
}

export function buildChunkIdentifier(baseIdentifier: string, index: number): string {
  return `${baseIdentifier}__chunk__${String(index).padStart(4, '0')}`;
}

export function createChunkedManifest(
  file: File,
  chunkSize: number,
  chunks: FileChunkDescriptor[],
  encryption?: ChunkedFileManifest['encryption'],
  mimeTypeOverride?: string
): ChunkedFileManifest {
  const mimeType = mimeTypeOverride || file.type || 'application/octet-stream';
  return {
    version: 1,
    fileName: file.name,
    size: file.size,
    mimeType,
    chunkSize,
    chunks,
    encryption,
  };
}
