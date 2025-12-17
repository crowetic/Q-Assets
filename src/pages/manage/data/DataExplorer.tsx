import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  Checkbox,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import AudiotrackRoundedIcon from '@mui/icons-material/AudiotrackRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import PublishRoundedIcon from '@mui/icons-material/PublishRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useAccountNames } from '../../../hooks/useAccountNames';
import { useQdnResources, type QdnResource } from '../../../hooks/useQdnResources';
import {
  fileToBase64,
  objectToBase64,
  base64ToUtf8,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from '../../../utils/data';
import { uniqueId6 } from '../../../utils/ids';
import { stripPrivateMagic, PRIVATE_MAGIC_B64 } from '../../../constants/qdeckIdentifiers';
import { collectRecipientPublicKeys } from '../../../utils/qdeckAccess';
import { getAccountGroups, type GroupSummary } from '../../../utils/qortalApi';
import { useAuth, VideoPlayer } from 'qapp-core';
import type { Service } from 'qapp-core';
import {
  MANIFEST_IDENTIFIER,
  ALL_QDN_SERVICES,
  SERVICE_PAGE_SIZE,
  FOLDER_PAGE_SIZE,
} from './constants';
import { buildQassetsFileIdentifier, QASSETS_FILE_ID_MAX } from '../../../constants/qdnConstants';
import {
  serviceLabels,
  ensurePrivateService,
  ensurePublicService,
  resolveServiceForEncryptionMode,
  formatBytes,
  formatDate,
  getResourceLabel,
  getResourceStatus,
  getDisplayTags,
  getResourceCreatedAt,
  getResourceUpdatedAt,
} from './viewHelpers';
import { shouldUseLegacyPrivateMagic } from '../../../utils/groupEncryption';
import { filterUserTags } from '../../../utils/qdnTags';
import {
  buildEncryptionTagSet,
  getEncryptionInfo,
  resourceIsPrivate,
} from '../../../utils/qdnEncryption';
import {
  MAX_INLINE_FILE_SIZE,
  DEFAULT_CHUNK_SIZE,
  iterateFileChunks,
  buildChunkIdentifier,
  createChunkedManifest,
  FileChunkDescriptor,
  ChunkedFileManifest,
  CHUNK_FORCED_THRESHOLD,
} from '../../../utils/fileChunking';
import type {
  FolderDescriptor,
  FolderNode,
  ManifestDoc,
  ServiceBucket,
  StructuredEntry,
} from './DataExplorer.types';
import { ExplorerHeader } from './components/ExplorerHeader';
import { ExplorerSidebar } from './components/ExplorerSidebar';
import { CreateFolderDialog } from './components/CreateFolderDialog';
import { MoveToNewFolderDialog } from './components/MoveToNewFolderDialog';
import { EditManifestDialog } from './components/EditManifestDialog';
import { sendNotification } from '../../../notifications/notificationService';
import type { NotificationRecipient } from '../../../utils/notificationRecipients';
import {
  useQdnBatchPublisher,
  type BatchPublishResource,
} from '../../../utils/useQdnBatchPublisher';
import { PublishDialog, PublishFormState, PublishSubmitPayload } from './components/PublishDialog';

type PreviewStepKey = 'fetch' | 'decrypt' | 'analyze';
type PreviewStepStatus = 'pending' | 'active' | 'success' | 'error';
type PreviewStep = {
  key: PreviewStepKey;
  label: string;
  status: PreviewStepStatus;
  message?: string;
};

type PreviewDialogState = {
  open: boolean;
  title?: string;
  content?: string;
  dataUrl?: string;
  type?: 'text' | 'binary' | 'image' | 'video';
  error?: string;
  loading?: boolean;
  steps: PreviewStep[];
  resource?: QdnResource | null;
  zoomed?: boolean;
  expanded?: boolean;
  videoUrl?: string;
  chunked?: boolean;
};

const PREVIEW_STEPS: PreviewStep[] = [
  { key: 'fetch', label: 'Fetch resource data', status: 'pending' },
  { key: 'decrypt', label: 'Decrypt private data', status: 'pending' },
  { key: 'analyze', label: 'Analyze preview content', status: 'pending' },
];

const clonePreviewSteps = (): PreviewStep[] => PREVIEW_STEPS.map((step) => ({ ...step }));
const createPreviewDialogState = (): PreviewDialogState => ({
  open: false,
  steps: clonePreviewSteps(),
  resource: null,
  zoomed: false,
  expanded: false,
  loading: false,
  videoUrl: undefined,
  chunked: false,
});

const PUBLISH_MODE_STORAGE_KEY = 'qassets_publish_mode_preference_v1';
type ManifestLoadState = 'idle' | 'loading' | 'success' | 'missing';

const SERVICE_OPTIONS = ALL_QDN_SERVICES;
const PENDING_FOLDERS_KEY = 'qassets_data_pending_folders_v1';
const PUBLISH_CHUNK_SIZE = 25;
const MANIFEST_REFRESH_COOLDOWN = 90 * 1000;
const MAX_FILE_IDENTIFIER_LENGTH = QASSETS_FILE_ID_MAX;
const CHUNK_METADATA_TAG = 'qassets-chunk';
const MANIFEST_SERVICE = ensurePrivateService('DOCUMENT_PRIVATE');
type ResourceSort =
  | 'name-asc'
  | 'name-desc'
  | 'created-desc'
  | 'created-asc'
  | 'updated-desc'
  | 'updated-asc';
const RESOURCE_SORT_OPTIONS: { value: ResourceSort; label: string }[] = [
  { value: 'updated-desc', label: 'Updated (newest first)' },
  { value: 'updated-asc', label: 'Updated (oldest first)' },
  { value: 'created-desc', label: 'Created (newest first)' },
  { value: 'created-asc', label: 'Created (oldest first)' },
  { value: 'name-asc', label: 'Name (A to Z)' },
  { value: 'name-desc', label: 'Name (Z to A)' },
];
const getResourceSortKey = (resource: QdnResource, sort: ResourceSort) => {
  if (sort.startsWith('updated')) {
    return getResourceUpdatedAt(resource) || getResourceCreatedAt(resource) || 0;
  }
  return getResourceCreatedAt(resource) || 0;
};
const compareResourcesBySort = (a: QdnResource, b: QdnResource, sort: ResourceSort) => {
  if (sort.startsWith('name')) {
    const aName = getResourceLabel(a).toLowerCase();
    const bName = getResourceLabel(b).toLowerCase();
    const result = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    return sort === 'name-desc' ? -result : result;
  }
  const diff = getResourceSortKey(b, sort) - getResourceSortKey(a, sort);
  const isAsc = sort.endsWith('asc');
  return isAsc ? -diff : diff;
};
const compareEntriesBySort = (a: StructuredEntry, b: StructuredEntry, sort: ResourceSort) => {
  if (sort.startsWith('name')) {
    const result = a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' });
    return sort === 'name-desc' ? -result : result;
  }
  const diff = getResourceSortKey(b.resource, sort) - getResourceSortKey(a.resource, sort);
  const isAsc = sort.endsWith('asc');
  return isAsc ? -diff : diff;
};
const createPublishDefaults = (folderPath: string, structured: boolean): PublishFormState => ({
  service: 'DOCUMENT' as Service,
  identifier: '',
  folderPath,
  title: '',
  description: '',
  structured,
});

const isProbablyText = (text: string) => {
  if (!text) return false;
  let printable = 0;
  for (let i = 0; i < Math.min(text.length, 1024); i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
      printable += 1;
    }
  }
  return printable / Math.min(text.length, 1024) > 0.85;
};

const extensionMimeHints: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  pdf: 'application/pdf',
};

const guessMimeTypeForResource = (resource: QdnResource) => {
  const meta = (resource.metadata || {}) as any;
  if (typeof meta?.mimeType === 'string') return meta.mimeType;
  if (typeof meta?.contentType === 'string') return meta.contentType;
  const service = (resource.service || '').toUpperCase();
  if (service.includes('IMAGE')) return 'image/png';
  if (service.includes('THUMBNAIL')) return 'image/png';
  if (service.includes('SVG')) return 'image/svg+xml';
  if (service.includes('VIDEO')) return 'video/mp4';
  if (service.includes('AUDIO') || service.includes('VOICE')) return 'audio/mpeg';
  if (service.includes('JSON')) return 'application/json';
  if (service.includes('DOCUMENT') || service.includes('BLOG') || service.includes('TEXT'))
    return 'text/plain';
  if (service.includes('HTML') || service.includes('WEBSITE')) return 'text/html';
  const identifier = typeof resource.identifier === 'string' ? resource.identifier : '';
  const ext = (identifier.split('.').pop() || '').toLowerCase();
  if (ext && extensionMimeHints[ext]) return extensionMimeHints[ext];
  return 'application/octet-stream';
};

const getMetadataTags = (metadata: Record<string, any> | undefined) => {
  if (!metadata) return [] as string[];
  const tags = (metadata as any).tags;
  return Array.isArray(tags) ? tags : [];
};

const isShareResource = (resource: QdnResource) => {
  const tags = getMetadataTags(resource.metadata as Record<string, any>);
  return tags.some(
    (tag) => typeof tag === 'string' && (tag === 'qassets-share' || tag.startsWith('share:'))
  );
};

const isTombstoneResource = (resource: QdnResource): boolean => {
  const metadata = resource.metadata || {};
  const tags = getMetadataTags(metadata);
  if ((metadata as any).qassetsTombstone?.deleted) return true;
  if ((metadata as any).qassets?.tombstone) return true;
  const title = (metadata as any).title;
  if (typeof title === 'string' && title.toUpperCase() === 'TOMBSTONE') return true;
  const description = (metadata as any).description;
  if (
    typeof description === 'string' &&
    description.toLowerCase().includes('resource removed by publisher')
  )
    return true;
  if (tags.some((tag) => typeof tag === 'string' && tag.toLowerCase() === 'qassets-tombstone'))
    return true;
  return false;
};

