import type { Service } from 'qapp-core';

export type EncryptionMode = 'public' | 'group' | 'direct';

export interface EncryptionConfig {
  mode: EncryptionMode;
  service: Service;
  groupId?: number;
  adminsOnly?: boolean;
  recipients?: string[];
}

export interface ResourceIdentifier {
  name: string;
  service: Service;
  identifier: string;
}

/**
 * Placeholder helper that will eventually re-encrypt an existing QDN resource when
 * its permissions change (e.g., group membership updates or a resource is transferred).
 *
 * Future implementation will:
 * 1. Fetch the resource (public or private) and decrypt using the current config.
 * 2. Re-encrypt using the new config.
 * 3. Re-publish the resource under the same identifier/service with updated metadata.
 *
 * For now, it simply throws to signal that the behavior is not yet implemented.
 */
export async function modifyBaseEncryption(
  _resource: ResourceIdentifier,
  _from: EncryptionConfig,
  _to: EncryptionConfig
) {
  console.log(_resource, _from, _to);

  throw new Error('modifyBaseEncryption is not implemented yet.');
}
