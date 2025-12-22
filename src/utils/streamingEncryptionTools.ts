import { Service } from 'qapp-core';

type QdnLocation = {
  service: Service;
  name: string;
  identifier: string;
};

type StreamKeys = {
  key: string;
  iv: string;
};

type PublishStreamKeysParams = {
  location: QdnLocation;
  streamKeys: StreamKeys;
  groupId?: number;
  publicKeys?: string[];
  isAdmins?: boolean;
};

type PublishEncryptedStreamResourceParams = {
  location: QdnLocation;
  file: File;
  filename: string;
  key: string;
  iv: string;
};

type FetchStreamKeysParams = {
  location: QdnLocation;
  groupId?: number;
  isAdmins?: boolean;
  refreshCache?: boolean;
  publicKey?: string;
};

type PlayStreamParams = {
  mediaId: string;
  location: QdnLocation;
  key: string;
  iv: string;
  totalSize?: number;
  mimeType?: string;
};

type PlayStreamResult = {
  success: boolean;
  mediaId: string;
  streamUrl: string;
  serverPort: number;
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return uint8ToBase64(bytes);
}

export function createStreamEncryption(): StreamKeys {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  return {
    key: uint8ToBase64(key),
    iv: uint8ToBase64(iv),
  };
}

export async function publishStreamKeys(params: PublishStreamKeysParams) {
  const { location, streamKeys, groupId, publicKeys, isAdmins } = params;

  const payload = {
    key: streamKeys.key,
    iv: streamKeys.iv,
  };
  const serialized = JSON.stringify(payload);
  const data64 = utf8ToBase64(serialized);

  let encryptedData: string;
  if (groupId != null) {
    encryptedData = await qortalRequest({
      action: 'ENCRYPT_QORTAL_GROUP_DATA',
      base64: data64,
      groupId,
      isAdmins,
    });
  } else if (publicKeys && publicKeys.length > 0) {
    encryptedData = await qortalRequest({
      action: 'ENCRYPT_DATA',
      base64: data64,
      publicKeys,
    });
  } else {
    throw new Error('Provide groupId or publicKeys to encrypt stream keys.');
  }

  return qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: location.service,
    name: location.name,
    identifier: location.identifier,
    data64: encryptedData,
  });
}

export async function publishStreamableResource(params: PublishEncryptedStreamResourceParams) {
  const { location, file, filename, iv, key } = params;
  return qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: location.service,
    name: location.name,
    identifier: location.identifier,
    filename,
    file,
    encryption: {
      encryptionType: 'streamed-v1',
      iv,
      key,
    },
  });
}

export async function fetchStreamKeys(params: FetchStreamKeysParams): Promise<StreamKeys> {
  const { location, groupId, isAdmins } = params;
  const url = `/arbitrary/${location.service}/${location.name}/${location.identifier}?encoding=base64&rebuild=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch keys: ${res.status}`);
  }
  const encryptedData = await res.text();

  let decryptedBase64: string;
  if (groupId != null) {
    decryptedBase64 = await qortalRequest({
      action: 'DECRYPT_QORTAL_GROUP_DATA',
      base64: encryptedData,
      groupId,
      isAdmins,
    });
  } else {
    decryptedBase64 = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData,
    });
  }

  const decoded = base64ToUtf8(decryptedBase64);
  const parsed = JSON.parse(decoded);

  if (!parsed?.key || !parsed?.iv) {
    throw new Error('Decrypted keys missing key or iv.');
  }

  return {
    key: parsed.key,
    iv: parsed.iv,
  };
}

export async function playStream(params: PlayStreamParams): Promise<PlayStreamResult> {
  return qortalRequest({
    action: 'PLAY_ENCRYPTED_MEDIA',
    mediaId: params.mediaId,
    key: params.key,
    iv: params.iv,
    location: params.location,
  });
}