const decodeBase64Sample = (base64: string, approxBytes = 512): Uint8Array | null => {
  if (!base64) return null;
  try {
    const charsNeeded = Math.min(base64.length, Math.ceil((approxBytes / 3) * 4));
    const normalizedLength = Math.max(4, charsNeeded - (charsNeeded % 4));
    const chunk = base64.slice(0, Math.min(normalizedLength, base64.length));
    const binary = atob(chunk);
    const len = Math.min(binary.length, approxBytes);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
};

const asciiPrefixMatches = (bytes: Uint8Array, prefix: string) => {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
};

const detectMimeFromBase64 = (base64: string, fallback: string) => {
  const bytes = decodeBase64Sample(base64, 768);
  if (!bytes || !bytes.length) return fallback;

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  )
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (asciiPrefixMatches(bytes, 'GIF8')) return 'image/gif';
  if (
    asciiPrefixMatches(bytes, 'RIFF') &&
    bytes.length >= 12 &&
    asciiPrefixMatches(bytes.subarray(8, 12), 'WEBP')
  )
    return 'image/webp';
  if (asciiPrefixMatches(bytes, 'PK\x03\x04')) return 'application/zip';
  if (asciiPrefixMatches(bytes, '%PDF')) return 'application/pdf';
  if (asciiPrefixMatches(bytes, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
    return 'audio/mpeg';
  if (asciiPrefixMatches(bytes, 'OggS')) return 'audio/ogg';
  if (asciiPrefixMatches(bytes, 'ftyp')) return 'video/mp4';

  try {
    const textSnippet = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const trimmed = textSnippet.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'application/json';
    if (trimmed.startsWith('<')) return 'text/html';
    if (isProbablyText(textSnippet)) return 'text/plain';
  } catch {
    // ignore decoding errors
  }

  return fallback;
};

const hasPrivateMagicPrefix = (base64: string) => base64.startsWith(PRIVATE_MAGIC_B64);

type EncryptionMode = 'group' | 'direct' | null | undefined;

const usesLegacyPrivateMagic = (service?: string, mode?: EncryptionMode) =>
  shouldUseLegacyPrivateMagic(service, mode === 'group' ? 'group' : null);

const applyPrivateMagicIfNeeded = (_base64: string) => _base64;

const stripPrivateMagicIfNeeded = (base64: string, service?: string, mode?: EncryptionMode) => {
  if (!usesLegacyPrivateMagic(service, mode)) return base64;
  return hasPrivateMagicPrefix(base64) ? stripPrivateMagic(base64) : base64;
};

const resolveMimeForResource = (
  resource: QdnResource,
  manifestDoc: ManifestDoc | null,
  detected: Record<string, string>
) =>
  detected[resource.identifier] ||
  manifestDoc?.resourceTypes?.[resource.identifier] ||
  guessMimeTypeForResource(resource);

const getIconForMime = (mime: string) => {
  if (mime.startsWith('image/')) return <ImageRoundedIcon color="primary" fontSize="large" />;
  if (mime.startsWith('audio/'))
    return <AudiotrackRoundedIcon color="secondary" fontSize="large" />;
  if (mime.startsWith('video/'))
    return <MovieRoundedIcon sx={{ color: 'warning.main' }} fontSize="large" />;
  if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript'))
    return <CodeRoundedIcon sx={{ color: 'info.main' }} fontSize="large" />;
  if (mime.includes('text')) return <ArticleRoundedIcon color="action" fontSize="large" />;
  if (mime.includes('pdf'))
    return <DescriptionRoundedIcon sx={{ color: 'error.main' }} fontSize="large" />;
  return <InsertDriveFileRoundedIcon color="disabled" fontSize="large" />;
};

const hydrateManifestResources = (doc: ManifestDoc | null): QdnResource[] => {
  if (!doc?.resources || !Array.isArray(doc.resources)) return [];
  return doc.resources.map((item) => ({
    identifier: item.identifier,
    service: item.service,
    name: item.name,
    created: item.created,
    size: item.size,
    metadata: item.metadata || {},
    status: item.status,
  }));
};

type GroupDecryptAttempt = {
  groupId: number;
  isAdmins: boolean;
};

const buildGroupDecryptAttempts = (
  groups: GroupSummary[],
  priority?: { groupId?: number | null; adminBias?: boolean | null }
): GroupDecryptAttempt[] => {
  const attempts: GroupDecryptAttempt[] = [];
  const seen = new Set<string>();
  const pushAttempt = (groupId?: number | null, isAdmins = false) => {
    if (!groupId || !Number.isFinite(groupId)) return;
    const key = `${groupId}:${isAdmins ? 1 : 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ groupId, isAdmins });
  };

  if (priority?.groupId) {
    pushAttempt(priority.groupId, !!priority.adminBias);
    pushAttempt(priority.groupId, false);
    pushAttempt(priority.groupId, true);
  }

  groups.forEach((grp) => {
    pushAttempt(grp.groupId, false);
    pushAttempt(grp.groupId, true);
  });

  return attempts;
};

const tryGroupDecryptSequence = async (
  payload: string,
  attempts: GroupDecryptAttempt[]
): Promise<string | null> => {
  for (const attempt of attempts) {
    try {
      const clear = await qortalRequest({
        action: 'DECRYPT_QORTAL_GROUP_DATA',
        base64: payload,
        groupId: attempt.groupId,
        isAdmins: attempt.isAdmins,
      });
      if (clear) return clear;
    } catch {
      // continue trying other combos
    }
  }
  return null;
};

type LoadedResourceContent = {
  key: string;
  base64: string;
  mime: string;
  chunkedManifest?: ChunkedFileManifest;
};

const normalizeData64 = (payload: any): string | null => {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload.data64 === 'string') return payload.data64;
  if (typeof payload.base64 === 'string') return payload.base64;
  return null;
};

async function fetchResourceBase64(resource: QdnResource) {
  const res = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    service: resource.service as any,
    identifier: resource.identifier,
    name: resource.name,
    encoding: 'base64',
  });
  const data64 = normalizeData64(res);
  if (!data64) throw new Error('Unable to fetch resource data.');
  return data64;
}

async function fetchPrivateBase64(resource: QdnResource): Promise<string> {
  const res = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    name: resource.name,
    service: resource.service as any,
    identifier: resource.identifier,
    encoding: 'base64',
  });
  const data64 = normalizeData64(res);
  if (!data64) throw new Error('Unable to load encrypted resource.');
  return data64;
}

async function decryptPrivateBase64(
  resource: QdnResource,
  encryptedWithMagic: string,
  groups: GroupSummary[]
): Promise<string> {
  const info = getEncryptionInfo(resource);
  const mode = info.mode;
  const groupId = info.groupId ?? null;
  const adminsOnly = !!info.adminsOnly;

  const encryptedPayload = stripPrivateMagicIfNeeded(encryptedWithMagic, resource.service, mode);

  // Always try direct decrypt first (covers NODE-inserted metadata-less items)
  try {
    const direct = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: encryptedPayload,
    });
    if (direct) return direct;
  } catch {
    // ignore; fall through
  }

  if (mode === 'group') {
    if (groupId) {
      const preferredAttempts = buildGroupDecryptAttempts(groups, {
        groupId,
        adminBias: adminsOnly,
      });
      const clear = await tryGroupDecryptSequence(encryptedPayload, preferredAttempts);
      if (clear) return clear;
    }
  }

  if (mode === 'direct') {
    const clear = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: encryptedPayload,
    });
    if (!clear) throw new Error('Unable to decrypt direct resource.');
    return clear;
  }

  const fallbackAttempts = buildGroupDecryptAttempts(groups);
  const fallbackClear = await tryGroupDecryptSequence(encryptedPayload, fallbackAttempts);
  if (fallbackClear) return fallbackClear;

  throw new Error('Unable to decrypt this resource with your current keys.');
}

const sanitizeIdentifier = (value: string) => {
  if (!value) return '';
  return value
    .replace(/[^a-z0-9\-_.]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .toLowerCase();
};

const parseRecipientList = (value: string) =>
  value
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean);

const normalizePathSegments = (input?: string) => {
  if (!input) return [] as string[];
  return input
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean);
};

const inferStructuredMeta = (resource: QdnResource): StructuredEntry | null => {
  const md = resource.metadata || {};
  const tags: string[] = Array.isArray((md as any).tags) ? (md as any).tags : [];

  let folderSegments: string[] | null = null;
  let fileName: string | null = null;

  if (tags.some((tag) => tag === 'qassets-fs')) {
    const pathTag = tags.find((tag) => tag.startsWith('fs-path:'));
    const nameTag = tags.find((tag) => tag.startsWith('fs-name:'));
    folderSegments = normalizePathSegments(pathTag?.slice('fs-path:'.length));
    fileName = nameTag?.slice('fs-name:'.length) || null;
  }

  if (!folderSegments) {
    const fsMeta = (md as any).qassetsFs || (md as any).qassetsExplorer || (md as any).qassetsFile;
    if (fsMeta) {
      folderSegments = normalizePathSegments(fsMeta.path || fsMeta.folderPath || '');
      fileName = fsMeta.fileName || null;
    }
  }

  if (!folderSegments) return null;

  const fallbackName =
    fileName || resource.metadata?.title || resource.identifier || `resource-${uniqueId6()}`;

  return {
    resource,
    folderSegments,
    fileName: fallbackName,
    isPrivate: resourceIsPrivate(resource),
  };
};

const stripStructuredMetadata = (
  resource: QdnResource
): { metadata: Record<string, any>; tags: string[] } => {
  const metadata = { ...(resource.metadata || {}) };
  const filteredTags = filterUserTags((metadata as any).tags);
  if (filteredTags.length) (metadata as any).tags = filteredTags;
  else delete (metadata as any).tags;
  delete (metadata as any).qassetsFs;
  delete (metadata as any).qassetsExplorer;
  delete (metadata as any).qassetsFile;
  return { metadata, tags: filteredTags };
};

const inferFolderDescriptor = (resource: QdnResource): FolderDescriptor | null => {
  const md = resource.metadata || {};
  const folderMeta = (md as any).qassetsFsFolder;
  if (folderMeta) {
    const segments = normalizePathSegments(
      folderMeta.path || folderMeta.folderPath || folderMeta.name || ''
    );
    const name =
      folderMeta.name ||
      segments[segments.length - 1] ||
      resource.metadata?.title ||
      resource.identifier;
    return { segments, name, resource };
  }
  const tags: string[] = Array.isArray((md as any).tags) ? (md as any).tags : [];
  const folderTag = tags.find((tag) => tag.startsWith('fs-folder:'));
  if (folderTag) {
    const path = folderTag.slice('fs-folder:'.length);
    const segments = normalizePathSegments(path);
    return {
      segments,
      name: segments[segments.length - 1] || 'Folder',
      resource,
    };
  }
  return null;
};

const dedupeFolderDescriptors = (descriptors: FolderDescriptor[]): FolderDescriptor[] => {
  const seen = new Set<string>();
  const result: FolderDescriptor[] = [];
  descriptors.forEach((desc) => {
    const key = desc.segments.join('/');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(desc);
  });
  return result;
};

const matchesSearch = (resource: QdnResource, query: string) => {
  if (!query) return true;
  const lower = query.toLowerCase();
  const identifier =
    typeof resource.identifier === 'string' ? resource.identifier.toLowerCase() : '';
  const title =
    typeof resource.metadata?.title === 'string' ? resource.metadata.title.toLowerCase() : '';
  const desc =
    typeof resource.metadata?.description === 'string'
      ? resource.metadata.description.toLowerCase()
      : '';
  const service = typeof resource.service === 'string' ? resource.service.toLowerCase() : '';
  return (
    identifier.includes(lower) ||
    service.includes(lower) ||
    title.includes(lower) ||
    desc.includes(lower)
  );
};

const buildFolderMap = (
  entries: StructuredEntry[],
  folders: FolderDescriptor[] = []
): Map<string, FolderNode> => {
  const map = new Map<string, FolderNode>();

  const ensureFolder = (segments: string[]): FolderNode => {
    const key = segments.join('/');
    if (map.has(key)) return map.get(key)!;

    const parentSegments = segments.slice(0, -1);
    const parentKey = parentSegments.join('/');
    const node: FolderNode = {
      key,
      name: segments[segments.length - 1] || '/',
      parentKey: segments.length ? parentKey : null,
      childKeys: [],
      files: [],
    };
    map.set(key, node);

    if (segments.length) {
      const parent = ensureFolder(parentSegments);
      if (!parent.childKeys.includes(key)) parent.childKeys.push(key);
    }
    return node;
  };

  // ensure root
  ensureFolder([]);

  entries.forEach((entry) => {
    const folderNode = ensureFolder(entry.folderSegments);
    folderNode.files.push(entry);
  });

  folders.forEach((folder) => {
    const node = ensureFolder(folder.segments);
    if (folder.name) node.name = folder.name;
    if (!node.resource) node.resource = folder.resource;
  });

  return map;
};

const matchesFolderSegments = (segments: string[], prefix: string[]) => {
  if (!prefix.length) return segments.length === 0;
  if (segments.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (segments[i] !== prefix[i]) return false;
  }
  return true;
};

const useResolveResourceBase64 = (groups: GroupSummary[]) =>
  useCallback(
    async (
      resource: QdnResource,
      onStep?: (step: PreviewStepKey, status: PreviewStepStatus, message?: string) => void
    ): Promise<string> => {
      let base64: string | null = null;
      try {
        onStep?.('fetch', 'active');
        const encryptionInfo = getEncryptionInfo(resource);
        const treatAsEncrypted = encryptionInfo.mode !== null || encryptionInfo.isPrivate;
        if (treatAsEncrypted) {
          const encrypted = await fetchPrivateBase64(resource);
          onStep?.('fetch', 'success');
          onStep?.('decrypt', 'active');
          base64 = await decryptPrivateBase64(resource, encrypted, groups);
          onStep?.('decrypt', 'success');
        } else {
          base64 = await fetchResourceBase64(resource);
          onStep?.('fetch', 'success');
          onStep?.('decrypt', 'success');
        }
      } catch (e: any) {
        if (!base64) onStep?.('fetch', 'error', e?.message || 'Unable to fetch resource.');
        throw e;
      }
      if (!base64) throw new Error('Unable to load resource data.');
      return base64;
    },
    [groups]
  );

const normalizeSectionParam = (value?: string | null): 'services' | 'files' | 'shares' => {
  if (!value) return 'services';
  const lower = value.toLowerCase();
  return lower === 'files' || lower === 'shares' ? (lower as 'files' | 'shares') : 'services';
};

export default function DataExplorer() {
  const { address: userAddress, name: authName, authenticateUser } = useAuth();
  const {
    entries,
    loading: namesLoading,
    error: namesError,
    reload: reloadNames,
    primaryName,
    primaryNameError,
  } = useAccountNames();
  const orderedEntries = useMemo(() => {
    if (!primaryName || primaryNameError) return entries;
    const index = entries.findIndex((entry) => entry.name === primaryName);
    if (index <= 0) return entries;
    const rest = entries.filter((_entry, idx) => idx !== index);
    return [entries[index], ...rest];
  }, [entries, primaryName, primaryNameError]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsString = searchParams.toString();
  const sectionParamValue = searchParams.get('section') ?? '';
  const [activeSection, setActiveSectionState] = useState<'services' | 'files' | 'shares'>(() =>
    normalizeSectionParam(sectionParamValue)
  );
  useEffect(() => {
    const normalized = normalizeSectionParam(sectionParamValue);
    setActiveSectionState((prev) => (prev === normalized ? prev : normalized));
  }, [sectionParamValue]);
  const setActiveSection = useCallback(
    (nextSection: 'services' | 'files' | 'shares') => {
      setActiveSectionState(nextSection);
      const currentNormalized = normalizeSectionParam(sectionParamValue);
      if (currentNormalized === nextSection) return;
      const nextParams = new URLSearchParams(searchParamsString);
      if (nextSection === 'services') nextParams.delete('section');
      else nextParams.set('section', nextSection);
      setSearchParams(nextParams, { replace: true });
    },
    [sectionParamValue, searchParamsString, setSearchParams]
  );
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [publishAnchor, setPublishAnchor] = useState<null | HTMLElement>(null);
  const [publishMode, setPublishMode] = useState<'immediate' | 'batch'>(() => {
    if (typeof window === 'undefined') return 'immediate';
    const stored = window.localStorage.getItem(PUBLISH_MODE_STORAGE_KEY);
    return stored === 'batch' ? 'batch' : 'immediate';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PUBLISH_MODE_STORAGE_KEY, publishMode);
  }, [publishMode]);
  const [resourceSort, setResourceSort] = useState<ResourceSort>('updated-desc');
  const [publishDialog, setPublishDialog] = useState<{
    open: boolean;
    variant: 'single' | 'multiple';
    defaults: PublishFormState;
  }>({
    open: false,
    variant: 'single',
    defaults: createPublishDefaults('', true),
  });
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderSelection, setFolderSelection] = useState<
    Array<{ file: File; relativePath: string }>
  >([]);
  const [folderRootName, setFolderRootName] = useState('');
  const [folderTargetPath, setFolderTargetPath] = useState('');
  const [folderService, setFolderService] = useState<string>('DOCUMENT');
  const [folderPublishing, setFolderPublishing] = useState(false);
  const [folderStatus, setFolderStatus] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const resolvePublisherAddress = useCallback(async () => {
    if (userAddress) return userAddress;
    const acct = await qortalRequest({ action: 'GET_USER_ACCOUNT' });
    if (acct?.address) return acct.address;
    throw new Error('Unable to resolve your account address for encryption.');
  }, [userAddress]);
  const [servicePage, setServicePage] = useState(1);
  const [folderPage, setFolderPage] = useState(1);
  const [sharePage, setSharePage] = useState(1);
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState>(
    createPreviewDialogState()
  );
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewChunkedBlobUrlRef = useRef<string | null>(null);
  const chunkedMediaSourceRef = useRef<{ objectUrl: string; cancel: () => void } | null>(null);
  const setPreviewChunkedBlobUrl = useCallback((url?: string) => {
    if (previewChunkedBlobUrlRef.current && previewChunkedBlobUrlRef.current !== url) {
      URL.revokeObjectURL(previewChunkedBlobUrlRef.current);
    }
    previewChunkedBlobUrlRef.current = url ?? null;
  }, []);
  const cleanupChunkedBlobUrl = useCallback(() => {
    if (previewChunkedBlobUrlRef.current) {
      URL.revokeObjectURL(previewChunkedBlobUrlRef.current);
      previewChunkedBlobUrlRef.current = null;
    }
  }, []);
  const cleanupChunkedMediaSource = useCallback(() => {
    const entry = chunkedMediaSourceRef.current;
    chunkedMediaSourceRef.current = null;
    if (entry) {
      entry.cancel();
      URL.revokeObjectURL(entry.objectUrl);
    }
  }, []);
  const cleanupChunkedVideoPreview = useCallback(() => {
    cleanupChunkedMediaSource();
    cleanupChunkedBlobUrl();
  }, [cleanupChunkedBlobUrl, cleanupChunkedMediaSource]);
  const [manifestDialog, setManifestDialog] = useState<{
    open: boolean;
    entry: StructuredEntry | null;
    saving: boolean;
    error: string | null;
  }>({ open: false, entry: null, saving: false, error: null });
  const [shareDialog, setShareDialog] = useState<{ open: boolean; mode: 'group' | 'direct' }>({
    open: false,
    mode: 'group',
  });
  const [shareSelectedGroups, setShareSelectedGroups] = useState<number[]>([]);
  const [shareNames, setShareNames] = useState('');
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [systemSaveStatus, setSystemSaveStatus] = useState<string | null>(null);
  const [systemSaveLoading, setSystemSaveLoading] = useState(false);
  const [filesActionLoading, setFilesActionLoading] = useState<'remove' | 'delete' | null>(null);
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const userSelectedName = useRef(false);
  const pendingFoldersLoadedFor = useRef<string | null>(null);
  const handleSelectName = useCallback(
    (name: string) => {
      userSelectedName.current = true;
      setActiveName(name);
    },
    [setActiveName]
  );
  const [pendingMoves, setPendingMoves] = useState<
    Record<string, { path: string; fileName: string }>
  >({});
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [pendingPublishRequests, setPendingPublishRequests] = useState<BatchPublishResource[]>([]);
  const [renameFolderDialog, setRenameFolderDialog] = useState({
    open: false,
    newName: '',
    error: null as string | null,
  });
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  // const [publishQueue, setPublishQueue] = useState<PublishTask[]>([]);
  const { publish: publishResources } = useQdnBatchPublisher();
  const theme = useTheme();
  const breadcrumbColor = theme.palette.text.secondary;
  const shareColor = (theme.palette as any).link?.main || theme.palette.primary.main;
  const moveColor = theme.palette.warning.main;
  const [createFolderDialog, setCreateFolderDialog] = useState<{
    open: boolean;
    basePath: string;
    error: string | null;
  }>({ open: false, basePath: '', error: null });
  const loadPendingFolders = useCallback((name: string | null) => {
    if (!name || typeof window === 'undefined') return [];
    try {
      const raw = window.sessionStorage.getItem(PENDING_FOLDERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return [];
      const list = (parsed as Record<string, unknown>)[name];
      return Array.isArray(list)
        ? list.filter((path): path is string => typeof path === 'string')
        : [];
    } catch {
      return [];
    }
  }, []);
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [nameSearchLoading, setNameSearchLoading] = useState(false);
  const [nameSearchError, setNameSearchError] = useState<string | null>(null);
  const chunkResources = useCallback((resources: BatchPublishResource[]) => {
    const chunks: BatchPublishResource[][] = [];
    for (let i = 0; i < resources.length; i += PUBLISH_CHUNK_SIZE) {
      chunks.push(resources.slice(i, i + PUBLISH_CHUNK_SIZE));
    }
    return chunks;
  }, []);

  const queueOrPublishResources = useCallback(
    async (resources: BatchPublishResource[]) => {
      if (!resources.length) return;
      if (publishMode === 'immediate') {
        const chunks = chunkResources(resources);
        for (const chunk of chunks) {
          await publishResources(chunk);
        }
        return;
      }
      setPendingPublishRequests((prev) => prev.concat(resources));
    },
    [publishMode, publishResources, chunkResources]
  );
  const flushPendingPublishRequests = useCallback(async () => {
    if (!pendingPublishRequests.length) return;
    const requests = [...pendingPublishRequests];
    setPendingPublishRequests([]);
    const chunks = chunkResources(requests);
    for (const chunk of chunks) {
      await publishResources(chunk);
    }
  }, [pendingPublishRequests, publishResources, chunkResources]);
  useEffect(() => {
    if (publishMode === 'immediate' && pendingPublishRequests.length) {
      flushPendingPublishRequests().catch((err) =>
        console.warn('Failed to flush queued resources on mode switch', err)
      );
    }
  }, [publishMode, pendingPublishRequests.length, flushPendingPublishRequests]);
  const [manifestDoc, setManifestDoc] = useState<ManifestDoc | null>(null);
  const [manifestDirty, setManifestDirty] = useState(false);
  const [manifestPublishing, setManifestPublishing] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const hasQueuedChanges = useMemo(
    () => manifestDirty || pendingPublishRequests.length > 0,
    [manifestDirty, pendingPublishRequests.length]
  );
  const [manifestRefreshBlockedUntil, setManifestRefreshBlockedUntil] = useState(0);
  const [manifestLoadState, setManifestLoadState] = useState<ManifestLoadState>('idle');
  const [ignoreManifestCache, setIgnoreManifestCache] = useState(false);
  const [loadingAllPages, setLoadingAllPages] = useState(false);
  const [detectedTypes, setDetectedTypes] = useState<Record<string, string>>({});
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [loadedContent, setLoadedContent] = useState<LoadedResourceContent | null>(null);
  const [saveToFilesDialog, setSaveToFilesDialog] = useState<{
    open: boolean;
    folderPath: string;
    fileName: string;
    description: string;
    saving: boolean;
    error: string | null;
    resources: QdnResource[];
  }>({
    open: false,
    folderPath: '',
    fileName: '',
    description: '',
    saving: false,
    error: null,
    resources: [],
  });
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean;
    folderPath: string;
    saving: boolean;
    error: string | null;
    entries: StructuredEntry[];
  }>({ open: false, folderPath: '', saving: false, error: null, entries: [] });
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [shareTargets, setShareTargets] = useState<QdnResource[]>([]);
  const resolveResourceBase64 = useResolveResourceBase64(groups);
  const ensureResourceContent = useCallback(
    async (
      resource: QdnResource,
      options?: {
        onStep?: (step: PreviewStepKey, status: PreviewStepStatus, message?: string) => void;
        skipCache?: boolean;
      }
    ) => {
      if (!options?.skipCache && loadedContent && loadedContent.key === resource.identifier) {
        options?.onStep?.('analyze', 'success');
        return loadedContent;
      }
      const base64 = await resolveResourceBase64(resource, options?.onStep);
      options?.onStep?.('analyze', 'active');
      const fallbackMime = guessMimeTypeForResource(resource);
      const inferredMime = detectMimeFromBase64(base64, fallbackMime);
      options?.onStep?.('analyze', 'success');
      const entry: LoadedResourceContent = {
        key: resource.identifier,
        base64,
        mime: inferredMime,
      };
      if ((resource.metadata?.qassetsFs as any)?.chunked) {
        try {
          const manifest = JSON.parse(base64ToUtf8(base64)) as ChunkedFileManifest;
          if (manifest && Array.isArray(manifest.chunks)) {
            entry.chunkedManifest = manifest;
            if (manifest.mimeType) {
              entry.mime = manifest.mimeType;
            }
          }
        } catch {
          // ignore malformed chunk manifest
        }
      }
      setLoadedContent(entry);
      setDetectedTypes((prev) =>
        prev[resource.identifier] === inferredMime
          ? prev
          : { ...prev, [resource.identifier]: inferredMime }
      );
      return entry;
    },
    [loadedContent, resolveResourceBase64]
  );

  const republishWithMetadata = useCallback(
    async (params: {
      resource: QdnResource;
      base64: string;
      metadata: Record<string, any>;
      tags?: string[];
    }) => {
      const { resource, base64, metadata, tags } = params;
      await queueOrPublishResources([
        {
          name: resource.name,
          service: resource.service as Service,
          identifier: resource.identifier,
          base64,
          metadata,
          tags,
          title: resource.metadata?.title,
          description: resource.metadata?.description,
        },
      ]);
    },
    [queueOrPublishResources]
  );

  const handleFolderDialogOpen = () => {
    if (!activeName) {
      alert('Select or register a Qortal name before publishing.');
      return;
    }
    setFolderDialogOpen(true);
    setFolderTargetPath(activeSection === 'files' ? activeFilePath : '');
    setFolderStatus(null);
  };

  const handleFolderDialogClose = () => {
    if (folderPublishing) return;
    setFolderDialogOpen(false);
    setFolderSelection([]);
    setFolderRootName('');
    setFolderTargetPath('');
    setFolderStatus(null);
  };

  const openSaveDialogForResources = (resources: QdnResource[]) => {
    if (!resources.length) return;
    if (!activeName) {
      alert('Select or register a Qortal name before saving to files.');
      return;
    }
    const first = resources[0];
    const firstEntry = allStructuredEntryMap.get(first.identifier);
    const defaultFolder = firstEntry
      ? firstEntry.folderSegments.join('/')
      : activeSection === 'files'
        ? activeFilePath
        : '';
    const defaultName =
      resources.length === 1
        ? firstEntry?.fileName || first.metadata?.title || first.identifier
        : `${resources.length} files`;
    setSaveToFilesDialog({
      open: true,
      folderPath: defaultFolder,
      fileName: defaultName,
      description: first.metadata?.description || '',
      saving: false,
      error: null,
      resources,
    });
  };

  const openMoveDialogForEntries = (entries: StructuredEntry[]) => {
    if (!entries.length) {
      alert('Select structured files to move.');
      return;
    }
    const uniformFolder = entries.every(
      (entry) => entry.folderSegments.join('/') === entries[0].folderSegments.join('/')
    )
      ? entries[0].folderSegments.join('/')
      : '';
    setMoveDialog({
      open: true,
      folderPath: uniformFolder,
      saving: false,
      error: null,
      entries,
    });
  };

  const handleCreateFolderOpen = () => {
    if (!activeName) {
      alert('Select or register a Qortal name before managing folders.');
      return;
    }
    setCreateFolderDialog({
      open: true,
      basePath: activeSection === 'files' ? activeFilePath : '',
      error: null,
    });
  };

  const handleCreateFolderClose = () => {
    setCreateFolderDialog({ open: false, basePath: '', error: null });
  };

  const handleCreateFolderSubmit = (folderName: string) => {
    const name = folderName.trim();
    if (!name) {
      setCreateFolderDialog((prev) => ({ ...prev, error: 'Enter a folder name.' }));
      return;
    }
    if (name.includes('/')) {
      setCreateFolderDialog((prev) => ({
        ...prev,
        error: 'Create one folder at a time (no slashes).',
      }));
      return;
    }
    const base = normalizePathSegments(createFolderDialog.basePath).join('/');
    const nextSegments = base ? base.split('/') : [];
    nextSegments.push(name);
    const targetPath = nextSegments.join('/');
    if (knownFolderPaths.has(targetPath)) {
      setCreateFolderDialog((prev) => ({ ...prev, error: 'Folder already exists.' }));
      return;
    }
    const updater = (prev: string[]) =>
      prev.includes(targetPath) ? prev : prev.concat(targetPath);
    setPendingFolders(updater);
    setCreateFolderDialog({ open: false, basePath: '', error: null });
    setActiveSection('files');
    if (base) setActiveFilePath(base);
    if (publishMode === 'immediate') {
      void handlePublishManifest({ folders: [{ path: targetPath, name }] });
    } else {
      setManifestDirty(true);
    }
  };

  const handleSaveToFilesOpen = () => {
    if (!selectedResource) return;
    openSaveDialogForResources([selectedResource]);
  };

  const handleSaveToFilesClose = () => {
    if (saveToFilesDialog.saving) return;
    setSaveToFilesDialog({
      open: false,
      folderPath: '',
      fileName: '',
      description: '',
      saving: false,
      error: null,
      resources: [],
    });
  };

  useEffect(() => {
    (async () => {
      try {
        await authenticateUser();
      } catch {
        // ignore; publish/share features will prompt later if needed
      }
    })();
  }, [authenticateUser]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !activeName ||
      pendingFoldersLoadedFor.current !== activeName
    )
      return;
    try {
      const raw = window.sessionStorage.getItem(PENDING_FOLDERS_KEY);
      const parsed = raw && typeof raw === 'string' ? JSON.parse(raw) : {};
      const store = parsed && typeof parsed === 'object' ? parsed : {};
      store[activeName] = pendingFolders;
      window.sessionStorage.setItem(PENDING_FOLDERS_KEY, JSON.stringify(store));
    } catch {
      // ignore
    }
  }, [pendingFolders, activeName]);

  const applyManifestState = useCallback(
    (doc: ManifestDoc | null, dirty: boolean, loadState?: ManifestLoadState) => {
      setManifestDoc(doc);
      setDetectedTypes(doc?.resourceTypes || {});
      setManifestDirty(dirty);
      if (loadState) setManifestLoadState(loadState);
    },
    []
  );

  const fetchManifestDoc = useCallback(async (): Promise<ManifestDoc | null> => {
    if (!activeName) return null;
    const fetchAndMaybeDecrypt = async (
      service: Service,
      decryptMode: 'direct' | null,
      fallbackToPlain = false
    ) => {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: activeName,
        service,
        identifier: MANIFEST_IDENTIFIER,
        encoding: 'base64',
      });
      const data64 = normalizeData64(res);
      if (!data64) return null;
      if (!decryptMode) return JSON.parse(base64ToUtf8(data64));
      const payload = stripPrivateMagicIfNeeded(data64, service, decryptMode);
      try {
        const clear = await qortalRequest({
          action: 'DECRYPT_DATA',
          encryptedData: payload,
        });
        if (!clear) throw new Error('Unable to decrypt manifest.');
        return JSON.parse(base64ToUtf8(clear));
      } catch (error) {
        if (fallbackToPlain) {
          try {
            return JSON.parse(base64ToUtf8(data64));
          } catch {
            throw error;
          }
        }
        throw error;
      }
    };
    try {
      return await fetchAndMaybeDecrypt(MANIFEST_SERVICE as Service, 'direct', true);
    } catch {
      try {
        return await fetchAndMaybeDecrypt(ensurePrivateService('DOCUMENT_PRIVATE'), 'direct', true);
      } catch {
        try {
          return await fetchAndMaybeDecrypt('DOCUMENT' as Service, null);
        } catch {
          return null;
        }
      }
    }
  }, [activeName]);

  const refreshManifestDoc = useCallback(async () => {
    if (!activeName) {
      applyManifestState(null, false, 'idle');
      return;
    }
    if (Date.now() < manifestRefreshBlockedUntil) return;
    setManifestLoadState('loading');
    try {
      const doc = await fetchManifestDoc();
      if (
        doc &&
        manifestDoc?.generatedAt &&
        doc.generatedAt &&
        doc.generatedAt <= manifestDoc.generatedAt
      ) {
        setManifestLoadState('success');
        return;
      }
      applyManifestState(doc, false, doc ? 'success' : 'missing');
    } catch {
      applyManifestState(null, true, 'missing');
    }
  }, [activeName, fetchManifestDoc, applyManifestState, manifestDoc, manifestRefreshBlockedUntil]);

  const clearQueuedChanges = useCallback(async () => {
    if (!hasQueuedChanges) return;
    setPendingPublishRequests([]);
    setManifestDirty(false);
    setManifestError(null);
    setSystemSaveStatus('Cleared queued changes.');
    await refreshManifestDoc();
  }, [hasQueuedChanges, refreshManifestDoc]);

  useEffect(() => {
    if (!activeName) {
      applyManifestState(null, false, 'idle');
      return;
    }
    let cancelled = false;
    setManifestLoadState('loading');
    (async () => {
      try {
        const doc = await fetchManifestDoc();
        if (!cancelled) applyManifestState(doc, false, doc ? 'success' : 'missing');
      } catch {
        if (!cancelled) applyManifestState(null, true, 'missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeName, fetchManifestDoc, applyManifestState]);

  useEffect(() => {
    if (!userAddress) return;
    setGroupsLoading(true);
    getAccountGroups(userAddress)
      .then((data) => setGroups(data))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, [userAddress]);

  useEffect(() => {
    if (userSelectedName.current) return;
    const defaultName = orderedEntries[0]?.name ?? null;
    if (!defaultName) return;
    setActiveName(defaultName);
  }, [orderedEntries, setActiveName]);

  useEffect(() => {
    if (!activeName) {
      setPendingFolders([]);
      setPendingMoves({});
      setPendingDeletes([]);
      pendingFoldersLoadedFor.current = null;
      setManifestRefreshBlockedUntil(0);
      return;
    }
    setPendingFolders(loadPendingFolders(activeName));
    setPendingMoves({});
    setPendingDeletes([]);
    pendingFoldersLoadedFor.current = activeName;
  }, [activeName, loadPendingFolders]);

  const {
    rows,
    loading: resourcesLoading,
    hasMore,
    loadAll,
    error: resourcesError,
    reload,
  } = useQdnResources(activeName);
  const refreshResources = useCallback(
    async (loadComplete = true) => {
      if (!activeName) return;
      setIgnoreManifestCache(true);
      await reload();
      if (loadComplete) {
        await loadAll();
      }
      await refreshManifestDoc();
    },
    [activeName, reload, loadAll, refreshManifestDoc]
  );

  const autoRefreshedNames = useRef(new Set<string>());
  useEffect(() => {
    if (!activeName) return;
    if (autoRefreshedNames.current.has(activeName)) return;
    autoRefreshedNames.current.add(activeName);
    void refreshResources();
  }, [activeName, refreshResources]);

  const manifestResourceRows = useMemo(
    () => hydrateManifestResources(manifestDoc).filter((res) => !isTombstoneResource(res)),
    [manifestDoc]
  );
  const manifestResourceIdentifiers = useMemo(() => {
    const set = new Set<string>();
    manifestResourceRows.forEach((resource) => {
      if (resource.identifier) set.add(resource.identifier);
    });
    return set;
  }, [manifestResourceRows]);
  const isNewResource = useCallback(
    (resource: QdnResource) => !manifestResourceIdentifiers.has(resource.identifier),
    [manifestResourceIdentifiers]
  );

  const combinedResources = useMemo(() => {
    const removalSet = new Set(pendingDeletes);
    const map = new Map<string, QdnResource>();
    manifestResourceRows.forEach((res) => {
      if (removalSet.has(res.identifier)) return;
      map.set(res.identifier, res);
    });
    rows.forEach((res) => {
      if (isTombstoneResource(res) || removalSet.has(res.identifier)) return;
      map.set(res.identifier, res);
    });
    return Array.from(map.values()).sort(
      (a, b) => (b.created ?? 0) - (a.created ?? 0) || a.identifier.localeCompare(b.identifier)
    );
  }, [manifestResourceRows, rows, pendingDeletes]);

  const manifestLastSynced = manifestDoc?.lastSynced ?? 0;
  const minRowCreated = useMemo(
    () =>
      rows.reduce((min, resource) => {
        const created = resource.created ?? Infinity;
        return created < min ? created : min;
      }, Infinity),
    [rows]
  );
  const manifestBoundaryReached =
    manifestLastSynced > 0 && minRowCreated !== Infinity && minRowCreated <= manifestLastSynced;
  const canLoadMore = hasMore && (!manifestBoundaryReached || ignoreManifestCache);

  const combinedResourceMap = useMemo(() => {
    const map = new Map<string, QdnResource>();
    combinedResources.forEach((res) => map.set(res.identifier, res));
    return map;
  }, [combinedResources]);

  const createChunkedBlobUrl = useCallback(
    async (manifest: ChunkedFileManifest) => {
      if (!manifest.chunks?.length) {
        throw new Error('Chunk manifest is empty.');
      }
      const buffers: Uint8Array[] = [];
      for (const chunk of manifest.chunks) {
        const chunkResource = combinedResourceMap.get(chunk.identifier);
        if (!chunkResource) {
          throw new Error(`Chunk ${chunk.identifier} is not available yet.`);
        }
        const chunkBase64 = await resolveResourceBase64(chunkResource);
        buffers.push(base64ToUint8Array(chunkBase64));
      }
      const blob = new Blob(buffers, {
        type: manifest.mimeType || 'application/octet-stream',
      });
      return URL.createObjectURL(blob);
    },
    [combinedResourceMap, resolveResourceBase64]
  );

  const streamChunkedVideo = useCallback(
    (manifest: ChunkedFileManifest) => {
      if (!manifest.chunks?.length) {
        throw new Error('Chunk manifest is empty.');
      }
      if (typeof window === 'undefined' || typeof MediaSource === 'undefined') {
        throw new Error('Chunk streaming is not supported in this environment.');
      }
      cleanupChunkedMediaSource();
      const mediaSource = new MediaSource();
      const objectUrl = URL.createObjectURL(mediaSource);
      const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);
      let resolved = false;
      let rejectStream: ((reason?: any) => void) | null = null;
      const promise = new Promise<void>((resolve, reject) => {
        rejectStream = reject;
        const handleSourceOpen = () => {
          mediaSource.removeEventListener('sourceopen', handleSourceOpen);
          let sourceBuffer: SourceBuffer;
          try {
            sourceBuffer = mediaSource.addSourceBuffer(manifest.mimeType || 'video/mp4');
          } catch (err) {
            reject(err);
            return;
          }
          let nextIndex = 0;
          const appendNextChunk = async () => {
            if (resolved) return;
            if (nextIndex >= sortedChunks.length) {
              resolved = true;
              if (mediaSource.readyState === 'open') {
                try {
                  mediaSource.endOfStream();
                } catch (e) {
                  console.log(e);
                }
              }
              resolve();
              return;
            }
            if (sourceBuffer.updating) {
              sourceBuffer.addEventListener('updateend', appendNextChunk, { once: true });
              return;
            }
            const chunkMeta = sortedChunks[nextIndex];
            const chunkResource = combinedResourceMap.get(chunkMeta.identifier);
            if (!chunkResource) {
              reject(new Error(`Chunk ${chunkMeta.identifier} is not available yet.`));
              return;
            }
            try {
              const chunkBase64 = await resolveResourceBase64(chunkResource);
              const chunkData = base64ToUint8Array(chunkBase64);
              sourceBuffer.appendBuffer(chunkData);
              nextIndex += 1;
              sourceBuffer.addEventListener('updateend', appendNextChunk, { once: true });
            } catch (err) {
              reject(err);
            }
          };
          appendNextChunk();
        };
        mediaSource.addEventListener('sourceopen', handleSourceOpen);
      });
      const cancel = () => {
        if (resolved) return;
        resolved = true;
        if (rejectStream) {
          rejectStream(new Error('Chunk streaming cancelled.'));
        }
        if (mediaSource.readyState === 'open') {
          try {
            mediaSource.endOfStream();
          } catch (e) {
            console.log(e);
          }
        }
      };
      chunkedMediaSourceRef.current = { objectUrl, cancel };
      return { objectUrl, promise };
    },
    [cleanupChunkedMediaSource, combinedResourceMap, resolveResourceBase64]
  );

  const resourceStructuredEntries = useMemo(
    () =>
      combinedResources
        .map((res) => inferStructuredMeta(res))
        .filter((entry): entry is StructuredEntry => Boolean(entry)),
    [combinedResources]
  );

  const manifestStructuredEntries = useMemo(() => {
    if (!manifestDoc?.structuredFiles) return [];
    return manifestDoc.structuredFiles
      .map((entry) => {
        const resource = combinedResourceMap.get(entry.identifier);
        if (!resource) return null;
        return {
          resource,
          folderSegments: normalizePathSegments(entry.path),
          fileName:
            entry.fileName ||
            resource.metadata?.title ||
            resource.identifier ||
            `resource-${uniqueId6()}`,
          isPrivate: resourceIsPrivate(resource),
        } as StructuredEntry;
      })
      .filter((entry): entry is StructuredEntry => Boolean(entry));
  }, [manifestDoc, combinedResourceMap]);

  const baseStructuredEntries = useMemo(() => {
    const map = new Map<string, StructuredEntry>();
    resourceStructuredEntries.forEach((entry) => map.set(entry.resource.identifier, entry));
    manifestStructuredEntries.forEach((entry) => map.set(entry.resource.identifier, entry));
    return Array.from(map.values()).sort((a, b) =>
      a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' })
    );
  }, [resourceStructuredEntries, manifestStructuredEntries]);

  const allStructuredEntries = useMemo(() => {
    if (!Object.keys(pendingMoves).length) return baseStructuredEntries;
    return baseStructuredEntries.map((entry) => {
      const override = pendingMoves[entry.resource.identifier];
      if (!override) return entry;
      return {
        ...entry,
        folderSegments: normalizePathSegments(override.path),
        fileName: override.fileName || entry.fileName,
      };
    });
  }, [baseStructuredEntries, pendingMoves]);

  const applyFolderPathTransformation = useCallback(
    (oldPath: string, targetBaseSegments: string[]) => {
      const oldSegments = normalizePathSegments(oldPath);
      const overrides: Record<string, { path: string; fileName: string }> = {};
      setPendingMoves((prev) => {
        const next = { ...prev };
        let changed = false;
        allStructuredEntries.forEach((entry) => {
          if (!matchesFolderSegments(entry.folderSegments, oldSegments)) return;
          const suffix = entry.folderSegments.slice(oldSegments.length);
          const merged = normalizePathSegments([...targetBaseSegments, ...suffix].join('/'));
          const nextPath = merged.join('/');
          overrides[entry.resource.identifier] = { path: nextPath, fileName: entry.fileName };
          if (prev[entry.resource.identifier]?.path === nextPath) return;
          next[entry.resource.identifier] = { path: nextPath, fileName: entry.fileName };
          changed = true;
        });
        return changed ? next : prev;
      });
      return overrides;
    },
    [allStructuredEntries]
  );

  const baseStructuredEntryMap = useMemo(() => {
    const map = new Map<string, StructuredEntry>();
    baseStructuredEntries.forEach((entry) => map.set(entry.resource.identifier, entry));
    return map;
  }, [baseStructuredEntries]);

  const pendingFolderDescriptors = useMemo(() => {
    return pendingFolders.map((path) => {
      const segments = normalizePathSegments(path);
      const name = segments[segments.length - 1] || '/';
      return {
        segments,
        name,
        resource: {
          name: activeName || '',
          service: 'DOCUMENT' as Service,
          identifier: `pending-folder-${path || 'root'}`,
          metadata: { title: name, description: 'Pending folder' },
        } as QdnResource,
      };
    });
  }, [pendingFolders, activeName]);

  const baseAllFolderDescriptors = useMemo(
    () =>
      combinedResources
        .map((res) => inferFolderDescriptor(res))
        .filter(Boolean) as FolderDescriptor[],
    [combinedResources]
  );

  const actualFolderPaths = useMemo(() => {
    const paths = new Set<string>();
    paths.add('');
    allStructuredEntries.forEach((entry) => {
      entry.folderSegments.forEach((_seg, idx) => {
        const key = entry.folderSegments.slice(0, idx + 1).join('/');
        paths.add(key);
      });
    });
    baseAllFolderDescriptors.forEach((desc) => {
      desc.segments.forEach((_seg, idx) => {
        const key = desc.segments.slice(0, idx + 1).join('/');
        paths.add(key);
      });
    });
    return paths;
  }, [allStructuredEntries, baseAllFolderDescriptors]);

  useEffect(() => {
    setActiveService(null);
    setSelectedResourceId(null);
    setSelectedResourceIds([]);
    setSearchTerm('');
    setActiveSection('services');
    setActiveFilePath('');
    setIgnoreManifestCache(false);
  }, [activeName]);

  useEffect(() => {
    if (!activeService) setSelectedResourceId(null);
  }, [activeService]);

  useEffect(() => {
    setSelectedResourceId(null);
    if (activeSection !== 'services') setActiveService(null);
  }, [activeSection]);

  useEffect(() => {
    setServicePage(1);
  }, [activeService, activeName]);

  useEffect(() => {
    setFolderPage(1);
  }, [activeFilePath, activeSection]);

  useEffect(() => {
    setSharePage(1);
  }, [activeName, activeSection, resourceSort, searchTerm]);

  useEffect(() => {
    setSystemSaveStatus(null);
  }, [selectedResourceId]);

  useEffect(() => {
    if (!activeName || !pendingFolders.length) return;
    const filtered = pendingFolders.filter((path) => !actualFolderPaths.has(path));
    if (filtered.length !== pendingFolders.length) {
      setPendingFolders(filtered);
    }
  }, [actualFolderPaths, pendingFolders, activeName]);

  useEffect(() => {
    const query = shareNames.split(',').pop()?.trim() ?? '';
    if (query.length < 2) {
      setNameSuggestions([]);
      setNameSearchError(null);
      return;
    }
    let cancelled = false;
    setNameSearchLoading(true);
    setNameSearchError(null);
    qortalRequest({
      action: 'SEARCH_NAMES',
      query,
      limit: 8,
    } as any)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res)
          ? res
              .map((item: any) => (typeof item === 'string' ? item : item?.name))
              .filter((name): name is string => typeof name === 'string' && name.length > 0)
          : [];
        setNameSuggestions(list);
      })
      .catch((e: any) => {
        if (!cancelled) setNameSearchError(e?.message || 'Name search failed');
      })
      .finally(() => {
        if (!cancelled) setNameSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareNames]);

  useEffect(() => {
    if (!Object.keys(pendingMoves).length) return;
    setPendingMoves((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([id, target]) => {
        const entry = baseStructuredEntryMap.get(id);
        if (!entry) return;
        const currentPath = entry.folderSegments.join('/');
        const targetPath = normalizePathSegments(target.path).join('/');
        if (currentPath === targetPath) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [baseStructuredEntryMap, pendingMoves]);

  const allStructuredEntryMap = useMemo(() => {
    const map = new Map<string, StructuredEntry>();
    allStructuredEntries.forEach((entry) => map.set(entry.resource.identifier, entry));
    return map;
  }, [allStructuredEntries]);

  const regularResources = useMemo(
    () => combinedResources.filter((res) => !isShareResource(res)),
    [combinedResources]
  );

  const sharedResources = useMemo(
    () => combinedResources.filter((res) => isShareResource(res)),
    [combinedResources]
  );

  const filteredResources = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const matched = regularResources.filter((res) => matchesSearch(res, query));
    return matched.sort((a, b) => compareResourcesBySort(a, b, resourceSort));
  }, [regularResources, searchTerm, resourceSort]);

  const filteredShareResources = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const matched = sharedResources.filter((res) => matchesSearch(res, query));
    return matched.sort((a, b) => compareResourcesBySort(a, b, resourceSort));
  }, [sharedResources, searchTerm, resourceSort]);

  useEffect(() => {
    setSelectedResourceIds((prev) =>
      prev.filter((id) => combinedResources.some((res) => res.identifier === id))
    );
  }, [combinedResources]);

  const visibleStructuredEntries = useMemo(
    () =>
      filteredResources
        .map((res) => allStructuredEntryMap.get(res.identifier) || null)
        .filter((entry): entry is StructuredEntry => Boolean(entry))
        .sort((a, b) => compareEntriesBySort(a, b, resourceSort)),
    [filteredResources, allStructuredEntryMap, resourceSort]
  );

  const selectedResourceSet = useMemo(() => new Set(selectedResourceIds), [selectedResourceIds]);
  const bulkSelectedResources = useMemo(
    () => combinedResources.filter((res) => selectedResourceSet.has(res.identifier)),
    [combinedResources, selectedResourceSet]
  );
  const selectedStructuredEntries = useMemo(
    () =>
      selectedResourceIds
        .map((id) => allStructuredEntryMap.get(id))
        .filter((entry): entry is StructuredEntry => Boolean(entry)),
    [selectedResourceIds, allStructuredEntryMap]
  );
  const movableEntries = selectedStructuredEntries;
  const deleteSelectionLabel = selectedStructuredEntries.length
    ? selectedStructuredEntries.length > 1
      ? `Delete ${selectedStructuredEntries.length} Files`
      : 'Delete'
    : bulkSelectedResources.length > 1
      ? `Delete ${bulkSelectedResources.length} Resources`
      : 'Delete service data';

  const manifestServiceBuckets = useMemo(() => {
    if (!manifestDoc) return [];
    return Object.entries(manifestDoc.services || {}).map(([service, count]) => ({
      service,
      label: serviceLabels(service),
      count: Number(count),
      newest: undefined,
    }));
  }, [manifestDoc]);

  const serviceBuckets = useMemo(() => {
    if (!filteredResources.length && manifestServiceBuckets.length) {
      return manifestServiceBuckets;
    }
    const map = new Map<string, ServiceBucket>();
    filteredResources.forEach((resource) => {
      const serviceKey = (resource.service || 'UNKNOWN').toUpperCase();
      const bucket = map.get(serviceKey) || {
        service: serviceKey,
        label: serviceLabels(resource.service),
        count: 0,
        newest: 0,
      };
      bucket.count += 1;
      bucket.newest = Math.max(bucket.newest ?? 0, resource.created ?? 0);
      map.set(serviceKey, bucket);
    });
    return Array.from(map.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    );
  }, [filteredResources, manifestServiceBuckets]);

  const shareCount = sharedResources.length;

  const activeResources = useMemo(() => {
    if (!activeService) return [];
    return filteredResources.filter(
      (res) => (res.service || 'UNKNOWN').toUpperCase() === activeService
    );
  }, [filteredResources, activeService]);

  const resourceFolderDescriptors = useMemo(
    () =>
      filteredResources
        .map((res) => inferFolderDescriptor(res))
        .filter(Boolean) as FolderDescriptor[],
    [filteredResources]
  );

  const manifestFolderDescriptors = useMemo(() => {
    if (!manifestDoc?.folders) return [];
    return manifestDoc.folders.map((folder) => {
      const segments = normalizePathSegments(folder.path);
      const name = folder.name || segments[segments.length - 1] || '/';
      return {
        segments,
        name,
        resource: {
          name: activeName || '',
          service: 'DOCUMENT' as Service,
          identifier: `manifest-folder-${folder.path || 'root'}`,
          metadata: { title: name, description: 'Manifest folder' },
        } as QdnResource,
      };
    });
  }, [manifestDoc, activeName]);

  const folderDescriptors = useMemo(
    () =>
      dedupeFolderDescriptors([
        ...resourceFolderDescriptors,
        ...manifestFolderDescriptors,
        ...pendingFolderDescriptors,
      ]),
    [resourceFolderDescriptors, manifestFolderDescriptors, pendingFolderDescriptors]
  );

  const folderMap = useMemo(
    () => buildFolderMap(visibleStructuredEntries, folderDescriptors),
    [visibleStructuredEntries, folderDescriptors]
  );

  const allFolderDescriptors = useMemo(
    () =>
      dedupeFolderDescriptors([
        ...baseAllFolderDescriptors,
        ...manifestFolderDescriptors,
        ...pendingFolderDescriptors,
      ]),
    [baseAllFolderDescriptors, manifestFolderDescriptors, pendingFolderDescriptors]
  );

  const knownFolderPaths = useMemo(() => {
    const merged = new Set<string>();
    merged.add('');
    allFolderDescriptors.forEach((desc) => merged.add(desc.segments.join('/')));
    return merged;
  }, [allFolderDescriptors]);

  const activeFolderSegments = normalizePathSegments(activeFilePath);
  const activeFolderPath = activeFolderSegments.join('/');
  const activeFolderName = activeFolderSegments[activeFolderSegments.length - 1] || '';
  const parentFolderSegments = activeFolderSegments.slice(0, -1);
  const parentFolderPath = parentFolderSegments.join('/');
  const openRenameFolderDialog = () => {
    if (!activeFolderPath) return;
    setRenameFolderDialog({
      open: true,
      newName: activeFolderName || '',
      error: null,
    });
  };
  const closeRenameFolderDialog = () => {
    setRenameFolderDialog({ open: false, newName: '', error: null });
  };
  const openDeleteFolderDialog = () => {
    if (!activeFolderPath) return;
    setDeleteFolderDialogOpen(true);
  };
  const closeDeleteFolderDialog = () => {
    setDeleteFolderDialogOpen(false);
  };
  const handleFolderRenameConfirm = async () => {
    if (!activeFolderPath) return;
    const newName = renameFolderDialog.newName.trim();
    if (!newName) {
      setRenameFolderDialog((prev) => ({ ...prev, error: 'Enter a folder name.' }));
      return;
    }
    if (newName.includes('/')) {
      setRenameFolderDialog((prev) => ({ ...prev, error: 'Folder names cannot contain slashes.' }));
      return;
    }
    if (!activeFolderSegments.length) {
      setRenameFolderDialog((prev) => ({ ...prev, error: 'Cannot rename root folder.' }));
      return;
    }
    const normalizedNewSegments = normalizePathSegments(
      [...parentFolderSegments, newName].join('/')
    );
    const normalizedNew = normalizedNewSegments.join('/');
    if (normalizedNew === activeFolderPath) {
      closeRenameFolderDialog();
      return;
    }
    if (knownFolderPaths.has(normalizedNew)) {
      setRenameFolderDialog((prev) => ({ ...prev, error: 'Folder already exists.' }));
      return;
    }
    const structuredOverrides = applyFolderPathTransformation(
      activeFolderPath,
      normalizedNewSegments
    );
    setPendingFolders((prev) => {
      const cleaned = prev.filter((path) => path !== activeFolderPath);
      return cleaned.includes(normalizedNew) ? cleaned : [...cleaned, normalizedNew];
    });
    if (publishMode === 'immediate') {
      await handlePublishManifest({
        structured: structuredOverrides,
        folders: [{ path: normalizedNew, name: newName }],
      });
    } else {
      setManifestDirty(true);
    }
    setActiveFilePath(normalizedNew);
    closeRenameFolderDialog();
  };
  const handleFolderDeleteConfirm = async () => {
    if (!activeFolderPath) return;
    if (!activeFolderSegments.length) {
      closeDeleteFolderDialog();
      return;
    }
    const structuredOverrides = applyFolderPathTransformation(
      activeFolderPath,
      parentFolderSegments
    );
    setPendingFolders((prev) => prev.filter((path) => path !== activeFolderPath));
    if (publishMode === 'immediate') {
      await handlePublishManifest({ structured: structuredOverrides });
    } else {
      setManifestDirty(true);
    }
    setActiveFilePath(parentFolderPath);
    closeDeleteFolderDialog();
  };

  const folderOptions = useMemo(
    () =>
      Array.from(knownFolderPaths).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    [knownFolderPaths]
  );

  const folderSnapshot = useMemo(() => {
    const map = new Map<string, string>();
    allFolderDescriptors.forEach((desc) => {
      const path = desc.segments.join('/');
      const name = desc.name || desc.segments[desc.segments.length - 1] || '/';
      map.set(path, name);
    });
    return Array.from(map.entries()).map(([path, name]) => ({ path, name }));
  }, [allFolderDescriptors]);

  const currentFolderKey = folderMap.has(activeFilePath) ? activeFilePath : '';
  const currentFolder = folderMap.get(currentFolderKey) ||
    folderMap.get('') || {
      key: '',
      name: '/',
      parentKey: null,
      childKeys: [],
      files: [],
    };
  const currentFolderHasFiles = currentFolder.files.length > 0;
  const childFolders = currentFolder.childKeys
    .map((key) => folderMap.get(key))
    .filter((node): node is FolderNode => Boolean(node))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const currentFolderFiles = currentFolder.files;
  const sortedFolderFiles = useMemo(
    () => [...currentFolderFiles].sort((a, b) => compareEntriesBySort(a, b, resourceSort)),
    [currentFolderFiles, resourceSort]
  );

  const manifestSummary = useMemo(() => {
    const services: Record<string, number> = {};
    combinedResources.forEach((resource) => {
      const serviceKey = (resource.service || 'UNKNOWN').toUpperCase();
      services[serviceKey] = (services[serviceKey] || 0) + 1;
    });
    const lastSynced = combinedResources.reduce(
      (max, resource) => Math.max(max, resource.created ?? 0),
      0
    );
    return {
      services,
      totals: {
        resources: combinedResources.length,
        structuredFiles: allStructuredEntries.length,
      },
      lastSynced,
    };
  }, [combinedResources, allStructuredEntries.length]);

  const structuredSnapshot = useMemo(
    () =>
      allStructuredEntries.map((entry) => ({
        identifier: entry.resource.identifier,
        path: entry.folderSegments.join('/'),
        fileName: entry.fileName,
      })),
    [allStructuredEntries]
  );

  useEffect(() => {
    if (!activeName) {
      setManifestDirty(false);
      return;
    }
    if (!manifestDoc) {
      setManifestDirty(true);
      return;
    }
    const prevSnapshot = JSON.stringify({
      services: manifestDoc.services,
      totals: manifestDoc.totals,
      lastSynced: manifestDoc.lastSynced || 0,
    });
    const currentSnapshot = JSON.stringify({
      services: manifestSummary.services,
      totals: manifestSummary.totals,
      lastSynced: manifestSummary.lastSynced || 0,
    });
    const prevTypes = JSON.stringify(manifestDoc.resourceTypes || {});
    const currentTypes = JSON.stringify(detectedTypes);
    const prevStructure = JSON.stringify(
      (manifestDoc.structuredFiles || []).map((entry) => ({
        identifier: entry.identifier,
        path: entry.path,
        fileName: entry.fileName,
      }))
    );
    const currentStructure = JSON.stringify(structuredSnapshot);
    const prevFolders = JSON.stringify(manifestDoc.folders || []);
    const currentFolders = JSON.stringify(folderSnapshot);
    setManifestDirty(
      prevSnapshot !== currentSnapshot ||
        prevTypes !== currentTypes ||
        prevStructure !== currentStructure ||
        prevFolders !== currentFolders
    );
  }, [manifestDoc, manifestSummary, activeName, detectedTypes, structuredSnapshot, folderSnapshot]);

  const selectedResource = useMemo(
    () => filteredResources.find((res) => res.identifier === selectedResourceId) || null,
    [filteredResources, selectedResourceId]
  );
  const selectedStructuredEntry = useMemo(
    () => (selectedResourceId ? allStructuredEntryMap.get(selectedResourceId) || null : null),
    [allStructuredEntryMap, selectedResourceId]
  );
  const detailTags = selectedResource ? getDisplayTags(selectedResource) : [];
  const selectedResourceFileType = selectedResource
    ? detectedTypes[selectedResource.identifier] || selectedResource.service || '—'
    : null;

  const ensureFolderPathAllowed = useCallback(
    (path: string) => {
      const segments = normalizePathSegments(path);
      if (!segments.length) return { ok: true };
      const joined = segments.join('/');
      if (segments.length === 1) return { ok: true };
      if (knownFolderPaths.has(joined)) return { ok: true };
      return {
        ok: false,
        reason: 'Nested folder paths must already exist. Create folders from Files first.',
      };
    },
    [knownFolderPaths]
  );

  const handleSaveToFilesSubmit = async () => {
    const targets =
      saveToFilesDialog.resources.length > 0
        ? saveToFilesDialog.resources
        : selectedResource
          ? [selectedResource]
          : [];
    if (!activeName || !targets.length) {
      setSaveToFilesDialog((prev) => ({
        ...prev,
        error: 'Select at least one resource and Qortal name first.',
      }));
      return;
    }
    const normalizedFolder = normalizePathSegments(saveToFilesDialog.folderPath).join('/');
    const folderCheck = ensureFolderPathAllowed(normalizedFolder);
    if (!folderCheck.ok) {
      setSaveToFilesDialog((prev) => ({
        ...prev,
        error: folderCheck.reason || 'Invalid folder path.',
      }));
      return;
    }
    const trimmedName = saveToFilesDialog.fileName.trim();
    if (targets.length === 1 && !trimmedName) {
      setSaveToFilesDialog((prev) => ({ ...prev, error: 'Enter a file name to save.' }));
      return;
    }
    setSaveToFilesDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const publishRequests: BatchPublishResource[] = [];
      for (const resource of targets) {
        const entryMeta = allStructuredEntryMap.get(resource.identifier) || null;
        const targetName =
          targets.length === 1
            ? trimmedName
            : entryMeta?.fileName || resource.metadata?.title || resource.identifier;
        const encryptionInfo = getEncryptionInfo(resource);
        const treatAsEncrypted = encryptionInfo.mode !== null || encryptionInfo.isPrivate;
        const rawBase64 = await (treatAsEncrypted
          ? fetchPrivateBase64(resource)
          : fetchResourceBase64(resource));
        if (!rawBase64) throw new Error('Unable to fetch resource data for saving.');
        const targetPath = normalizedFolder || entryMeta?.folderSegments.join('/') || '';
        const normalizedService = resolveServiceForEncryptionMode(
          resource.service,
          encryptionInfo.mode
        );
        const identifier = buildQassetsFileIdentifier(
          normalizedService as Service,
          activeName || resource.name
        );
        const existingMetadata = { ...(resource.metadata || {}) };
        const existingTags = Array.isArray((existingMetadata as any).tags)
          ? ((existingMetadata as any).tags as string[])
          : [];
        const { metadata: sanitizedMetadata, tags: sanitizedTags } =
          stripStructuredMetadata(resource);
        const tagsSet = new Set<string>(
          (treatAsEncrypted ? sanitizedTags : existingTags).filter(
            (tag): tag is string => typeof tag === 'string' && tag.length > 0
          )
        );
        const includeFullFsMetadata = !treatAsEncrypted;
        if (includeFullFsMetadata) {
          tagsSet.add('qassets-fs');
          if (targetPath) tagsSet.add(`fs-path:${targetPath}`);
          tagsSet.add(`fs-name:${targetName}`);
          if (resource.created) tagsSet.add(`fs-source-created:${resource.created}`);
        }
        if (treatAsEncrypted) tagsSet.add('private');
        const tags = Array.from(tagsSet);
        const metadata: Record<string, any> = {
          ...(treatAsEncrypted ? sanitizedMetadata : existingMetadata),
          tags,
        };
        if (includeFullFsMetadata) {
          metadata.qassetsFs = {
            path: targetPath,
            fileName: targetName,
            version: 1,
          };
          metadata.qassetsSource = {
            name: resource.name,
            service: resource.service,
            identifier: resource.identifier,
            created: resource.created,
            savedAt: Date.now(),
          };
          metadata.title = (existingMetadata as any)?.title || targetName;
        } else {
          metadata.title = (metadata as any).title || 'Encrypted resource';
        }
        const description = treatAsEncrypted
          ? 'Encrypted resource published via Q-Assets Data Explorer.'
          : saveToFilesDialog.description || resource.metadata?.description;

        publishRequests.push({
          name: activeName,
          service: normalizedService,
          identifier,
          base64: rawBase64,
          title: metadata.title,
          description,
          tags,
          metadata,
          // disableEncrypt: treatAsEncrypted,
          privateMode: encryptionInfo.mode ?? undefined,
        });
      }
      setSaveToFilesDialog({
        open: false,
        folderPath: '',
        fileName: '',
        description: '',
        saving: false,
        error: null,
        resources: [],
      });
      await publishResources(publishRequests);
      await refreshResources();
    } catch (e: any) {
      setSaveToFilesDialog((prev) => ({
        ...prev,
        error: e?.message || 'Failed to save to files.',
      }));
    } finally {
      setSaveToFilesDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleMoveDialogClose = () => {
    if (moveDialog.saving) return;
    setMoveDialog({ open: false, folderPath: '', saving: false, error: null, entries: [] });
  };

  const handleMoveSubmit = async () => {
    if (!moveDialog.entries.length) {
      setMoveDialog((prev) => ({ ...prev, error: 'Select structured files to move.' }));
      return;
    }
    const normalizedFolder = normalizePathSegments(moveDialog.folderPath).join('/');
    const folderCheck = ensureFolderPathAllowed(normalizedFolder);
    if (!folderCheck.ok) {
      setMoveDialog((prev) => ({
        ...prev,
        saving: false,
        error: folderCheck.reason || 'Nested folder paths must already exist.',
      }));
      return;
    }
    setMoveDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const pendingUpdates: Record<string, { path: string; fileName: string }> = {};
      for (const entry of moveDialog.entries) {
        const nextPath = normalizedFolder;
        const nextFileName = entry.fileName;
        pendingUpdates[entry.resource.identifier] = {
          path: nextPath,
          fileName: nextFileName,
        };
      }
      if (Object.keys(pendingUpdates).length) {
        setPendingMoves((prev) => ({ ...prev, ...pendingUpdates }));
      }
      handleMoveDialogClose();
      if (publishMode === 'immediate') {
        await handlePublishManifest({ structured: pendingUpdates });
      } else {
        setManifestDirty(true);
      }
    } catch (e: any) {
      setMoveDialog((prev) => ({
        ...prev,
        saving: false,
        error: e?.message || 'Failed to move files.',
      }));
    } finally {
      setMoveDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleOpenPublishMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    setPublishAnchor(event.currentTarget);
  };
  const closePublishMenu = () => setPublishAnchor(null);

  const handleToggleSelection = (resourceId: string) => {
    setSelectedResourceIds((prev) =>
      prev.includes(resourceId) ? prev.filter((id) => id !== resourceId) : prev.concat(resourceId)
    );
  };

  const handleClearSelection = () => setSelectedResourceIds([]);

  const handleServiceNavigate = (serviceKey: string | null) => {
    setActiveSection('services');
    setActiveService(serviceKey);
    setSelectedResourceId(null);
  };

  const handleFolderNavigate = (folderKey: string) => {
    setActiveSection('files');
    setActiveFilePath(folderKey);
    setSelectedResourceId(null);
  };

  const handleShareNavigate = () => {
    setActiveSection('shares');
    setActiveService(null);
    setActiveFilePath('');
    setSelectedResourceId(null);
    setSelectedResourceIds([]);
    setSharePage(1);
  };

  const handleLoadFromNetwork = async () => {
    await refreshResources();
  };

  const handleLoadRemaining = useCallback(async () => {
    if (resourcesLoading || loadingAllPages) return;
    setIgnoreManifestCache(true);
    setLoadingAllPages(true);
    try {
      if (!rows.length) {
        await reload();
      }
      await loadAll();
    } catch {
      // errors surfaced via useQdnResources error state
    } finally {
      setLoadingAllPages(false);
    }
  }, [resourcesLoading, loadingAllPages, loadAll, reload, rows.length]);

  const handlePublishOpen = (variant: 'single' | 'multiple') => {
    if (!activeName) {
      alert('Select or register a Qortal name before publishing.');
      return;
    }
    const defaults = createPublishDefaults(
      activeSection === 'files' ? activeFilePath : '',
      activeSection === 'files'
    );
    setPublishDialog({ open: true, variant, defaults });
    setPublishStatus(null);
  };

  const handlePublishClose = (options?: { force?: boolean }) => {
    if (publishing && !options?.force) return;
    const defaults = createPublishDefaults(
      activeSection === 'files' ? activeFilePath : '',
      activeSection === 'files'
    );
    setPublishDialog({ open: false, variant: 'single', defaults });
    setPublishStatus(null);
  };

  const handlePublishSubmit = async ({
    form,
    files,
    encryptionMode,
    groupId,
    groupAdminsOnly,
    directRecipients,
    chunkedPublishing,
  }: PublishSubmitPayload) => {
    if (!activeName) {
      setPublishStatus('Select a Qortal name before publishing.');
      return;
    }
    if (!files.length) {
      setPublishStatus('Select at least one file.');
      return;
    }

    const normalizedFolder = normalizePathSegments(form.folderPath).join('/');
    const hasForcedChunking =
      encryptionMode !== 'none' && files.some((file) => file.size > CHUNK_FORCED_THRESHOLD);
    const requiresChunkGroup = chunkedPublishing && encryptionMode !== 'none';
    const needsForcedGroup = hasForcedChunking;
    if (requiresChunkGroup && encryptionMode !== 'group') {
      setPublishStatus('Chunked publishing requires group encryption.');
      return;
    }
    if ((requiresChunkGroup || needsForcedGroup) && !groupId) {
      setPublishStatus('Select a private group for chunked publishing.');
      return;
    }

    setPublishing(true);
    setPublishStatus(null);
    const baseId = sanitizeIdentifier(form.identifier || '');
    let success = false;
    try {
      const publisherAddress = await resolvePublisherAddress();
      const directRecipientList = parseRecipientList(directRecipients);
      let directPublicKeys: string[] = [];
      if (encryptionMode === 'direct') {
        if (!directRecipientList.length) {
          alert('No recipients specified. Files will be encrypted for you only.');
        }
        const { publicKeys } = await collectRecipientPublicKeys({
          usersAllowed: directRecipientList,
          includeSelf: true,
          me: {
            name: activeName || authName || undefined,
            address: publisherAddress,
          },
        });
        directPublicKeys = publicKeys;
        if (!directPublicKeys.length) {
          throw new Error('No recipient public keys resolved.');
        }
      }

      const encryptPayload = async (
        payload64: string
      ): Promise<{
        base64: string;
        service: Service;
        tagExtra: string[];
        privateMode?: 'group' | 'direct';
      }> => {
        if (encryptionMode === 'none') {
          return {
            base64: payload64,
            service: form.service,
            tagExtra: [],
          };
        }
        if (encryptionMode === 'group') {
          if (!groupId) throw new Error('Select a group for encryption.');
          const enc64Group = await qortalRequest({
            action: 'ENCRYPT_QORTAL_GROUP_DATA',
            base64: payload64,
            groupId,
            isAdmins: groupAdminsOnly,
          });
          const tagExtra = buildEncryptionTagSet({
            mode: 'group',
            publisher: publisherAddress,
            groupId,
            adminsOnly: groupAdminsOnly,
          });
          return {
            base64: enc64Group,
            service: resolveServiceForEncryptionMode(form.service, 'group'),
            tagExtra,
            privateMode: 'group',
          };
        }
        const enc64Direct = await qortalRequest({
          action: 'ENCRYPT_DATA',
          base64: payload64,
          publicKeys: directPublicKeys,
        });
        const tagExtra = buildEncryptionTagSet({
          mode: 'direct',
          publisher: publisherAddress,
          userCount: directPublicKeys.length || directRecipientList.length || 1,
        });
        return {
          base64: enc64Direct,
          service: resolveServiceForEncryptionMode(form.service, 'direct'),
          tagExtra,
          privateMode: 'direct',
        };
      };

      const publishRequests: BatchPublishResource[] = [];
      const chunkSize = DEFAULT_CHUNK_SIZE;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const title = form.title || file.name;
        const description = form.description || `Published via Q-Assets Data Explorer`;
        let tags: string[] = [];
        if (form.structured) {
          tags.push('qassets-fs');
          if (normalizedFolder) tags.push(`fs-path:${normalizedFolder}`);
          tags.push(`fs-name:${file.name}`);
        }
        let metadata: Record<string, any> = {};
        if (form.structured) {
          metadata.qassetsFs = {
            path: normalizedFolder,
            fileName: file.name,
            version: 1,
          };
          metadata.title = file.name;
        }

        let identifier: string;
        if (baseId) {
          const suffix = publishDialog.variant === 'multiple' ? `-${i + 1}-${uniqueId6()}` : '';
          identifier =
            publishDialog.variant === 'multiple'
              ? `${baseId}${suffix}`.slice(0, MAX_FILE_IDENTIFIER_LENGTH)
              : baseId.slice(0, MAX_FILE_IDENTIFIER_LENGTH);
        } else {
          identifier = buildQassetsFileIdentifier(form.service as Service, activeName);
        }

        const shouldChunk =
          encryptionMode !== 'none' &&
          (file.size > CHUNK_FORCED_THRESHOLD ||
            (chunkedPublishing && file.size > MAX_INLINE_FILE_SIZE));
        if (!shouldChunk) {
          const file64 = await fileToBase64(file);
          const {
            base64: finalData64,
            service: finalService,
            tagExtra,
            privateMode,
          } = await encryptPayload(file64);
          const finalTags = tagExtra.length ? tagExtra.concat(tags) : tags;
          publishRequests.push({
            name: activeName,
            service: finalService,
            identifier,
            base64: finalData64,
            title,
            description,
            tags: finalTags,
            metadata,
            privateMode,
          });
          continue;
        }

        const chunkDescriptors: FileChunkDescriptor[] = [];
        const chunkPublishRequests: BatchPublishResource[] = [];
        for await (const chunk of iterateFileChunks(file, chunkSize)) {
          const chunk64 = uint8ArrayToBase64(chunk.uint8);
          const chunkIndexId = buildChunkIdentifier(identifier, chunk.index).slice(
            0,
            MAX_FILE_IDENTIFIER_LENGTH
          );
          const {
            base64: chunkData64,
            service: chunkService,
            tagExtra,
            privateMode,
          } = await encryptPayload(chunk64);
          chunkDescriptors.push({
            index: chunk.index,
            identifier: chunkIndexId,
            size: chunk.size,
          });

          const chunkTags = Array.from(new Set([...tagExtra, CHUNK_METADATA_TAG]));
          chunkPublishRequests.push({
            name: activeName,
            service: chunkService,
            identifier: chunkIndexId,
            base64: chunkData64,
            title: `${title} (chunk ${chunk.index + 1})`,
            description,
            tags: chunkTags,
            metadata: {
              qassetsChunk: {
                parentIdentifier: identifier,
                index: chunk.index,
                chunked: true,
              },
            },
            privateMode,
          });
        }

        publishRequests.push(...chunkPublishRequests);

        const chunkEncryptionInfo: ChunkedFileManifest['encryption'] | undefined =
          encryptionMode === 'group'
            ? { mode: 'group', groupId: groupId ?? undefined, adminsOnly: groupAdminsOnly }
            : {
                mode: 'direct',
                recipientCount: directPublicKeys.length || directRecipientList.length || 1,
              };
        const manifest = createChunkedManifest(
          file,
          chunkSize,
          chunkDescriptors,
          chunkEncryptionInfo
        );
        const manifestJson = await objectToBase64(manifest);
        const {
          base64: manifestData64,
          service: manifestService,
          tagExtra: manifestTagExtra,
          privateMode: manifestPrivateMode,
        } = await encryptPayload(manifestJson);
        const manifestTags = Array.from(new Set([...manifestTagExtra, ...tags]));
        const manifestMetadata = {
          ...metadata,
          qassetsFs: {
            ...(metadata.qassetsFs || {}),
            chunked: true,
            chunkManifestId: identifier,
            chunkCount: chunkDescriptors.length,
            chunkSize,
          },
        };
        publishRequests.push({
          name: activeName,
          service: manifestService,
          identifier,
          base64: manifestData64,
          title,
          description,
          tags: manifestTags,
          metadata: manifestMetadata,
          privateMode: manifestPrivateMode,
        });
      }

      await publishResources(publishRequests);
      await refreshResources();
      success = true;
    } catch (e: any) {
      setPublishStatus(e?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
    if (success) {
      handlePublishClose({ force: true });
    }
  };

  const handleFolderFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const mapped = files.map((file) => {
      const relative =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return { file, relativePath: relative };
    });
    if (mapped.length) {
      const relParts = mapped[0].relativePath.split('/').filter(Boolean);
      setFolderRootName(relParts[0] || mapped[0].file.name);
    } else {
      setFolderRootName('');
    }
    setFolderSelection(mapped);
    event.target.value = '';
  };

  const handleFolderPublish = async () => {
    if (!activeName) {
      setFolderStatus('Select a Qortal name before publishing.');
      return;
    }
    if (!folderSelection.length) {
      setFolderStatus('Select a folder to publish.');
      return;
    }
    setFolderPublishing(true);
    setFolderStatus(null);
    try {
      const baseSegments = normalizePathSegments(folderTargetPath);
      const publishedEntries: Array<{ identifier: string; path: string; fileName: string }> = [];
      const publishRequests: BatchPublishResource[] = [];
      for (const entry of folderSelection) {
        const relParts = entry.relativePath.split('/').filter(Boolean);
        const trimmedParts =
          folderRootName && relParts[0] === folderRootName ? relParts.slice(1) : relParts;
        const fileName = trimmedParts[trimmedParts.length - 1] || entry.file.name;
        const relativeFolders = trimmedParts.slice(0, -1);
        const folderSegments = [...baseSegments, ...relativeFolders];
        const folderPath = folderSegments.join('/');
        const normalizedService = ensurePublicService(folderService);
        const identifier = buildQassetsFileIdentifier(
          normalizedService as Service,
          activeName || folderRootName
        );
        const base64 = await fileToBase64(entry.file);
        const tags = ['qassets-fs'];
        if (folderPath) tags.push(`fs-path:${folderPath}`);
        tags.push(`fs-name:${fileName}`);
        const metadata: Record<string, any> = {
          qassetsFs: {
            path: folderPath,
            fileName,
            version: 1,
          },
          title: fileName,
        };
        publishRequests.push({
          name: activeName,
          service: normalizedService as Service,
          identifier,
          base64,
          title: fileName,
          description: `Folder publish: ${folderRootName || 'folder'}`,
          tags,
          metadata,
        });
        publishedEntries.push({ identifier, path: folderPath, fileName });
      }
      await publishResources(publishRequests);

      const manifest = {
        _type: 'QASSETS_FS_FOLDER',
        version: 1,
        root: folderRootName || '/',
        folderPath: baseSegments.join('/'),
        entries: publishedEntries,
        createdAt: Date.now(),
      };
      const manifestTags = ['qassets-fs-folder'];
      if (manifest.folderPath) manifestTags.push(`fs-folder:${manifest.folderPath}`);
      const manifestData64 = await objectToBase64(manifest);
      await publishResources([
        {
          name: activeName,
          service: 'DOCUMENT' as Service,
          identifier: `qassets-fs-folder-${uniqueId6()}`,
          base64: manifestData64,
          title: manifest.root,
          description: `Folder snapshot (${manifest.folderPath || '/'})`,
          tags: manifestTags,
          metadata: {
            qassetsFsFolder: {
              path: manifest.folderPath,
              name: manifest.root,
              version: 1,
            },
          },
        },
      ]);

      await refreshResources();
      handleFolderDialogClose();
      if (publishMode === 'immediate') {
        await handlePublishManifest();
      } else {
        setManifestDirty(true);
      }
    } catch (e: any) {
      setFolderStatus(e?.message || 'Folder publish failed');
    } finally {
      setFolderPublishing(false);
    }
  };

  const handlePreviewResource = async (resourceArg?: QdnResource) => {
    const target = resourceArg || selectedResource;
    if (!target) return;
    if (resourceArg && resourceArg.identifier !== selectedResourceId) {
      setSelectedResourceId(resourceArg.identifier);
    }
    cleanupChunkedVideoPreview();
    const initialSteps = clonePreviewSteps();
    setPreviewDialog({
      open: true,
      loading: true,
      title: getResourceLabel(target),
      steps: initialSteps,
      resource: target,
      zoomed: false,
      expanded: false,
      videoUrl: undefined,
      chunked: false,
    });
    const updateStep = (key: PreviewStepKey, status: PreviewStepStatus, message?: string) => {
      setPreviewDialog((prev) => ({
        ...prev,
        steps: prev.steps.map((step) => (step.key === key ? { ...step, status, message } : step)),
      }));
    };
    try {
      const loaded = await ensureResourceContent(target, { onStep: updateStep });
      if (loaded.chunkedManifest) {
        const chunkManifest = loaded.chunkedManifest!;
        const chunkedMime = chunkManifest.mimeType || loaded.mime;
        if (chunkedMime.startsWith('video/')) {
          updateStep('analyze', 'active', 'Streaming video from chunks…');
          try {
            const { objectUrl, promise } = streamChunkedVideo(chunkManifest);
            setPreviewDialog((prev) => ({
              ...prev,
              open: true,
              loading: false,
              title: getResourceLabel(target),
              type: 'video',
              resource: target,
              zoomed: false,
              chunked: true,
              videoUrl: objectUrl,
              error: undefined,
            }));
            void promise.catch(async (streamError) => {
              updateStep('analyze', 'error', streamError?.message);
              cleanupChunkedMediaSource();
              try {
                const fallbackUrl = await createChunkedBlobUrl(chunkManifest);
                setPreviewChunkedBlobUrl(fallbackUrl);
                setPreviewDialog((prev) => ({
                  ...prev,
                  videoUrl: fallbackUrl,
                  error:
                    streamError?.message ||
                    'Streaming unavailable; playing buffered video instead.',
                }));
              } catch (fallbackError: any) {
                setPreviewDialog((prev) => ({
                  ...prev,
                  error:
                    fallbackError?.message ||
                    streamError?.message ||
                    'Unable to load chunked video.',
                }));
              }
            });
            updateStep('analyze', 'success');
            return;
          } catch (startError: any) {
            updateStep('analyze', 'error', startError?.message);
            cleanupChunkedMediaSource();
            const fallbackMessage = startError?.message || 'Streaming unavailable.';
            try {
              const fallbackUrl = await createChunkedBlobUrl(chunkManifest);
              setPreviewChunkedBlobUrl(fallbackUrl);
              setPreviewDialog((prev) => ({
                ...prev,
                open: true,
                loading: false,
                title: getResourceLabel(target),
                type: 'video',
                resource: target,
                zoomed: false,
                chunked: true,
                videoUrl: fallbackUrl,
                error: fallbackMessage,
              }));
            } catch (fallbackError: any) {
              setPreviewDialog((prev) => ({
                ...prev,
                open: true,
                loading: false,
                title: getResourceLabel(target),
                type: 'video',
                resource: target,
                zoomed: false,
                chunked: false,
                videoUrl: undefined,
                error:
                  fallbackError?.message || startError?.message || 'Unable to load chunked video.',
              }));
            }
            return;
          }
        }
      }
      if (loaded.mime.startsWith('image/')) {
        setPreviewDialog((prev) => ({
          ...prev,
          open: true,
          loading: false,
          title: getResourceLabel(target),
          type: 'image',
          dataUrl: `data:${loaded.mime};base64,${loaded.base64}`,
          resource: target,
          zoomed: false,
          chunked: false,
          videoUrl: undefined,
        }));
        return;
      }

      if (loaded.mime.startsWith('video/')) {
        setPreviewDialog((prev) => ({
          ...prev,
          open: true,
          loading: false,
          title: getResourceLabel(target),
          type: 'video',
          resource: target,
          zoomed: false,
          chunked: false,
          videoUrl: undefined,
        }));
        return;
      }

      try {
        const text = base64ToUtf8(loaded.base64);
        if (isProbablyText(text)) {
          setPreviewDialog((prev) => ({
            ...prev,
            open: true,
            loading: false,
            title: getResourceLabel(target),
            type: 'text',
            content: text,
            resource: target,
            zoomed: false,
            chunked: false,
            videoUrl: undefined,
          }));
        } else {
          setPreviewDialog((prev) => ({
            ...prev,
            open: true,
            loading: false,
            title: getResourceLabel(target),
            type: 'binary',
            content: 'This resource appears to be binary. Use Save to system to download it.',
            resource: target,
            zoomed: false,
            chunked: false,
            videoUrl: undefined,
          }));
        }
      } catch {
        const fallbackResource = selectedResource ?? target;
        setPreviewDialog((prev) => ({
          ...prev,
          open: true,
          loading: false,
          title: fallbackResource ? getResourceLabel(fallbackResource) : 'Preview',
          type: 'binary',
          content: 'Preview not available. Use Save to system to download this resource.',
          resource: fallbackResource || null,
          zoomed: false,
          chunked: false,
          videoUrl: undefined,
        }));
      }
    } catch (e: any) {
      updateStep('fetch', 'error', e?.message);
      const fallbackResource = selectedResource ?? target;
      setPreviewDialog((prev) => ({
        ...prev,
        open: true,
        loading: false,
        title: fallbackResource ? getResourceLabel(fallbackResource) : 'Preview',
        error: e?.message || 'Unable to preview this resource.',
        resource: fallbackResource || null,
        zoomed: false,
        chunked: false,
        videoUrl: undefined,
      }));
    }
  };

  const handlePreviewShare = () => {
    if (previewDialog.resource) {
      openShareDialogForResources([previewDialog.resource]);
    }
  };

  const togglePreviewZoom = () => {
    setPreviewDialog((prev) =>
      prev.type === 'image'
        ? {
            ...prev,
            zoomed: !prev.zoomed,
          }
        : prev
    );
  };

  const togglePreviewExpanded = () => {
    setPreviewDialog((prev) => ({
      ...prev,
      expanded: !prev.expanded,
    }));
  };

  const handlePreviewClose = () => {
    cleanupChunkedVideoPreview();
    setPreviewDialog(createPreviewDialogState());
  };

  const handleManifestDialogOpen = (entry: StructuredEntry) => {
    setManifestDialog({
      open: true,
      entry,
      saving: false,
      error: null,
    });
  };

  const handleManifestDialogClose = () => {
    if (manifestDialog.saving) return;
    setManifestDialog({
      open: false,
      entry: null,
      saving: false,
      error: null,
    });
  };

  const handleManifestSave = async ({
    folderPath,
    fileName,
  }: {
    folderPath: string;
    fileName: string;
  }) => {
    if (!manifestDialog.entry) return;
    const entry = manifestDialog.entry;
    const normalizedPath = normalizePathSegments(folderPath).join('/');
    const nextFileName = fileName.trim() || entry.fileName;
    setManifestDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const base64 = await resolveResourceBase64(entry.resource);
      const tags = ['qassets-fs'];
      if (normalizedPath) tags.push(`fs-path:${normalizedPath}`);
      tags.push(`fs-name:${nextFileName}`);
      if (entry.isPrivate) tags.push('private');
      const metadata = {
        ...entry.resource.metadata,
        qassetsFs: {
          path: normalizedPath,
          fileName: nextFileName,
          version: 1,
        },
      };
      await republishWithMetadata({ resource: entry.resource, base64, metadata, tags });
      await refreshResources();
      const manifestOverrides: ManifestOverrides = {
        structured: {
          [entry.resource.identifier]: {
            path: normalizedPath,
            fileName: nextFileName,
          },
        },
      };
      if (publishMode === 'immediate') {
        await handlePublishManifest(manifestOverrides);
      } else {
        setManifestDirty(true);
      }
      handleManifestDialogClose();
    } catch (e: any) {
      setManifestDialog((prev) => ({
        ...prev,
        saving: false,
        error: e?.message || 'Failed to update manifest',
      }));
    }
  };

  type ManifestOverrides = {
    folders?: Array<{ path: string; name?: string }>;
    structured?: Record<string, { path?: string; fileName?: string }>;
    removeResourceIdentifiers?: string[];
    removeStructuredIdentifiers?: string[];
  };

  const buildManifestPayload = useCallback(
    (overrides?: ManifestOverrides): ManifestDoc => {
      const removalResources = new Set(overrides?.removeResourceIdentifiers || []);
      const manifestResourcesPayload = combinedResources
        .filter((res) => !removalResources.has(res.identifier))
        .map((res) => ({
          identifier: res.identifier,
          service: res.service,
          name: res.name,
          created: res.created,
          size: res.size,
          metadata: res.metadata ? { ...res.metadata } : undefined,
          status: res.status ? { ...res.status } : undefined,
        }));
      const removalSet = new Set(overrides?.removeStructuredIdentifiers || []);
      const manifestStructuredPayload = allStructuredEntries
        .filter((entry) => !removalSet.has(entry.resource.identifier))
        .map((entry) => {
          const override = overrides?.structured?.[entry.resource.identifier];
          const nextPath = override?.path ?? entry.folderSegments.join('/');
          const nextFileName = override?.fileName ?? entry.fileName;
          return {
            identifier: entry.resource.identifier,
            path: nextPath,
            fileName: nextFileName,
            service: entry.resource.service,
          };
        });
      const folderMap = new Map<string, string>();
      folderSnapshot.forEach((folder) => {
        const normalized = normalizePathSegments(folder.path).join('/');
        const folderName = folder.name || normalized.split('/').filter(Boolean).slice(-1)[0] || '/';
        folderMap.set(normalized, folderName);
      });
      overrides?.folders?.forEach(({ path, name }) => {
        const normalized = normalizePathSegments(path).join('/');
        const folderName = name || normalized.split('/').filter(Boolean).slice(-1)[0] || '/';
        folderMap.set(normalized, folderName);
      });
      return {
        version: 1,
        generatedAt: Date.now(),
        services: manifestSummary.services,
        totals: manifestSummary.totals,
        resourceTypes: detectedTypes,
        resources: manifestResourcesPayload,
        structuredFiles: manifestStructuredPayload,
        folders: Array.from(folderMap.entries()).map(([path, name]) => ({ path, name })),
        lastSynced: manifestSummary.lastSynced,
      };
    },
    [combinedResources, manifestSummary, detectedTypes, allStructuredEntries, folderSnapshot]
  );

  const handlePublishManifest = useCallback(
    async (overrides?: ManifestOverrides) => {
      if (!activeName) return;
      setManifestPublishing(true);
      setManifestError(null);
      try {
        await flushPendingPublishRequests();
        const manifestPayload = buildManifestPayload(overrides);
        const base64 = await objectToBase64(manifestPayload);
        const publisherAddress = await resolvePublisherAddress();
        const { publicKeys } = await collectRecipientPublicKeys({
          includeSelf: true,
          extraAddresses: [publisherAddress],
          usersAllowed: [],
          me: { name: activeName || authName || undefined, address: publisherAddress },
        });
        if (!publicKeys.length) throw new Error('Unable to resolve your public key.');
        const encrypted = await qortalRequest({
          action: 'ENCRYPT_DATA',
          base64,
          publicKeys,
        });
        const privateData64 = applyPrivateMagicIfNeeded(encrypted);
        const manifestTags = buildEncryptionTagSet({
          mode: 'direct',
          publisher: publisherAddress,
          userCount: 1,
        }).concat('qassets-manifest');
        await publishResources([
          {
            name: activeName,
            service: MANIFEST_SERVICE as Service,
            identifier: MANIFEST_IDENTIFIER,
            base64: privateData64,
            title: 'Q-Assets Manifest',
            description: 'Aggregated service and folder metadata for faster browsing.',
            tags: manifestTags,
            // disableEncrypt: true,
            privateMode: 'direct',
          },
        ]);
        setManifestRefreshBlockedUntil(Date.now() + MANIFEST_REFRESH_COOLDOWN);
        applyManifestState(manifestPayload, false, 'success');
      } catch (e: any) {
        setManifestError(e?.message || 'Manifest publish failed');
      } finally {
        setManifestPublishing(false);
      }
    },
    [
      activeName,
      authName,
      buildManifestPayload,
      publishResources,
      resolvePublisherAddress,
      flushPendingPublishRequests,
      applyManifestState,
    ]
  );

  const openShareDialogForResources = (resources: QdnResource[]) => {
    if (!resources.length) return;
    setShareTargets(resources);
    setShareDialog({ open: true, mode: 'group' });
    setShareSelectedGroups([]);
    setShareNames('');
    setShareStatus(null);
  };

  const handleShareOpen = () => {
    if (!selectedResource) return;
    openShareDialogForResources([selectedResource]);
  };

  const handleShareClose = () => {
    if (shareLoading) return;
    setShareDialog({ open: false, mode: 'group' });
    setShareSelectedGroups([]);
    setShareNames('');
    setShareStatus(null);
    setShareTargets([]);
  };

  const handleShareSubmit = async () => {
    const targets =
      shareTargets.length > 0 ? shareTargets : selectedResource ? [selectedResource] : [];
    if (!targets.length) {
      setShareStatus('Select at least one resource to share.');
      return;
    }
    const publisherName = activeName || authName || targets[0].name;
    if (!publisherName) {
      setShareStatus('Select or resolve a Qortal name to publish under.');
      return;
    }
    const directRecipients = parseRecipientList(shareNames);
    if (!shareSelectedGroups.length && !directRecipients.length) {
      setShareStatus('Select at least one group or name to share with.');
      return;
    }
    let directNotificationRecipients: NotificationRecipient[] = [];
    setShareLoading(true);
    setShareStatus(null);
    try {
      const privateGroups = shareSelectedGroups.filter((id) => {
        const grp = groups.find((g) => g.groupId === id);
        return grp ? !grp.isOpen : false;
      });
      const publicGroups = shareSelectedGroups.filter((id) => {
        const grp = groups.find((g) => g.groupId === id);
        return grp ? grp.isOpen : false;
      });
      const shareRequests: BatchPublishResource[] = [];
      const publisherAddress = userAddress || (await resolvePublisherAddress());
      for (const resource of targets) {
        const base64 = await resolveResourceBase64(resource);
        const metadataBase = {
          ...(resource.metadata || {}),
          qassetsShare: {
            original: {
              name: resource.name,
              service: resource.service,
              identifier: resource.identifier,
            },
            sharedAt: Date.now(),
          },
        };
        const tagsBase: string[] = Array.isArray((resource.metadata as any)?.tags)
          ? ([...(resource.metadata as any).tags] as string[])
          : [];
        if (!tagsBase.includes('qassets-share')) tagsBase.push('qassets-share');

        for (const gid of privateGroups) {
          const enc = await qortalRequest({
            action: 'ENCRYPT_QORTAL_GROUP_DATA',
            base64,
            groupId: gid,
            isAdmins: false,
          });
          const service = resolveServiceForEncryptionMode(resource.service, 'group');
          const privData = applyPrivateMagicIfNeeded(enc);
          const shareTags = buildEncryptionTagSet({
            mode: 'group',
            publisher: publisherAddress,
            groupId: gid,
          }).concat(`share:group:${gid}`);
          shareRequests.push({
            name: publisherName,
            service,
            identifier: `${resource.identifier}-g${gid}-${uniqueId6()}`,
            base64: privData,
            title: resource.metadata?.title,
            description: resource.metadata?.description,
            tags: [...shareTags, ...tagsBase],
            // disableEncrypt: true,
            privateMode: 'group',
            metadata: {
              ...metadataBase,
              qassetsShareTarget: { type: 'group', groupId: gid },
            },
          });
        }

        if (publicGroups.length || directRecipients.length) {
          const { publicKeys, included } = await collectRecipientPublicKeys({
            groupIds: publicGroups,
            usersAllowed: directRecipients,
            includeSelf: true,
            me: { name: publisherName, address: publisherAddress },
          });
          if (!publicKeys.length) throw new Error('No recipient keys resolved.');
          directNotificationRecipients = included
            .filter((entry) => entry.source === 'usersAllowed' && entry.name && entry.publicKey)
            .map((entry) => ({
              name: entry.name as string,
              address: entry.address,
              publicKey: entry.publicKey,
            }));
          const enc = await qortalRequest({
            action: 'ENCRYPT_DATA',
            base64,
            publicKeys,
          });
          const service = resolveServiceForEncryptionMode(resource.service, 'direct');
          const shareTags = buildEncryptionTagSet({
            mode: 'direct',
            publisher: publisherAddress,
            userCount: publicKeys.length || 1,
          }).concat('share:direct');
          shareRequests.push({
            name: publisherName,
            service,
            identifier: `${resource.identifier}-direct-${uniqueId6()}`,
            base64: enc,
            title: resource.metadata?.title,
            description: resource.metadata?.description,
            tags: [...shareTags, ...tagsBase],
            // disableEncrypt: true,
            privateMode: 'direct',
            metadata: {
              ...metadataBase,
              qassetsShareTarget: { type: 'direct', groups: publicGroups, names: directRecipients },
            },
          });
        }
      }

      if (shareRequests.length) {
        await publishResources(shareRequests);
      }

      try {
        const publisherAddress = userAddress || (await resolvePublisherAddress());
        const uniqueGroups = Array.from(new Set(shareSelectedGroups));
        const firstIdentifier = targets[0]?.identifier;
        const shareCount = targets.length;
        const shareTitle = shareCount > 1 ? 'New private shares' : 'New private share';
        const publisherLabel = publisherName || publisherAddress || 'A Qortal user';
        const shareBody = [
          `<p>${publisherLabel} shared ${shareCount > 1 ? `${shareCount} private resources` : 'a private resource'} with you via Q-Assets.</p>`,
          '<p>Open Q-Assets → Manage → Data → Shares to view the content.</p>',
          firstIdentifier ? `<p>Reference: ${firstIdentifier}</p>` : '',
        ]
          .filter(Boolean)
          .join('');
        const shareLinks = [
          {
            label: 'Open Data Explorer shares',
            href: 'qortal://APP/Q-Assets/manage/data/explorer?section=shares',
          },
        ];
        const notificationPublisher = {
          name: publisherName || undefined,
          address: publisherAddress,
        };
        const notificationTasks: Promise<unknown>[] = [];
        uniqueGroups.forEach((groupId) => {
          notificationTasks.push(
            sendNotification({
              scope: { kind: 'group', groupId },
              title: shareTitle,
              bodyHtml: shareBody,
              publisher: notificationPublisher,
              links: shareLinks,
              deliveries: { internal: { enabled: true } },
            })
          );
        });
        if (directNotificationRecipients.length) {
          notificationTasks.push(
            sendNotification({
              scope: { kind: 'custom', key: `share-direct-${Date.now()}` },
              title: shareTitle,
              bodyHtml: shareBody,
              publisher: notificationPublisher,
              links: shareLinks,
              deliveries: {
                internal: { enabled: false },
                qmail: {
                  enabled: true,
                  recipients: directNotificationRecipients,
                  subject: `Q-Assets: ${shareCount > 1 ? 'New shares' : 'New share'} from ${publisherLabel}`,
                },
              },
            })
          );
        }
        if (notificationTasks.length) {
          await Promise.all(notificationTasks);
        }
      } catch (notificationError) {
        console.warn('Share notifications failed', notificationError);
      }

      await refreshResources();
      handleShareClose();
    } catch (e: any) {
      setShareStatus(e?.message || 'Share failed');
    } finally {
      setShareLoading(false);
    }
  };

  const saveResourceToSystem = async (
    resource: QdnResource,
    entry: StructuredEntry | null,
    statusPrefix = 'Saved to your system.'
  ) => {
    setSystemSaveLoading(true);
    setSystemSaveStatus(null);
    try {
      const loaded = await ensureResourceContent(resource);
      const cleanName =
        entry?.fileName || resource.identifier.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'resource';
      const byteArray = base64ToUint8Array(loaded.base64);
      const blob = new Blob([byteArray], { type: loaded.mime || 'application/octet-stream' });
      await qortalRequest({
        action: 'SAVE_FILE',
        blob,
        filename: cleanName,
        mimeType: loaded.mime,
      } as any);
      setSystemSaveStatus(statusPrefix);
    } catch (e: any) {
      setSystemSaveStatus(e?.message || 'Failed to save file.');
    } finally {
      setSystemSaveLoading(false);
    }
  };

  const handleSaveToSystem = async () => {
    if (!selectedResource) return;
    await saveResourceToSystem(selectedResource, selectedStructuredEntry);
  };

  const handlePreviewSaveToSystem = async () => {
    if (!previewDialog.resource) return;
    const entry = allStructuredEntryMap.get(previewDialog.resource.identifier) || null;
    await saveResourceToSystem(previewDialog.resource, entry, 'Saved preview to your system.');
  };

  const handleSelectNameSuggestion = (suggestion: string) => {
    const parts = shareNames.split(',');
    parts[parts.length - 1] = suggestion;
    const normalized = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
    setShareNames(normalized);
    setNameSuggestions([]);
  };

  const handleBulkShare = () => {
    if (!bulkSelectedResources.length) {
      alert('Select at least one resource to share.');
      return;
    }
    openShareDialogForResources(bulkSelectedResources);
    handleClearSelection();
  };

  const handleBulkMove = () => {
    if (!movableEntries.length) {
      alert('Select structured files to move.');
      return;
    }
    openMoveDialogForEntries(movableEntries);
    handleClearSelection();
  };

  const handleBulkPreview = () => {
    const firstId = selectedResourceIds[0];
    if (firstId) {
      const resource = combinedResources.find((res) => res.identifier === firstId);
      if (resource) {
        handlePreviewResource(resource);
        return;
      }
    }
    if (selectedResource) handlePreviewResource(selectedResource);
    handleClearSelection();
  };

  const handleBulkDelete = () => {
    if (selectedStructuredEntries.length) {
      void handleDeleteFilesCopy(selectedStructuredEntries);
      handleClearSelection();
      return;
    }
    if (bulkSelectedResources.length) {
      void handleDeleteServiceResources();
      handleClearSelection();
      return;
    }
    alert('Select at least one resource to delete.');
  };

  const handleBulkSaveToSystem = async () => {
    const targets = selectedResourceIds.length
      ? selectedResourceIds
      : selectedResource
        ? [selectedResource.identifier]
        : [];
    if (!targets.length) {
      alert('Select at least one resource.');
      return;
    }
    for (const id of targets) {
      const resource = combinedResources.find((res) => res.identifier === id);
      if (!resource) continue;
      const entry = allStructuredEntryMap.get(id) || null;
      await saveResourceToSystem(resource, entry);
    }
    setSystemSaveStatus('Saved selection to your system.');
    handleClearSelection();
  };

  const [contextMenu, setContextMenu] = useState<{
    anchorEl: HTMLElement | null;
    resource: QdnResource | null;
  }>({ anchorEl: null, resource: null });

  const handleContextMenuOpen = (event: React.MouseEvent<HTMLElement>, resource: QdnResource) => {
    event.preventDefault();
    setSelectedResourceId(resource.identifier);
    setContextMenu({ anchorEl: event.currentTarget, resource });
  };

  const handleContextMenuClose = () => setContextMenu({ anchorEl: null, resource: null });

  const handleContextPreview = () => {
    if (contextMenu.resource) handlePreviewResource(contextMenu.resource);
    handleContextMenuClose();
  };

  const handleContextMove = () => {
    if (!contextMenu.resource) return handleContextMenuClose();
    const entry = allStructuredEntryMap.get(contextMenu.resource.identifier);
    if (entry) openMoveDialogForEntries([entry]);
    handleContextMenuClose();
  };

  const handleContextRename = () => {
    if (!contextMenu.resource) return handleContextMenuClose();
    const entry = allStructuredEntryMap.get(contextMenu.resource.identifier);
    if (entry) handleManifestDialogOpen(entry);
    handleContextMenuClose();
  };

  const handleContextDelete = () => {
    if (!contextMenu.resource) return handleContextMenuClose();
    const entry = allStructuredEntryMap.get(contextMenu.resource.identifier);
    if (entry) void handleDeleteFilesCopy([entry]);
    else void handleDeleteServiceResources([contextMenu.resource]);
    handleContextMenuClose();
  };

  const handleRemoveFromFiles = async () => {
    if (!selectedStructuredEntry) return;
    setFilesActionLoading('remove');
    setSystemSaveStatus(null);
    try {
      const { base64 } = await ensureResourceContent(selectedStructuredEntry.resource, {
        skipCache: true,
      });
      const { metadata, tags } = stripStructuredMetadata(selectedStructuredEntry.resource);
      await republishWithMetadata({
        resource: selectedStructuredEntry.resource,
        base64,
        metadata,
        tags,
      });
      await refreshResources();
      setSystemSaveStatus('Removed from Files.');
    } catch (e: any) {
      setSystemSaveStatus(e?.message || 'Failed to remove from Files.');
    } finally {
      setFilesActionLoading(null);
    }
  };

  const applyManifestDeletes = useCallback(
    async (removedIdentifiers: string[]) => {
      if (!removedIdentifiers.length) return;
      if (publishMode === 'immediate') {
        await handlePublishManifest({
          removeStructuredIdentifiers: removedIdentifiers,
          removeResourceIdentifiers: removedIdentifiers,
        });
        return;
      }
      setManifestDoc((prev) => {
        if (!prev) return prev;
        const nextStructured = prev.structuredFiles
          ? prev.structuredFiles.filter((entry) => !removedIdentifiers.includes(entry.identifier))
          : prev.structuredFiles;
        const nextResources = prev.resources
          ? prev.resources.filter((entry) => !removedIdentifiers.includes(entry.identifier))
          : prev.resources;
        if (nextStructured === prev.structuredFiles && nextResources === prev.resources) {
          return prev;
        }
        return { ...prev, structuredFiles: nextStructured, resources: nextResources };
      });
      setManifestDirty(true);
    },
    [publishMode, handlePublishManifest]
  );

  const prunePendingMoves = useCallback(
    (removedIdentifiers: string[]) => {
      if (!removedIdentifiers.length) return;
      setPendingMoves((prev) => {
        if (!Object.keys(prev).length) return prev;
        const next = { ...prev };
        let changed = false;
        removedIdentifiers.forEach((id) => {
          if (next[id]) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    },
    [setPendingMoves]
  );

  const handleDeleteFilesCopy = async (entries?: StructuredEntry[]) => {
    const primaryEntry = selectedStructuredEntry;
    const bulkEntries = entries
      ? entries
      : selectedResourceIds
          .map((id) => allStructuredEntryMap.get(id) || null)
          .filter((entry): entry is StructuredEntry => Boolean(entry));
    const targets = bulkEntries.length > 0 ? bulkEntries : primaryEntry ? [primaryEntry] : [];
    if (!targets.length) return;
    setFilesActionLoading('delete');
    setSystemSaveStatus(null);
    setPendingDeletes((prev) => {
      const set = new Set(prev);
      targets.forEach((entry) => set.add(entry.resource.identifier));
      return Array.from(set);
    });
    try {
      const resources: BatchPublishResource[] = [];
      const removedIdentifiers: string[] = [];
      for (const entry of targets) {
        const deletedAt = Date.now();
        const tombstone = {
          qassets: { tombstone: true, version: 1 },
          deleted: true,
          deletedAt,
          name: entry.resource.name,
          service: entry.resource.service,
          identifier: entry.resource.identifier,
          reason: 'user-delete',
        };
        const base64 = await objectToBase64(tombstone);
        removedIdentifiers.push(entry.resource.identifier);
        const metadata = {
          tags: ['qassets-tombstone'],
          qassetsTombstone: {
            version: 1,
            deleted: true,
            deletedAt,
            reason: 'user-delete',
            path: entry.folderSegments.join('/'),
            fileName: entry.fileName,
          },
        };
        resources.push({
          name: entry.resource.name,
          service: entry.resource.service as Service,
          identifier: entry.resource.identifier,
          base64,
          title: 'TOMBSTONE',
          description: 'Resource removed by publisher',
          metadata,
          tags: ['qassets-tombstone'],
        });
      }
      await queueOrPublishResources(resources);
      await applyManifestDeletes(removedIdentifiers);
      prunePendingMoves(removedIdentifiers);
      setSelectedResourceId(null);
      setSelectedResourceIds((prev) => prev.filter((id) => !removedIdentifiers.includes(id)));
      await refreshResources();
      setPendingDeletes((prev) => prev.filter((id) => !removedIdentifiers.includes(id)));
      const successMsg =
        publishMode === 'batch' ? 'Delete queued for manifest publish.' : 'Deleted Files copy.';
      setSystemSaveStatus(successMsg);
    } catch (e: any) {
      setPendingDeletes((prev) =>
        prev.filter((id) => !targets.some((entry) => entry.resource.identifier === id))
      );
      setSystemSaveStatus(e?.message || 'Failed to delete Files copy.');
    } finally {
      setFilesActionLoading(null);
    }
  };

  const handleDeleteServiceResources = async (resources?: QdnResource[]) => {
    const primaryResource = selectedResource;
    const bulkResources = resources?.length
      ? resources
      : selectedResourceIds.length
        ? bulkSelectedResources
        : primaryResource
          ? [primaryResource]
          : [];
    if (!bulkResources.length) return;
    setFilesActionLoading('delete');
    setSystemSaveStatus(null);
    setPendingDeletes((prev) => {
      const set = new Set(prev);
      bulkResources.forEach((resource) => set.add(resource.identifier));
      return Array.from(set);
    });
    try {
      const requests: BatchPublishResource[] = [];
      const removedIdentifiers: string[] = [];
      for (const resource of bulkResources) {
        const deletedAt = Date.now();
        const entry = allStructuredEntryMap.get(resource.identifier) || null;
        const path =
          entry?.folderSegments.join('/') ||
          resource.metadata?.qassetsFs?.path ||
          resource.metadata?.folderPath ||
          '';
        const fileName =
          entry?.fileName ||
          resource.metadata?.qassetsFs?.fileName ||
          resource.metadata?.title ||
          resource.identifier ||
          'resource';
        const tombstone = {
          qassets: { tombstone: true, version: 1 },
          deleted: true,
          deletedAt,
          name: resource.name,
          service: resource.service,
          identifier: resource.identifier,
          reason: 'user-delete',
        };
        const base64 = await objectToBase64(tombstone);
        removedIdentifiers.push(resource.identifier);
        requests.push({
          name: resource.name,
          service: resource.service as Service,
          identifier: resource.identifier,
          base64,
          title: 'TOMBSTONE',
          description: 'Resource removed by publisher',
          metadata: {
            tags: ['qassets-tombstone'],
            qassetsTombstone: {
              version: 1,
              deleted: true,
              deletedAt,
              reason: 'user-delete',
              path,
              fileName,
            },
          },
          tags: ['qassets-tombstone'],
        });
      }
      await queueOrPublishResources(requests);
      await applyManifestDeletes(removedIdentifiers);
      prunePendingMoves(removedIdentifiers);
      setSelectedResourceId(null);
      setSelectedResourceIds((prev) => prev.filter((id) => !removedIdentifiers.includes(id)));
      await refreshResources();
      setPendingDeletes((prev) => prev.filter((id) => !removedIdentifiers.includes(id)));
      const successMsg =
        publishMode === 'batch' ? 'Delete queued for manifest publish.' : 'Deleted service data.';
      setSystemSaveStatus(successMsg);
    } catch (e: any) {
      setPendingDeletes((prev) =>
        prev.filter((id) => !bulkResources.some((resource) => resource.identifier === id))
      );
      setSystemSaveStatus(e?.message || 'Failed to delete service data.');
    } finally {
      setFilesActionLoading(null);
    }
  };

  const breadcrumbItems = useMemo(() => {
    const crumbs: ReactNode[] = [];
    if (activeName) {
      crumbs.push(
        <Typography
          key="name"
          component="button"
          onClick={() => {
            setActiveSection('services');
            handleServiceNavigate(null);
          }}
          sx={{
            border: 'none',
            background: 'transparent',
            p: 0,
            cursor: activeSection !== 'services' || activeService ? 'pointer' : 'default',
            fontWeight: activeSection === 'services' && !activeService ? 600 : 500,
            color: breadcrumbColor,
          }}
        >
          {activeName}
        </Typography>
      );
    }

    if (activeSection === 'services' && activeService) {
      crumbs.push(
        <Typography key="service" sx={{ color: breadcrumbColor, fontWeight: 600 }}>
          {serviceLabels(activeService)}
        </Typography>
      );
    }

    if (activeSection === 'files') {
      crumbs.push(
        <Typography
          key="files-root"
          component="button"
          onClick={() => handleFolderNavigate('')}
          sx={{
            border: 'none',
            background: 'transparent',
            p: 0,
            cursor: activeFilePath ? 'pointer' : 'default',
            fontWeight: activeFilePath ? 500 : 600,
            color: breadcrumbColor,
          }}
        >
          Files
        </Typography>
      );
      const segments = normalizePathSegments(activeFilePath);
      segments.forEach((segment, idx) => {
        const pathKey = segments.slice(0, idx + 1).join('/');
        crumbs.push(
          <Typography
            key={`path-${pathKey}`}
            component="button"
            onClick={() => handleFolderNavigate(pathKey)}
            sx={{
              border: 'none',
              background: 'transparent',
              p: 0,
              cursor: idx === segments.length - 1 ? 'default' : 'pointer',
              fontWeight: idx === segments.length - 1 ? 600 : 500,
              color: breadcrumbColor,
            }}
          >
            {segment}
          </Typography>
        );
      });
    }

    if (activeSection === 'shares') {
      crumbs.push(
        <Typography key="shares" sx={{ color: breadcrumbColor, fontWeight: 600 }}>
          Shares
        </Typography>
      );
    }

    return crumbs;
  }, [activeName, activeSection, activeService, activeFilePath]);

  const showServiceGrid = activeSection === 'services' && Boolean(activeName) && !activeService;
  const showResourceGrid =
    activeSection === 'services' && Boolean(activeName) && Boolean(activeService);
  const showShareGrid = activeSection === 'shares' && Boolean(activeName);
  const showFilesGrid = activeSection === 'files' && Boolean(activeName);
  const viewingFilesEntry = activeSection === 'files' && Boolean(selectedStructuredEntry);
  const cardTitle =
    activeSection === 'files'
      ? activeFilePath
        ? activeFilePath.split('/').slice(-1)[0] || 'Files workspace'
        : 'Files workspace'
      : activeSection === 'shares'
        ? 'Shared resources'
        : activeService
          ? serviceLabels(activeService)
          : activeName || 'Select a name';

  const serviceTotalPages = Math.max(1, Math.ceil(activeResources.length / SERVICE_PAGE_SIZE));
  const pagedActiveResources = useMemo(() => {
    const start = (servicePage - 1) * SERVICE_PAGE_SIZE;
    return activeResources.slice(start, start + SERVICE_PAGE_SIZE);
  }, [activeResources, servicePage]);

  const shareTotalPages = Math.max(1, Math.ceil(filteredShareResources.length / SERVICE_PAGE_SIZE));
  const safeSharePage = Math.min(sharePage, shareTotalPages);
  const pagedShareResources = useMemo(() => {
    const start = (safeSharePage - 1) * SERVICE_PAGE_SIZE;
    return filteredShareResources.slice(start, start + SERVICE_PAGE_SIZE);
  }, [filteredShareResources, safeSharePage]);

  const folderTotalPages = Math.max(1, Math.ceil(sortedFolderFiles.length / FOLDER_PAGE_SIZE));
  const pagedFolderFiles = useMemo(() => {
    const start = (folderPage - 1) * FOLDER_PAGE_SIZE;
    return sortedFolderFiles.slice(start, start + FOLDER_PAGE_SIZE);
  }, [sortedFolderFiles, folderPage]);

  const handleSelectAllVisible = useCallback(() => {
    const ids =
      activeSection === 'files'
        ? sortedFolderFiles.map((entry) => entry.resource.identifier)
        : activeSection === 'services' && activeService
          ? pagedActiveResources.map((res) => res.identifier)
          : activeSection === 'shares'
            ? pagedShareResources.map((res) => res.identifier)
            : [];
    setSelectedResourceIds(ids);
  }, [activeSection, activeService, sortedFolderFiles, pagedActiveResources, pagedShareResources]);

  return (
    <Box sx={{ px: { xs: 1.25, md: 2.5 }, py: { xs: 1.5, md: 3 }, width: '100%' }}>
      <ExplorerHeader
        activeName={activeName}
        manifestDoc={manifestDoc}
        manifestDirty={manifestDirty}
        manifestPublishing={manifestPublishing}
        manifestError={manifestError}
        onPublishManifest={handlePublishManifest}
      />

      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={2.5}
        sx={{ mt: 2, alignItems: 'stretch', minHeight: { lg: 'calc(100vh - 180px)' } }}
      >
        <ExplorerSidebar
          entries={orderedEntries}
          activeName={activeName}
          namesLoading={namesLoading}
          namesError={namesError}
          serviceBuckets={serviceBuckets}
          activeSection={activeSection}
          activeService={activeService}
          activeFilePath={activeFilePath}
          visibleStructuredCount={visibleStructuredEntries.length}
          shareCount={shareCount}
          folderMap={folderMap}
          onSelectName={handleSelectName}
          onReloadNames={reloadNames}
          onServiceNavigate={handleServiceNavigate}
          onFolderNavigate={handleFolderNavigate}
          onShareNavigate={handleShareNavigate}
        />

        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ xs: 'flex-start', md: 'center' }}
              justifyContent="space-between"
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ color: breadcrumbColor }}>
                  {cardTitle}
                </Typography>
                {activeName && (
                  <Breadcrumbs separator="›" sx={{ mt: 0.5 }}>
                    {breadcrumbItems.length ? (
                      breadcrumbItems
                    ) : (
                      <Typography sx={{ color: breadcrumbColor }}>Select a service</Typography>
                    )}
                  </Breadcrumbs>
                )}
              </Box>
              <Box
                sx={{
                  flex: { xs: 'auto', md: 1 },
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    px: 2.5,
                    py: 1.25,
                    minWidth: 220,
                    maxWidth: 320,
                    width: '100%',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      top: -10,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      bgcolor: 'background.paper',
                      px: 1.5,
                    }}
                  >
                    Publish mode
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    value={publishMode}
                    exclusive
                    onChange={(_event, value) => value && setPublishMode(value)}
                  >
                    <ToggleButton value="immediate">Real-Time Update Publishing</ToggleButton>
                    <ToggleButton value="batch">Queue Update Publishing</ToggleButton>
                  </ToggleButtonGroup>
                  {publishMode === 'batch' && (
                    <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => void handlePublishManifest()}
                        disabled={!manifestDirty || manifestPublishing || !activeName}
                        sx={{ flex: 3 }}
                      >
                        {manifestPublishing ? 'Publishing…' : 'Publish queued changes'}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        onClick={clearQueuedChanges}
                        disabled={!hasQueuedChanges}
                        sx={{ flex: 1 }}
                      >
                        Clear queued
                      </Button>
                    </Box>
                  )}
                </Box>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Button
                  variant="contained"
                  startIcon={<PublishRoundedIcon />}
                  onClick={handleOpenPublishMenu}
                  disabled={!activeName}
                >
                  Publish new files/folders
                </Button>
                <Tooltip title="Refresh current folder">
                  <span>
                    <IconButton
                      onClick={handleLoadFromNetwork}
                      disabled={!activeName || resourcesLoading}
                    >
                      <RefreshRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
              <TextField
                placeholder="Search identifiers, titles, services…"
                size="small"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                size="small"
                label="Sort"
                value={resourceSort}
                onChange={(event) => setResourceSort(event.target.value as ResourceSort)}
                sx={{ minWidth: { xs: '100%', md: 190 } }}
              >
                {RESOURCE_SORT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              {activeSection === 'files' && (
                <TextField
                  size="small"
                  label="Folder"
                  value={`/${activeFilePath}`}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1, minWidth: { xs: '100%', md: 220 } }}
                />
              )}
              {canLoadMore && activeService && (
                <Button
                  onClick={handleLoadRemaining}
                  disabled={resourcesLoading || loadingAllPages}
                >
                  {loadingAllPages ? 'Loading…' : 'Load remaining'}
                </Button>
              )}
              {activeName && manifestLoadState === 'success' && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleLoadFromNetwork}
                  disabled={resourcesLoading || loadingAllPages}
                >
                  {loadingAllPages ? 'Loading…' : 'Load from network'}
                </Button>
              )}
            </Stack>

            {manifestBoundaryReached && hasMore && !ignoreManifestCache && (
              <Alert
                severity="info"
                sx={{ mt: 2 }}
                action={
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    onClick={handleLoadFromNetwork}
                    disabled={resourcesLoading || loadingAllPages}
                  >
                    {loadingAllPages ? 'Loading…' : 'Load from network'}
                  </Button>
                }
              >
                Showing cached manifest data only. Load directly from the network to rebuild the
                full list.
              </Alert>
            )}

            {resourcesError && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {resourcesError}
              </Alert>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5, minHeight: 360 }}>
            {!activeName && (
              <Typography variant="body2" color="text.secondary">
                Select one of your Qortal names to start browsing services and published resources.
              </Typography>
            )}

            {showServiceGrid && (
              <>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Services ({serviceBuckets.length || 0})
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(auto-fit, minmax(140px, 1fr))',
                      sm: 'repeat(auto-fit, minmax(180px, 1fr))',
                    },
                    gap: 1.5,
                  }}
                >
                  {serviceBuckets.map((bucket) => (
                    <Paper
                      key={bucket.service}
                      variant="outlined"
                      onClick={() => handleServiceNavigate(bucket.service)}
                      sx={{
                        p: 1.5,
                        borderRadius: 2.5,
                        cursor: 'pointer',
                        transition: 'transform 120ms ease, box-shadow 120ms ease',
                        '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 },
                      }}
                    >
                      <Stack spacing={1}>
                        <PublicRoundedIcon color="primary" fontSize="large" />
                        <Typography variant="body1" fontWeight={600} noWrap>
                          {bucket.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {bucket.count} resource{bucket.count === 1 ? '' : 's'}
                        </Typography>
                      </Stack>
                    </Paper>
                  ))}
                  {!serviceBuckets.length && !resourcesLoading && (
                    <Typography variant="body2" color="text.secondary">
                      Nothing published yet. Use the Publish button to create your first resource.
                    </Typography>
                  )}
                </Box>
                {canLoadMore && !resourcesLoading && (
                  <Button
                    size="small"
                    sx={{ mt: 1.5 }}
                    onClick={handleLoadRemaining}
                    disabled={loadingAllPages}
                  >
                    {loadingAllPages ? 'Loading…' : 'Load remaining resources'}
                  </Button>
                )}
              </>
            )}

            {showResourceGrid && (
              <>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ mb: 1 }}
                >
                  <Typography variant="subtitle2">
                    {activeResources.length} item{activeResources.length === 1 ? '' : 's'} in{' '}
                    {serviceLabels(activeService!)}
                  </Typography>
                  {canLoadMore && (
                    <Button
                      size="small"
                      onClick={handleLoadRemaining}
                      disabled={resourcesLoading || loadingAllPages}
                    >
                      {loadingAllPages ? 'Loading…' : 'Load remaining'}
                    </Button>
                  )}
                </Stack>

                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    p: 1.5,
                    mb: 1.5,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                    alignItems: 'center',
                  }}
                >
                  {selectedResourceIds.length > 0 ? (
                    <>
                      <Typography variant="body2">{selectedResourceIds.length} selected</Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkSaveToSystem}
                        disabled={!selectedResourceIds.length}
                      >
                        Save to system
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkMove}
                        disabled={!movableEntries.length}
                        sx={{ color: moveColor, borderColor: moveColor }}
                      >
                        Move
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkPreview}
                        disabled={!selectedResourceIds.length}
                      >
                        Preview
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkShare}
                        disabled={!bulkSelectedResources.length}
                        sx={{ color: shareColor, borderColor: shareColor }}
                      >
                        Share
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkDelete}
                        disabled={!bulkSelectedResources.length || filesActionLoading === 'delete'}
                        color="error"
                      >
                        {deleteSelectionLabel}
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleSelectAllVisible}>
                        Select all in folder
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleClearSelection}>
                        Clear
                      </Button>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Select resources to enable bulk actions.
                    </Typography>
                  )}
                </Paper>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(auto-fit, minmax(220px, 1fr))',
                      sm: 'repeat(auto-fit, minmax(260px, 1fr))',
                    },
                    gap: 1.25,
                  }}
                >
                  {pagedActiveResources.map((resource) => {
                    const isSelected = resource.identifier === selectedResourceId;
                    const isChecked = selectedResourceSet.has(resource.identifier);
                    const mime = resolveMimeForResource(resource, manifestDoc, detectedTypes);
                    const icon = getIconForMime(mime);
                    const displayTags = getDisplayTags(resource);
                    const createdAt = getResourceCreatedAt(resource);
                    return (
                      <Paper
                        key={resource.identifier}
                        variant="outlined"
                        onClick={() => setSelectedResourceId(resource.identifier)}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          handlePreviewResource(resource);
                        }}
                        onContextMenu={(event) => handleContextMenuOpen(event, resource)}
                        sx={{
                          p: 1.5,
                          borderRadius: 2.5,
                          cursor: 'pointer',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          boxShadow: isSelected ? 6 : 1,
                          transition: 'border 120ms ease, box-shadow 120ms ease',
                          position: 'relative',
                        }}
                      >
                        <Checkbox
                          checked={isChecked}
                          onChange={(event) => {
                            event.stopPropagation();
                            handleToggleSelection(resource.identifier);
                          }}
                          sx={{ position: 'absolute', top: 4, right: 4 }}
                        />
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {icon}
                            <Typography variant="subtitle2" noWrap>
                              {getResourceLabel(resource)}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {resource.identifier}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" label={mime} />
                            <Chip
                              size="small"
                              label={getResourceStatus(resource)}
                              color="success"
                              variant="outlined"
                            />
                            {resourceIsPrivate(resource) && (
                              <Chip
                                size="small"
                                label="Private"
                                color="secondary"
                                variant="outlined"
                              />
                            )}
                            {isNewResource(resource) && (
                              <Chip size="small" label="New" color="info" variant="outlined" />
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(resource.size)} • {formatDate(createdAt)}
                          </Typography>
                          {displayTags.length > 0 && (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                              {displayTags.map((tag) => (
                                <Chip key={tag} size="small" label={tag} variant="outlined" />
                              ))}
                            </Stack>
                          )}
                        </Stack>
                      </Paper>
                    );
                  })}
                  {!activeResources.length && !resourcesLoading && (
                    <Typography variant="body2" color="text.secondary">
                      No resources match the current search.
                    </Typography>
                  )}
                </Box>
                {serviceTotalPages > 1 && (
                  <Pagination
                    count={serviceTotalPages}
                    page={Math.min(servicePage, serviceTotalPages)}
                    onChange={(_event, page) => setServicePage(page)}
                    size="small"
                    sx={{ mt: 1.5 }}
                  />
                )}
              </>
            )}

            {showShareGrid && (
              <>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ mb: 1 }}
                >
                  <Typography variant="subtitle2">
                    {filteredShareResources.length} shared item
                    {filteredShareResources.length === 1 ? '' : 's'}
                  </Typography>
                  {canLoadMore && (
                    <Button
                      size="small"
                      onClick={handleLoadRemaining}
                      disabled={resourcesLoading || loadingAllPages}
                    >
                      {loadingAllPages ? 'Loading…' : 'Load remaining'}
                    </Button>
                  )}
                </Stack>

                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    p: 1.5,
                    mb: 1.5,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                    alignItems: 'center',
                  }}
                >
                  {selectedResourceIds.length > 0 ? (
                    <>
                      <Typography variant="body2">{selectedResourceIds.length} selected</Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkSaveToSystem}
                        disabled={!selectedResourceIds.length}
                      >
                        Save to system
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkMove}
                        disabled={!movableEntries.length}
                        sx={{ color: moveColor, borderColor: moveColor }}
                      >
                        Move
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleBulkPreview}>
                        Preview
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkShare}
                        disabled={!bulkSelectedResources.length}
                        sx={{ color: shareColor, borderColor: shareColor }}
                      >
                        Share
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkDelete}
                        disabled={!bulkSelectedResources.length || filesActionLoading === 'delete'}
                        color="error"
                      >
                        {deleteSelectionLabel}
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleSelectAllVisible}>
                        Select all in folder
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleClearSelection}>
                        Clear
                      </Button>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Select shared resources to enable bulk actions.
                    </Typography>
                  )}
                </Paper>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(auto-fit, minmax(220px, 1fr))',
                      sm: 'repeat(auto-fit, minmax(260px, 1fr))',
                    },
                    gap: 1.25,
                  }}
                >
                  {pagedShareResources.map((resource) => {
                    const isSelected = resource.identifier === selectedResourceId;
                    const isChecked = selectedResourceSet.has(resource.identifier);
                    const mime = resolveMimeForResource(resource, manifestDoc, detectedTypes);
                    const icon = getIconForMime(mime);
                    const displayTags = getDisplayTags(resource);
                    const createdAt = getResourceCreatedAt(resource);
                    return (
                      <Paper
                        key={resource.identifier}
                        variant="outlined"
                        onClick={() => setSelectedResourceId(resource.identifier)}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          handlePreviewResource(resource);
                        }}
                        onContextMenu={(event) => handleContextMenuOpen(event, resource)}
                        sx={{
                          p: 1.5,
                          borderRadius: 2.5,
                          cursor: 'pointer',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          boxShadow: isSelected ? 6 : 1,
                          transition: 'border 120ms ease, box-shadow 120ms ease',
                          position: 'relative',
                        }}
                      >
                        <Checkbox
                          checked={isChecked}
                          onChange={(event) => {
                            event.stopPropagation();
                            handleToggleSelection(resource.identifier);
                          }}
                          sx={{ position: 'absolute', top: 4, right: 4 }}
                        />
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {icon}
                            <Typography variant="subtitle2" noWrap>
                              {getResourceLabel(resource)}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {resource.identifier}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" label={mime} />
                            <Chip
                              size="small"
                              label={getResourceStatus(resource)}
                              color="success"
                              variant="outlined"
                            />
                            <Chip size="small" label="Shared" color="info" variant="outlined" />
                            {isNewResource(resource) && (
                              <Chip size="small" label="New" color="info" variant="outlined" />
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(resource.size)} • {formatDate(createdAt)}
                          </Typography>
                          {displayTags.length > 0 && (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                              {displayTags.map((tag) => (
                                <Chip key={tag} size="small" label={tag} variant="outlined" />
                              ))}
                            </Stack>
                          )}
                        </Stack>
                      </Paper>
                    );
                  })}
                  {!filteredShareResources.length && !resourcesLoading && (
                    <Typography variant="body2" color="text.secondary">
                      No shared resources match the current search.
                    </Typography>
                  )}
                </Box>
                {shareTotalPages > 1 && (
                  <Pagination
                    count={shareTotalPages}
                    page={safeSharePage}
                    onChange={(_event, page) => setSharePage(page)}
                    size="small"
                    sx={{ mt: 1.5 }}
                  />
                )}
              </>
            )}

            {showFilesGrid && (
              <>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ mb: 1 }}
                >
                  <Typography variant="subtitle2">
                    {childFolders.length} folder{childFolders.length === 1 ? '' : 's'} •{' '}
                    {currentFolder.files.length} file
                    {currentFolder.files.length === 1 ? '' : 's'}
                  </Typography>
                  {canLoadMore && (
                    <Button
                      size="small"
                      onClick={handleLoadRemaining}
                      disabled={resourcesLoading || loadingAllPages}
                    >
                      {loadingAllPages ? 'Loading…' : 'Load remaining'}
                    </Button>
                  )}
                </Stack>

                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    p: 1.5,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                    alignItems: 'center',
                    mb: 1.5,
                  }}
                >
                  {selectedResourceIds.length > 0 ? (
                    <>
                      <Typography variant="body2">{selectedResourceIds.length} selected</Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkSaveToSystem}
                        disabled={!selectedResourceIds.length}
                      >
                        Save to system
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkMove}
                        disabled={!movableEntries.length}
                        sx={{ color: moveColor, borderColor: moveColor }}
                      >
                        Move selected to folder
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleBulkPreview}>
                        Preview
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkShare}
                        disabled={!bulkSelectedResources.length}
                        sx={{ color: shareColor, borderColor: shareColor }}
                      >
                        Share
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleBulkDelete}
                        disabled={!bulkSelectedResources.length || filesActionLoading === 'delete'}
                        color="error"
                      >
                        {deleteSelectionLabel}
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleSelectAllVisible}>
                        Select all in folder
                      </Button>
                      <Button size="small" variant="outlined" onClick={handleClearSelection}>
                        Clear
                      </Button>
                    </>
                  ) : (
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={2}
                      alignItems="flex-start"
                      sx={{ width: '100%', justifyContent: 'space-between' }}
                    >
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          Create folders to organize your published files.
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={handleSelectAllVisible}
                            disabled={!currentFolderHasFiles}
                          >
                            Select all
                          </Button>
                          <Button size="small" variant="contained" onClick={handleCreateFolderOpen}>
                            Create folder
                          </Button>
                        </Stack>
                        {activeSection === 'files' && activeFilePath && (
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={openRenameFolderDialog}
                              disabled={!activeFolderPath}
                            >
                              Rename folder
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={openDeleteFolderDialog}
                              disabled={!activeFolderPath}
                            >
                              Delete folder
                            </Button>
                          </Stack>
                        )}
                      </Stack>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        sx={{ width: { xs: '100%', sm: 'auto' } }}
                      >
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handlePublishManifest()}
                          disabled={manifestPublishing || !activeName}
                          fullWidth
                        >
                          Publish folder snapshot
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={handleFolderDialogOpen}
                          fullWidth
                        >
                          Publish system folder
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Paper>

                <Stack spacing={2}>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'repeat(auto-fit, minmax(140px, 1fr))',
                        sm: 'repeat(auto-fit, minmax(180px, 1fr))',
                      },
                      gap: 1.25,
                    }}
                  >
                    {childFolders.map((folder) => (
                      <Paper
                        key={folder.key}
                        variant="outlined"
                        onClick={() => handleFolderNavigate(folder.key)}
                        sx={{
                          p: 1.25,
                          borderRadius: 2.5,
                          cursor: 'pointer',
                          transition: 'transform 120ms ease, box-shadow 120ms ease',
                          '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 },
                        }}
                      >
                        <Stack spacing={0.5}>
                          <FolderOpenRoundedIcon color="primary" />
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {folder.name || '/'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {folder.childKeys.length} folder
                            {folder.childKeys.length === 1 ? '' : 's'} • {folder.files.length} file
                            {folder.files.length === 1 ? '' : 's'}
                          </Typography>
                        </Stack>
                      </Paper>
                    ))}
                    {!childFolders.length && (
                      <Typography variant="body2" color="text.secondary">
                        No subfolders yet. Publish with a nested folder path to create one.
                      </Typography>
                    )}
                  </Box>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'repeat(auto-fit, minmax(220px, 1fr))',
                        sm: 'repeat(auto-fit, minmax(260px, 1fr))',
                      },
                      gap: 1.25,
                    }}
                  >
                    {pagedFolderFiles.map((entry) => {
                      const { resource, fileName } = entry;
                      const isSelected = resource.identifier === selectedResourceId;
                      const isChecked = selectedResourceSet.has(resource.identifier);
                      const mime = resolveMimeForResource(resource, manifestDoc, detectedTypes);
                      const icon = getIconForMime(mime);
                      const displayTags = getDisplayTags(resource);
                      const createdAt = getResourceCreatedAt(resource);
                      return (
                        <Paper
                          key={resource.identifier}
                          variant="outlined"
                          onClick={() => setSelectedResourceId(resource.identifier)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            handlePreviewResource(resource);
                          }}
                          onContextMenu={(event) => handleContextMenuOpen(event, resource)}
                          sx={{
                            p: 1.5,
                            borderRadius: 2.5,
                            cursor: 'pointer',
                            borderColor: isSelected ? 'primary.main' : 'divider',
                            boxShadow: isSelected ? 6 : 1,
                            transition: 'border 120ms ease, box-shadow 120ms ease',
                            position: 'relative',
                          }}
                        >
                          <Checkbox
                            checked={isChecked}
                            onChange={(event) => {
                              event.stopPropagation();
                              handleToggleSelection(resource.identifier);
                            }}
                            sx={{ position: 'absolute', top: 4, right: 4 }}
                          />
                          <Stack spacing={1}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              {icon}
                              <Typography variant="subtitle2" noWrap>
                                {fileName}
                              </Typography>
                            </Stack>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {resource.identifier}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                              <Chip size="small" label={mime} />
                              <Chip
                                size="small"
                                label={getResourceStatus(resource)}
                                color="success"
                                variant="outlined"
                              />
                              {entry.isPrivate && (
                                <Chip
                                  size="small"
                                  label="Private"
                                  color="secondary"
                                  variant="outlined"
                                />
                              )}
                              {isNewResource(resource) && (
                                <Chip size="small" label="New" color="info" variant="outlined" />
                              )}
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {formatBytes(resource.size)} • {formatDate(createdAt)}
                            </Typography>
                            {displayTags.length > 0 && (
                              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                {displayTags.map((tag) => (
                                  <Chip key={tag} size="small" label={tag} variant="outlined" />
                                ))}
                              </Stack>
                            )}
                          </Stack>
                        </Paper>
                      );
                    })}
                    {!currentFolder.files.length && (
                      <Typography variant="body2" color="text.secondary">
                        No files in this folder. Use the Publish button to add one.
                      </Typography>
                    )}
                  </Box>
                  {folderTotalPages > 1 && (
                    <Pagination
                      count={folderTotalPages}
                      page={Math.min(folderPage, folderTotalPages)}
                      onChange={(_event, page) => setFolderPage(page)}
                      size="small"
                      sx={{ mt: 1.5 }}
                    />
                  )}
                </Stack>
              </>
            )}

            {resourcesLoading && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Loading resources…</Typography>
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle1">Details</Typography>
              {!selectedResource && (
                <Typography variant="body2" color="text.secondary">
                  Select a resource to see metadata, identifiers, and sharing information.
                </Typography>
              )}
              {selectedResource && (
                <Stack spacing={1}>
                  <Typography variant="body1" fontWeight={600}>
                    {getResourceLabel(selectedResource)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedResource.identifier}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    File type: {selectedResourceFileType}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip size="small" label={selectedResourceFileType} />
                    <Chip
                      size="small"
                      label={getResourceStatus(selectedResource)}
                      color="success"
                      variant="outlined"
                    />
                    {resourceIsPrivate(selectedResource) && (
                      <Chip size="small" label="Private" color="secondary" variant="outlined" />
                    )}
                    {isNewResource(selectedResource) && (
                      <Chip size="small" label="New" color="info" variant="outlined" />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Size: {formatBytes(selectedResource.size)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Created: {formatDate(getResourceCreatedAt(selectedResource))}
                  </Typography>
                  {detailTags.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                      {detailTags.map((tag) => (
                        <Chip key={tag} size="small" label={tag} variant="outlined" />
                      ))}
                    </Stack>
                  )}
                  {selectedResource.metadata?.description && (
                    <Typography variant="body2">{selectedResource.metadata.description}</Typography>
                  )}
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        void handlePreviewResource();
                      }}
                    >
                      Preview file
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleShareOpen}
                      sx={{ color: shareColor, borderColor: shareColor }}
                    >
                      Share
                    </Button>
                    {!selectedStructuredEntry && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => {
                          if (selectedResource) {
                            void handleDeleteServiceResources([selectedResource]);
                            handleClearSelection();
                          }
                        }}
                        disabled={filesActionLoading === 'delete'}
                      >
                        {filesActionLoading === 'delete' ? 'Deleting…' : 'Delete service data'}
                      </Button>
                    )}
                    {selectedStructuredEntry && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleManifestDialogOpen(selectedStructuredEntry)}
                      >
                        Rename
                      </Button>
                    )}
                    {viewingFilesEntry ? (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            void handleRemoveFromFiles();
                          }}
                          disabled={filesActionLoading === 'remove'}
                        >
                          {filesActionLoading === 'remove' ? 'Removing…' : 'Remove from files'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => {
                            void handleDeleteFilesCopy();
                          }}
                          disabled={filesActionLoading === 'delete'}
                        >
                          {filesActionLoading === 'delete' ? 'Deleting…' : 'Delete'}
                        </Button>
                      </>
                    ) : (
                      <Button size="small" variant="outlined" onClick={handleSaveToFilesOpen}>
                        Save to files
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleSaveToSystem}
                      disabled={systemSaveLoading}
                    >
                      {systemSaveLoading ? 'Saving…' : 'Save to system'}
                    </Button>
                  </Stack>
                  {systemSaveStatus && (
                    <Typography variant="caption" color="text.secondary">
                      {systemSaveStatus}
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Stack>

      <Menu anchorEl={publishAnchor} open={Boolean(publishAnchor)} onClose={closePublishMenu}>
        <MenuItem
          onClick={() => {
            closePublishMenu();
            handlePublishOpen('single');
          }}
        >
          Publish single resource
        </MenuItem>
        <MenuItem
          onClick={() => {
            closePublishMenu();
            handlePublishOpen('multiple');
          }}
        >
          Publish multiple resources
        </MenuItem>
        <MenuItem
          onClick={() => {
            closePublishMenu();
            handleFolderDialogOpen();
          }}
        >
          Publish system folder
        </MenuItem>
      </Menu>

      <Menu
        open={Boolean(contextMenu.anchorEl)}
        anchorEl={contextMenu.anchorEl}
        onClose={handleContextMenuClose}
      >
        <MenuItem onClick={handleContextPreview}>Preview</MenuItem>
        <MenuItem onClick={handleContextMove}>Move</MenuItem>
        <MenuItem onClick={handleContextRename}>Rename</MenuItem>
        <MenuItem onClick={handleContextDelete}>Delete</MenuItem>
      </Menu>

      <CreateFolderDialog
        open={createFolderDialog.open}
        basePath={createFolderDialog.basePath}
        error={createFolderDialog.error}
        onClose={handleCreateFolderClose}
        onSubmit={handleCreateFolderSubmit}
      />

      <PublishDialog
        open={publishDialog.open}
        variant={publishDialog.variant}
        defaults={publishDialog.defaults}
        publishing={publishing}
        status={publishStatus}
        groups={groups}
        groupsLoading={groupsLoading}
        onClose={handlePublishClose}
        onSubmit={handlePublishSubmit}
        onStatusChange={setPublishStatus}
      />

      <Dialog
        open={renameFolderDialog.open}
        onClose={closeRenameFolderDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Rename folder</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Current folder: /{activeFolderPath || ''}
            </Typography>
            <TextField
              label="New folder name"
              fullWidth
              value={renameFolderDialog.newName}
              onChange={(event) =>
                setRenameFolderDialog((prev) => ({ ...prev, newName: event.target.value }))
              }
            />
            {renameFolderDialog.error && (
              <Alert severity="warning">{renameFolderDialog.error}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRenameFolderDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleFolderRenameConfirm}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteFolderDialogOpen}
        onClose={closeDeleteFolderDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Delete folder</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            This will remove <strong>/{activeFolderPath || ''}</strong> from your manifest and move
            its contents to <strong>/{parentFolderPath || '/'}</strong>.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteFolderDialog}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleFolderDeleteConfirm}>
            Delete folder
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={folderDialogOpen} onClose={handleFolderDialogClose} fullWidth maxWidth="sm">
        <DialogTitle>Publish system folder</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Button variant="outlined" component="label">
              {folderSelection.length ? 'Change folder' : 'Select folder'}
              <input
                type="file"
                hidden
                multiple
                onChange={handleFolderFilesChange}
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                webkitdirectory=""
                directory=""
              />
            </Button>
            {folderSelection.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                {folderRootName || 'Folder'} • {folderSelection.length} file
                {folderSelection.length === 1 ? '' : 's'}
              </Typography>
            )}

            <TextField
              select
              label="Service"
              value={folderService}
              onChange={(event) => setFolderService(event.target.value)}
              fullWidth
            >
              {SERVICE_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Folder path"
              fullWidth
              value={folderTargetPath}
              onChange={(event) => setFolderTargetPath(event.target.value)}
              helperText="Destination path in Q-Assets (e.g. docs/reports). Leave blank for root."
            />

            {folderPublishing && <LinearProgress />}
            {folderStatus && <Alert severity="warning">{folderStatus}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleFolderDialogClose} disabled={folderPublishing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleFolderPublish} disabled={folderPublishing}>
            {folderPublishing ? 'Publishing…' : 'Publish folder'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={previewDialog.open}
        onClose={handlePreviewClose}
        fullWidth
        maxWidth={previewDialog.expanded ? false : 'xl'}
        fullScreen={previewDialog.expanded}
        PaperProps={{
          sx: {
            width: previewDialog.expanded ? '100%' : { xs: '100%', sm: 'min(1100px, 95vw)' },
            minHeight: previewDialog.expanded ? '90vh' : { xs: '60vh', sm: 520 },
            resize: previewDialog.expanded ? 'none' : 'both',
            overflow: previewDialog.expanded ? 'hidden' : 'auto',
          },
        }}
      >
        <DialogTitle>{previewDialog.title || 'Preview'}</DialogTitle>
        <DialogContent
          dividers
          sx={{
            minHeight: previewDialog.expanded ? '60vh' : { xs: '40vh', sm: 360 },
          }}
        >
          <Stack spacing={1.5}>
            {previewDialog.steps.length > 0 && (
              <Stack spacing={0.5}>
                {previewDialog.steps.map((step) => (
                  <Stack
                    key={step.key}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ opacity: step.status === 'pending' ? 0.6 : 1 }}
                  >
                    {step.status === 'active' && <CircularProgress size={12} />}
                    <Typography variant="caption" sx={{ minWidth: 130 }}>
                      {step.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {step.message ||
                        (step.status === 'success'
                          ? 'Done'
                          : step.status === 'error'
                            ? 'Failed'
                            : step.status === 'active'
                              ? 'Working…'
                              : 'Queued')}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
            {previewDialog.loading && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2">Loading preview…</Typography>
              </Stack>
            )}
          </Stack>
          {previewDialog.error && <Alert severity="warning">{previewDialog.error}</Alert>}
          {previewDialog.type === 'text' && (
            <Box
              component="pre"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: previewDialog.expanded ? '65vh' : 400,
                overflow: 'auto',
                resize: previewDialog.expanded ? 'none' : 'vertical',
                fontSize: 13,
                bgcolor: 'background.default',
                p: 1.5,
                borderRadius: 1,
              }}
            >
              {previewDialog.content}
            </Box>
          )}
          {previewDialog.type === 'image' && previewDialog.dataUrl && (
            <Box
              component="img"
              src={previewDialog.dataUrl}
              alt={previewDialog.title}
              onClick={togglePreviewZoom}
              sx={{
                maxWidth: '100%',
                maxHeight: previewDialog.zoomed
                  ? previewDialog.expanded
                    ? '80vh'
                    : 600
                  : previewDialog.expanded
                    ? '70vh'
                    : 500,
                objectFit: previewDialog.zoomed ? 'contain' : 'cover',
                cursor: previewDialog.zoomed ? 'zoom-out' : 'zoom-in',
                borderRadius: 2,
              }}
            />
          )}
          {previewDialog.type === 'video' && previewDialog.resource && (
            <Box
              sx={{
                width: '100%',
                maxWidth: '100%',
                height: previewDialog.expanded ? '70vh' : 420,
              }}
            >
              {previewDialog.videoUrl ? (
                <video
                  ref={previewVideoRef}
                  src={previewDialog.videoUrl}
                  controls
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    borderRadius: 8,
                    backgroundColor: '#000',
                  }}
                />
              ) : (
                <VideoPlayer
                  videoRef={previewVideoRef}
                  qortalVideoResource={{
                    service: previewDialog.resource.service as any,
                    name: previewDialog.resource.name,
                    identifier: previewDialog.resource.identifier,
                  }}
                />
              )}
            </Box>
          )}
          {previewDialog.type === 'binary' && (
            <Typography variant="body2">{previewDialog.content}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={togglePreviewExpanded}>
            {previewDialog.expanded ? 'Exit full view' : 'Expand view'}
          </Button>
          <Button
            onClick={handlePreviewShare}
            disabled={!previewDialog.resource}
            sx={{ color: shareColor }}
          >
            Share
          </Button>
          <Button
            onClick={() => {
              const entry = previewDialog.resource
                ? allStructuredEntryMap.get(previewDialog.resource.identifier)
                : null;
              if (entry) handleManifestDialogOpen(entry);
            }}
            disabled={!previewDialog.resource}
          >
            Rename
          </Button>
          <Button
            onClick={() => {
              const entry = previewDialog.resource
                ? allStructuredEntryMap.get(previewDialog.resource.identifier)
                : null;
              if (entry) openMoveDialogForEntries([entry]);
            }}
            disabled={!previewDialog.resource}
          >
            Move to folder
          </Button>
          <Button
            onClick={() => {
              const entry = previewDialog.resource
                ? allStructuredEntryMap.get(previewDialog.resource.identifier)
                : null;
              if (entry) {
                void handleDeleteFilesCopy([entry]);
                cleanupChunkedVideoPreview();
                setPreviewDialog(createPreviewDialogState());
              }
            }}
            disabled={!previewDialog.resource}
            color="error"
          >
            Delete
          </Button>
          <Button onClick={handlePreviewSaveToSystem} disabled={!previewDialog.resource}>
            Save to system
          </Button>
          <Button onClick={handlePreviewClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <EditManifestDialog
        open={manifestDialog.open}
        entry={manifestDialog.entry}
        saving={manifestDialog.saving}
        error={manifestDialog.error}
        onClose={handleManifestDialogClose}
        onSubmit={handleManifestSave}
      />

      <Dialog
        open={saveToFilesDialog.open}
        onClose={handleSaveToFilesClose}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Save to files</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Publish this resource into your Q-Assets file system for quick access.
            </Typography>
            <TextField
              label="Folder path"
              fullWidth
              value={saveToFilesDialog.folderPath}
              onChange={(event) =>
                setSaveToFilesDialog((prev) => ({ ...prev, folderPath: event.target.value }))
              }
              helperText="Use / to reference existing folders (e.g. projects/contracts). Only single new folders may be created."
            />
            <TextField
              label="File name"
              fullWidth
              value={saveToFilesDialog.fileName}
              onChange={(event) =>
                setSaveToFilesDialog((prev) => ({ ...prev, fileName: event.target.value }))
              }
            />
            <TextField
              label="Description (optional)"
              fullWidth
              multiline
              minRows={2}
              value={saveToFilesDialog.description}
              onChange={(event) =>
                setSaveToFilesDialog((prev) => ({ ...prev, description: event.target.value }))
              }
            />
            {saveToFilesDialog.saving && <LinearProgress />}
            {saveToFilesDialog.error && <Alert severity="warning">{saveToFilesDialog.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSaveToFilesClose} disabled={saveToFilesDialog.saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveToFilesSubmit}
            variant="contained"
            disabled={saveToFilesDialog.saving}
          >
            {saveToFilesDialog.saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <MoveToNewFolderDialog
        open={moveDialog.open}
        entriesCount={moveDialog.entries.length}
        folderOptions={folderOptions}
        folderPath={moveDialog.folderPath}
        saving={moveDialog.saving}
        error={moveDialog.error}
        onClose={handleMoveDialogClose}
        onSubmit={handleMoveSubmit}
        onFolderChange={(value) => setMoveDialog((prev) => ({ ...prev, folderPath: value }))}
      />

      <Dialog open={shareDialog.open} onClose={handleShareClose} fullWidth maxWidth="sm">
        <DialogTitle>Share resource</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Preparing to share {shareTargets.length || 1} resource
              {shareTargets.length === 1 ? '' : 's'}.
            </Typography>
            {groupsLoading ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={16} />
                <Typography variant="body2">Loading groups…</Typography>
              </Stack>
            ) : (
              <>
                <Typography variant="subtitle2">Groups</Typography>
                <Stack spacing={0.5}>
                  {groups.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No groups detected for this account.
                    </Typography>
                  )}
                  {groups.map((g) => (
                    <FormControlLabel
                      key={g.groupId}
                      control={
                        <Switch
                          checked={shareSelectedGroups.includes(g.groupId)}
                          onChange={(_event, checked) =>
                            setShareSelectedGroups((prev) =>
                              checked
                                ? prev.concat(g.groupId)
                                : prev.filter((id) => id !== g.groupId)
                            )
                          }
                        />
                      }
                      label={`${g.groupName} (#${g.groupId}) ${g.isOpen ? '(public)' : '(private)'}`}
                    />
                  ))}
                </Stack>
              </>
            )}
            <TextField
              label="Share with names or addresses"
              fullWidth
              value={shareNames}
              onChange={(event) => setShareNames(event.target.value)}
              helperText="Comma-separated Qortal names or addresses."
              multiline
              minRows={2}
            />
            {nameSearchLoading && (
              <Typography variant="caption" color="text.secondary">
                Searching names…
              </Typography>
            )}
            {nameSuggestions.length > 0 && (
              <Stack spacing={0.5}>
                {nameSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    size="small"
                    onClick={() => handleSelectNameSuggestion(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </Stack>
            )}
            {nameSearchError && <Alert severity="warning">{nameSearchError}</Alert>}
            {shareStatus && (
              <Alert severity={shareStatus.toLowerCase().includes('fail') ? 'warning' : 'success'}>
                {shareStatus}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleShareClose} disabled={shareLoading}>
            Cancel
          </Button>
          <Button onClick={handleShareSubmit} variant="contained" disabled={shareLoading}>
            {shareLoading ? 'Sharing…' : 'Share'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
