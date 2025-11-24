import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
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
import { useAccountNames } from '../../../hooks/useAccountNames';
import { useQdnResources, type QdnResource } from '../../../hooks/useQdnResources';
import {
  fileToBase64,
  objectToBase64,
  base64ToUtf8,
  base64ToUint8Array,
} from '../../../utils/data';
import { uniqueId6 } from '../../../utils/ids';
import {
  addPrivateMagic,
  stripPrivateMagic,
  PRIVATE_MAGIC_B64,
} from '../../../constants/qdeckIdentifiers';
import { collectRecipientPublicKeys } from '../../../utils/qdeckAccess';
import { getAccountGroups, type GroupSummary } from '../../../utils/qortalApi';
import { useAuth } from 'qapp-core';
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
  isPrivateService,
  ensurePrivateService,
  formatBytes,
  formatDate,
  getResourceLabel,
  getResourceStatus,
  getDisplayTags,
  getResourceCreatedAt,
} from './viewHelpers';
import { filterUserTags } from '../../../utils/qdnTags';
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
  type?: 'text' | 'binary' | 'image';
  error?: string;
  loading?: boolean;
  steps: PreviewStep[];
  resource?: QdnResource | null;
  zoomed?: boolean;
  expanded?: boolean;
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
});

const SERVICE_OPTIONS = ALL_QDN_SERVICES;
const PENDING_FOLDERS_KEY = 'qassets_data_pending_folders_v1';
const MAX_FILE_IDENTIFIER_LENGTH = QASSETS_FILE_ID_MAX;
const MANIFEST_SERVICE = ensurePrivateService('DOCUMENT_PRIVATE');
type ResourceSort = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';
const RESOURCE_SORT_OPTIONS: { value: ResourceSort; label: string }[] = [
  { value: 'date-desc', label: 'Date (newest first)' },
  { value: 'date-asc', label: 'Date (oldest first)' },
  { value: 'name-asc', label: 'Name (A to Z)' },
  { value: 'name-desc', label: 'Name (Z to A)' },
];
const getResourceSortKey = (resource: QdnResource) => getResourceCreatedAt(resource) || 0;
const compareResourcesBySort = (a: QdnResource, b: QdnResource, sort: ResourceSort) => {
  if (sort.startsWith('name')) {
    const aName = getResourceLabel(a).toLowerCase();
    const bName = getResourceLabel(b).toLowerCase();
    const result = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    return sort === 'name-desc' ? -result : result;
  }
  const diff = getResourceSortKey(b) - getResourceSortKey(a);
  return sort === 'date-asc' ? -diff : diff;
};
const compareEntriesBySort = (a: StructuredEntry, b: StructuredEntry, sort: ResourceSort) => {
  if (sort.startsWith('name')) {
    const result = a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' });
    return sort === 'name-desc' ? -result : result;
  }
  const diff = getResourceSortKey(b.resource) - getResourceSortKey(a.resource);
  return sort === 'date-asc' ? -diff : diff;
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
  const ext = (resource.identifier.split('.').pop() || '').toLowerCase();
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

const applyPrivateMagicIfNeeded = (base64: string, service?: string) => {
  if (isPrivateService(service)) return base64;
  return hasPrivateMagicPrefix(base64) ? base64 : addPrivateMagic(base64);
};

const stripPrivateMagicIfNeeded = (base64: string, service?: string) => {
  if (!isPrivateService(service) && hasPrivateMagicPrefix(base64)) {
    return stripPrivateMagic(base64);
  }
  return base64;
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
  const meta = (resource.metadata || {}) as any;
  const encryptedMeta = meta.encrypted;
  const shareTarget = meta.qassetsShareTarget;

  let mode: 'group' | 'direct' | null = null;
  let groupId: number | null = null;
  let adminsOnly = false;

  if (encryptedMeta?.mode === 'group') {
    mode = 'group';
    groupId = Number(encryptedMeta.groupId);
    adminsOnly = !!encryptedMeta.adminsOnly;
  } else if (encryptedMeta?.mode === 'direct') {
    mode = 'direct';
  } else if (shareTarget?.type === 'group') {
    mode = 'group';
    groupId = Number(shareTarget.groupId);
  } else if (shareTarget?.type === 'direct') {
    mode = 'direct';
  }

  const encryptedPayload = stripPrivateMagicIfNeeded(encryptedWithMagic, resource.service);

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
    isPrivate: isPrivateService(resource.service),
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
  const title =
    typeof resource.metadata?.title === 'string' ? resource.metadata.title.toLowerCase() : '';
  const desc =
    typeof resource.metadata?.description === 'string'
      ? resource.metadata.description.toLowerCase()
      : '';
  return (
    resource.identifier.toLowerCase().includes(lower) ||
    (resource.service || '').toLowerCase().includes(lower) ||
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

const tryDecryptLegacyBase64 = async (
  base64: string,
  groups: GroupSummary[]
): Promise<string | null> => {
  const payload = hasPrivateMagicPrefix(base64) ? stripPrivateMagic(base64) : base64;
  try {
    const direct = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: payload,
    });
    if (direct) return direct;
  } catch {
    // ignore direct failure; try groups
  }
  const attempts = buildGroupDecryptAttempts(groups);
  return tryGroupDecryptSequence(payload, attempts);
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
        if (isPrivateService(resource.service)) {
          const encrypted = await fetchPrivateBase64(resource);
          onStep?.('fetch', 'success');
          onStep?.('decrypt', 'active');
          base64 = await decryptPrivateBase64(resource, encrypted, groups);
          onStep?.('decrypt', 'success');
        } else {
          base64 = await fetchResourceBase64(resource);
          onStep?.('fetch', 'success');
          if (base64 && hasPrivateMagicPrefix(base64)) {
            onStep?.('decrypt', 'active');
            const legacy = await tryDecryptLegacyBase64(base64, groups);
            if (!legacy) {
              onStep?.('decrypt', 'error', 'Encrypted resource could not be decrypted.');
              throw new Error('Encrypted resource could not be decrypted with your keys.');
            }
            base64 = legacy;
            onStep?.('decrypt', 'success');
          } else {
            onStep?.('decrypt', 'success');
          }
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

export default function DataExplorer() {
  const { address: userAddress, name: authName, authenticateUser } = useAuth();
  const {
    entries,
    loading: namesLoading,
    error: namesError,
    reload: reloadNames,
  } = useAccountNames();
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'services' | 'files' | 'shares'>('services');
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [publishAnchor, setPublishAnchor] = useState<null | HTMLElement>(null);
  const [publishMode, setPublishMode] = useState<'immediate' | 'batch'>('immediate');
  const [resourceSort, setResourceSort] = useState<ResourceSort>('date-desc');
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
  const [manifestDialog, setManifestDialog] = useState<{
    open: boolean;
    entry: StructuredEntry | null;
    folderPath: string;
    fileName: string;
    saving: boolean;
    error: string | null;
  }>({ open: false, entry: null, folderPath: '', fileName: '', saving: false, error: null });
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
  const [pendingMoves, setPendingMoves] = useState<
    Record<string, { path: string; fileName: string }>
  >({});
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  // const [publishQueue, setPublishQueue] = useState<PublishTask[]>([]);
  const { publish: publishResources } = useQdnBatchPublisher();
  const [createFolderDialog, setCreateFolderDialog] = useState<{
    open: boolean;
    basePath: string;
    folderName: string;
    error: string | null;
  }>({ open: false, basePath: '', folderName: '', error: null });
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
  const [manifestDoc, setManifestDoc] = useState<ManifestDoc | null>(null);
  const [manifestDirty, setManifestDirty] = useState(false);
  const [manifestPublishing, setManifestPublishing] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
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
      data64: string;
      metadata: Record<string, any>;
      tags?: string[];
    }) => {
      const { resource, data64, metadata, tags } = params;
      await publishResources([
        {
          name: resource.name,
          service: resource.service as Service,
          identifier: resource.identifier,
          data64,
          metadata,
          tags,
          title: resource.metadata?.title,
          description: resource.metadata?.description,
        },
      ]);
    },
    [publishResources]
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
      folderName: '',
      error: null,
    });
  };

  const handleCreateFolderClose = () => {
    setCreateFolderDialog({ open: false, basePath: '', folderName: '', error: null });
  };

  const handleCreateFolderNameChange = (value: string) => {
    setCreateFolderDialog((prev) => ({ ...prev, folderName: value, error: null }));
  };

  const handleCreateFolderSubmit = () => {
    const name = createFolderDialog.folderName.trim();
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
    setCreateFolderDialog({ open: false, basePath: '', folderName: '', error: null });
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
    if (typeof window === 'undefined' || !activeName) return;
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

  const applyManifestState = useCallback((doc: ManifestDoc | null, dirty: boolean) => {
    setManifestDoc(doc);
    setDetectedTypes(doc?.resourceTypes || {});
    setManifestDirty(dirty);
  }, []);

  const fetchManifestDoc = useCallback(async (): Promise<ManifestDoc | null> => {
    if (!activeName) return null;
    const fetchAndMaybeDecrypt = async (service: Service, decrypt: boolean) => {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: activeName,
        service,
        identifier: MANIFEST_IDENTIFIER,
        encoding: 'base64',
      });
      const data64 = normalizeData64(res);
      if (!data64) return null;
      if (!decrypt) return JSON.parse(base64ToUtf8(data64));
      const payload = stripPrivateMagicIfNeeded(data64, service);
      const clear = await qortalRequest({
        action: 'DECRYPT_DATA',
        encryptedData: payload,
      });
      if (!clear) throw new Error('Unable to decrypt manifest.');
      return JSON.parse(base64ToUtf8(clear));
    };
    try {
      return await fetchAndMaybeDecrypt(MANIFEST_SERVICE as Service, true);
    } catch {
      try {
        return await fetchAndMaybeDecrypt('DOCUMENT' as Service, false);
      } catch {
        return null;
      }
    }
  }, [activeName]);

  const refreshManifestDoc = useCallback(async () => {
    if (!activeName) {
      applyManifestState(null, false);
      return;
    }
    try {
      const doc = await fetchManifestDoc();
      applyManifestState(doc, false);
    } catch {
      applyManifestState(null, true);
    }
  }, [activeName, fetchManifestDoc, applyManifestState]);

  useEffect(() => {
    if (!activeName) {
      applyManifestState(null, false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const doc = await fetchManifestDoc();
        if (!cancelled) applyManifestState(doc, false);
      } catch {
        if (!cancelled) applyManifestState(null, true);
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
    if (!activeName && entries.length > 0) setActiveName(entries[0].name);
  }, [entries, activeName]);

  useEffect(() => {
    setPendingFolders(loadPendingFolders(activeName));
    setPendingMoves({});
    setPendingDeletes([]);
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

  const manifestResourceRows = useMemo(
    () => hydrateManifestResources(manifestDoc).filter((res) => !isTombstoneResource(res)),
    [manifestDoc]
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
          isPrivate: isPrivateService(resource.service),
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
        const rawBase64 = await (isPrivateService(resource.service)
          ? fetchPrivateBase64(resource)
          : fetchResourceBase64(resource));
        if (!rawBase64) throw new Error('Unable to fetch resource data for saving.');
        const targetPath = normalizedFolder || entryMeta?.folderSegments.join('/') || '';
        const identifier = buildQassetsFileIdentifier(
          resource.service as Service,
          activeName || resource.name
        );
        const existingMetadata = { ...(resource.metadata || {}) };
        const existingTags = Array.isArray((existingMetadata as any).tags)
          ? ((existingMetadata as any).tags as string[])
          : [];
        const tagsSet = new Set<string>(
          existingTags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
        );
        tagsSet.add('qassets-fs');
        if (targetPath) tagsSet.add(`fs-path:${targetPath}`);
        tagsSet.add(`fs-name:${targetName}`);
        if (isPrivateService(resource.service)) tagsSet.add('private');
        if (resource.created) tagsSet.add(`fs-source-created:${resource.created}`);
        const tags = Array.from(tagsSet);
        const metadata: Record<string, any> = {
          ...existingMetadata,
          tags,
          qassetsFs: {
            path: targetPath,
            fileName: targetName,
            version: 1,
          },
          qassetsSource: {
            name: resource.name,
            service: resource.service,
            identifier: resource.identifier,
            created: resource.created,
            savedAt: Date.now(),
          },
          title: (existingMetadata as any)?.title || targetName,
        };
        publishRequests.push({
          name: activeName,
          service: resource.service as Service,
          identifier,
          data64: rawBase64,
          title: resource.metadata?.title || targetName,
          description: saveToFilesDialog.description || resource.metadata?.description,
          tags,
          metadata,
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

  const handleReload = async () => {
    await refreshResources();
  };

  const handleLoadRemaining = useCallback(async () => {
    if (!hasMore || resourcesLoading || loadingAllPages) return;
    setIgnoreManifestCache(true);
    setLoadingAllPages(true);
    try {
      await loadAll();
    } catch {
      // errors surfaced via useQdnResources error state
    } finally {
      setLoadingAllPages(false);
    }
  }, [hasMore, resourcesLoading, loadingAllPages, loadAll]);

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

  const handlePublishClose = () => {
    if (publishing) return;
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

    setPublishing(true);
    setPublishStatus(null);
    const baseId = sanitizeIdentifier(form.identifier || '');
    try {
      const publishRequests: BatchPublishResource[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const data64 = await fileToBase64(file);
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

        const applyEncryption = async (
          base64: string
        ): Promise<{
          data64: string;
          service: string;
          metadataExtra: Record<string, any>;
          tagExtra: string[];
        }> => {
          if (encryptionMode === 'none' && !form.service.includes('PRIVATE')) {
            return {
              data64: base64,
              service: form.service,
              metadataExtra: {},
              tagExtra: [],
            };
          }
          if (encryptionMode === 'group') {
            if (!groupId) throw new Error('Select a group for encryption.');
            const enc = await qortalRequest({
              action: 'ENCRYPT_QORTAL_GROUP_DATA',
              base64,
              groupId,
              isAdmins: groupAdminsOnly,
            });
            const finalService = ensurePrivateService(form.service);
            const privData64 = applyPrivateMagicIfNeeded(enc, finalService);
            return {
              data64: privData64,
              service: finalService,
              metadataExtra: {
                encrypted: {
                  mode: 'group',
                  groupId,
                  adminsOnly: groupAdminsOnly,
                },
              },
              tagExtra: ['private', 'encrypted:group'],
            };
          }
          const recipients = parseRecipientList(directRecipients);
          if (!recipients.length) alert('no recipients, files will be encrypted for you only.');
          const addr = await resolvePublisherAddress();
          const { publicKeys } = await collectRecipientPublicKeys({
            usersAllowed: recipients,
            includeSelf: true,
            me: { name: activeName || authName || undefined, address: addr },
          });
          if (!publicKeys.length) throw new Error('No recipient public keys resolved.');
          const enc = await qortalRequest({
            action: 'ENCRYPT_DATA',
            base64,
            publicKeys,
          });
          const finalService = ensurePrivateService(form.service);
          return {
            data64: applyPrivateMagicIfNeeded(enc, finalService),
            service: finalService,
            metadataExtra: { encrypted: { mode: 'direct', recipients } },
            tagExtra: ['private', 'encrypted:direct'],
          };
        };

        const {
          data64: finalData64,
          service: finalService,
          metadataExtra,
          tagExtra,
        } = await applyEncryption(data64);
        metadata = { ...metadata, ...metadataExtra };
        tags = tags.concat(tagExtra);
        if (isPrivateService(finalService) && !tagExtra.includes('private')) {
          tags.push('private');
        }
        let identifier: string;
        if (baseId) {
          const suffix = publishDialog.variant === 'multiple' ? `-${i + 1}-${uniqueId6()}` : '';
          identifier =
            publishDialog.variant === 'multiple'
              ? `${baseId}${suffix}`.slice(0, MAX_FILE_IDENTIFIER_LENGTH)
              : baseId.slice(0, MAX_FILE_IDENTIFIER_LENGTH);
        } else {
          identifier = buildQassetsFileIdentifier(finalService as Service, activeName);
        }

        publishRequests.push({
          name: activeName,
          service: finalService as Service,
          identifier,
          data64: finalData64,
          title,
          description,
          tags,
          metadata,
        });
      }

      await publishResources(publishRequests);
      await refreshResources();
      handlePublishClose();
    } catch (e: any) {
      setPublishStatus(e?.message || 'Publish failed');
    } finally {
      setPublishing(false);
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
        const identifier = buildQassetsFileIdentifier(
          folderService as Service,
          activeName || folderRootName
        );
        const data64 = await fileToBase64(entry.file);
        const tags = ['qassets-fs'];
        if (folderPath) tags.push(`fs-path:${folderPath}`);
        tags.push(`fs-name:${fileName}`);
        if (isPrivateService(folderService)) tags.push('private');
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
          service: folderService as Service,
          identifier,
          data64,
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
          data64: manifestData64,
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
    const initialSteps = clonePreviewSteps();
    setPreviewDialog({
      open: true,
      loading: true,
      title: getResourceLabel(target),
      steps: initialSteps,
      resource: target,
      zoomed: false,
      expanded: false,
    });
    const updateStep = (key: PreviewStepKey, status: PreviewStepStatus, message?: string) => {
      setPreviewDialog((prev) => ({
        ...prev,
        steps: prev.steps.map((step) => (step.key === key ? { ...step, status, message } : step)),
      }));
    };
    try {
      const loaded = await ensureResourceContent(target, { onStep: updateStep });
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

  const handlePreviewClose = () => setPreviewDialog(createPreviewDialogState());

  const handleManifestDialogOpen = (entry: StructuredEntry) => {
    setManifestDialog({
      open: true,
      entry,
      folderPath: entry.folderSegments.join('/'),
      fileName: entry.fileName,
      saving: false,
      error: null,
    });
  };

  const handleManifestDialogClose = () => {
    if (manifestDialog.saving) return;
    setManifestDialog({
      open: false,
      entry: null,
      folderPath: '',
      fileName: '',
      saving: false,
      error: null,
    });
  };

  const handleManifestSave = async () => {
    if (!manifestDialog.entry) return;
    const entry = manifestDialog.entry;
    const normalizedPath = normalizePathSegments(manifestDialog.folderPath).join('/');
    const nextFileName = manifestDialog.fileName.trim() || entry.fileName;
    setManifestDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const data64 = await resolveResourceBase64(entry.resource);
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
      await republishWithMetadata({ resource: entry.resource, data64, metadata, tags });
      await refreshResources();
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
        const manifestPayload = buildManifestPayload(overrides);
        const data64 = await objectToBase64(manifestPayload);
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
          base64: data64,
          publicKeys,
        });
        const privateData64 = applyPrivateMagicIfNeeded(encrypted, MANIFEST_SERVICE);
        const metadata = {
          qassetsManifest: { version: 1, visibility: 'private' },
          encrypted: { mode: 'direct', recipients: [publisherAddress] },
        };
        await publishResources([
          {
            name: activeName,
            service: MANIFEST_SERVICE as Service,
            identifier: MANIFEST_IDENTIFIER,
            data64: privateData64,
            title: 'Q-Assets Manifest',
            description: 'Aggregated service and folder metadata for faster browsing.',
            tags: ['qassets-manifest', 'private', 'encrypted:direct'],
            metadata,
          },
        ]);
        setManifestDoc(manifestPayload);
        setManifestDirty(false);
      } catch (e: any) {
        setManifestError(e?.message || 'Manifest publish failed');
      } finally {
        setManifestPublishing(false);
      }
    },
    [activeName, authName, buildManifestPayload, publishResources, resolvePublisherAddress]
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
      for (const resource of targets) {
        const data64 = await resolveResourceBase64(resource);
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
            base64: data64,
            groupId: gid,
            isAdmins: false,
          });
          const service = ensurePrivateService(resource.service);
          const privData = applyPrivateMagicIfNeeded(enc, service);
          shareRequests.push({
            name: publisherName,
            service,
            identifier: `${resource.identifier}-g${gid}-${uniqueId6()}`,
            data64: privData,
            title: resource.metadata?.title,
            description: resource.metadata?.description,
            tags: [...tagsBase, 'private', `share:group:${gid}`],
            metadata: {
              ...metadataBase,
              qassetsShareTarget: { type: 'group', groupId: gid },
            },
          });
        }

        if (publicGroups.length || directRecipients.length) {
          const addr = userAddress
            ? userAddress
            : (await qortalRequest({ action: 'GET_USER_ACCOUNT' }))?.address;
          if (!addr) throw new Error('Unable to resolve your account address for sharing.');
          const { publicKeys, included } = await collectRecipientPublicKeys({
            groupIds: publicGroups,
            usersAllowed: directRecipients,
            includeSelf: true,
            me: { name: publisherName, address: addr },
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
            base64: data64,
            publicKeys,
          });
          const service = ensurePrivateService(resource.service);
          const privData = applyPrivateMagicIfNeeded(enc, service);
          shareRequests.push({
            name: publisherName,
            service,
            identifier: `${resource.identifier}-direct-${uniqueId6()}`,
            data64: privData,
            title: resource.metadata?.title,
            description: resource.metadata?.description,
            tags: [...tagsBase, 'private', 'share:direct'],
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
  };

  const handleBulkMove = () => {
    if (!movableEntries.length) {
      alert('Select structured files to move.');
      return;
    }
    openMoveDialogForEntries(movableEntries);
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
  };

  const handleBulkDelete = () => {
    if (!selectedStructuredEntries.length) {
      alert('Select structured files to delete.');
      return;
    }
    void handleDeleteFilesCopy(selectedStructuredEntries);
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
        data64: base64,
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
        const data64 = await objectToBase64(tombstone);
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
          data64,
          title: 'TOMBSTONE',
          description: 'Resource removed by publisher',
          metadata,
          tags: ['qassets-tombstone'],
        });
      }
      await publishResources(resources);
      if (publishMode === 'immediate') {
        await handlePublishManifest({
          removeStructuredIdentifiers: removedIdentifiers,
          removeResourceIdentifiers: removedIdentifiers,
        });
      } else {
        setManifestDoc((prev) => {
          if (!prev) return prev;
          const nextStructured = prev.structuredFiles
            ? prev.structuredFiles.filter((entry) => !removedIdentifiers.includes(entry.identifier))
            : prev.structuredFiles;
          const nextResources = prev.resources
            ? prev.resources.filter((entry) => !removedIdentifiers.includes(entry.identifier))
            : prev.resources;
          if (nextStructured === prev.structuredFiles && nextResources === prev.resources)
            return prev;
          return { ...prev, structuredFiles: nextStructured, resources: nextResources };
        });
        setManifestDirty(true);
      }
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
      setSelectedResourceId(null);
      setSelectedResourceIds((prev) => prev.filter((id) => !removedIdentifiers.includes(id)));
      await refreshResources();
      setPendingDeletes((prev) => prev.filter((id) => !removedIdentifiers.includes(id)));
      setSystemSaveStatus('Deleted Files copy.');
    } catch (e: any) {
      setPendingDeletes((prev) =>
        prev.filter((id) => !targets.some((entry) => entry.resource.identifier === id))
      );
      setSystemSaveStatus(e?.message || 'Failed to delete Files copy.');
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
          }}
        >
          {activeName}
        </Typography>
      );
    }

    if (activeSection === 'services' && activeService) {
      crumbs.push(
        <Typography key="service" color="text.primary" fontWeight={600}>
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
            }}
          >
            {segment}
          </Typography>
        );
      });
    }

    if (activeSection === 'shares') {
      crumbs.push(
        <Typography key="shares" color="text.primary" fontWeight={600}>
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
        sx={{ mt: 2, alignItems: 'stretch' }}
      >
        <ExplorerSidebar
          entries={entries}
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
          onSelectName={setActiveName}
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
                <Typography variant="h5">{cardTitle}</Typography>
                {activeName && (
                  <Breadcrumbs separator="›" sx={{ mt: 0.5 }}>
                    {breadcrumbItems.length ? (
                      breadcrumbItems
                    ) : (
                      <Typography color="text.secondary">Select a service</Typography>
                    )}
                  </Breadcrumbs>
                )}
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Stack direction="row" spacing={1} alignItems="center">
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
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => void handlePublishManifest()}
                      disabled={!manifestDirty || manifestPublishing || !activeName}
                    >
                      {manifestPublishing ? 'Publishing…' : 'Publish queued changes'}
                    </Button>
                  )}
                </Stack>
                <Button
                  variant="contained"
                  startIcon={<PublishRoundedIcon />}
                  onClick={handleOpenPublishMenu}
                  disabled={!activeName}
                >
                  Publish Files/Folders
                </Button>
                <Tooltip title="Refresh current folder">
                  <span>
                    <IconButton onClick={handleReload} disabled={!activeName || resourcesLoading}>
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
            </Stack>

            {manifestBoundaryReached && hasMore && !ignoreManifestCache && (
              <Alert
                severity="info"
                sx={{ mt: 2 }}
                action={
                  <Button
                    size="small"
                    onClick={handleLoadRemaining}
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
                        <FolderOpenRoundedIcon color="primary" fontSize="large" />
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
                        onClick={handleBulkSaveToSystem}
                        disabled={!selectedResourceIds.length}
                      >
                        Save to system
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkMove}
                        disabled={!movableEntries.length}
                      >
                        Move
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkPreview}
                        disabled={!selectedResourceIds.length}
                      >
                        Preview
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkShare}
                        disabled={!bulkSelectedResources.length}
                      >
                        Share
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkDelete}
                        disabled={!selectedStructuredEntries.length}
                      >
                        Delete
                      </Button>
                      <Button size="small" onClick={handleClearSelection}>
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
                            <Chip size="small" label={serviceLabels(resource.service)} />
                            <Chip
                              size="small"
                              label={getResourceStatus(resource)}
                              color="success"
                              variant="outlined"
                            />
                            {isPrivateService(resource.service) && (
                              <Chip
                                size="small"
                                label="Private"
                                color="secondary"
                                variant="outlined"
                              />
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
                        onClick={handleBulkSaveToSystem}
                        disabled={!selectedResourceIds.length}
                      >
                        Save to system
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkMove}
                        disabled={!movableEntries.length}
                      >
                        Move
                      </Button>
                      <Button size="small" onClick={handleBulkPreview}>
                        Preview
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkShare}
                        disabled={!bulkSelectedResources.length}
                      >
                        Share
                      </Button>
                      <Button size="small" onClick={handleBulkDelete}>
                        Delete
                      </Button>
                      <Button size="small" onClick={handleClearSelection}>
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
                            <Chip size="small" label={serviceLabels(resource.service)} />
                            <Chip
                              size="small"
                              label={getResourceStatus(resource)}
                              color="success"
                              variant="outlined"
                            />
                            <Chip size="small" label="Shared" color="info" variant="outlined" />
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
                        onClick={handleBulkSaveToSystem}
                        disabled={!selectedResourceIds.length}
                      >
                        Save to system
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkMove}
                        disabled={!movableEntries.length}
                      >
                        Move selected to folder
                      </Button>
                      <Button size="small" onClick={handleBulkPreview}>
                        Preview
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkShare}
                        disabled={!bulkSelectedResources.length}
                      >
                        Share
                      </Button>
                      <Button
                        size="small"
                        onClick={handleBulkDelete}
                        disabled={!selectedStructuredEntries.length}
                      >
                        Delete
                      </Button>
                      <Button size="small" onClick={handleClearSelection}>
                        Clear
                      </Button>
                    </>
                  ) : (
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      alignItems="center"
                      sx={{ width: '100%', justifyContent: 'space-between' }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Create folders to organize your published files.
                      </Typography>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <Button size="small" variant="contained" onClick={handleCreateFolderOpen}>
                          Create folder
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handlePublishManifest()}
                          disabled={manifestPublishing || !activeName}
                        >
                          Publish folder snapshot
                        </Button>
                        <Button size="small" variant="outlined" onClick={handleFolderDialogOpen}>
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
                              <Chip size="small" label={serviceLabels(resource.service)} />
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
                    Service: {selectedResource.service || '—'}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip size="small" label={serviceLabels(selectedResource.service)} />
                    <Chip
                      size="small"
                      label={getResourceStatus(selectedResource)}
                      color="success"
                      variant="outlined"
                    />
                    {isPrivateService(selectedResource.service) && (
                      <Chip size="small" label="Private" color="secondary" variant="outlined" />
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
                    <Button size="small" variant="outlined" onClick={handleShareOpen}>
                      Share
                    </Button>
                    {selectedStructuredEntry && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleManifestDialogOpen(selectedStructuredEntry)}
                      >
                        Edit manifest
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
                          {filesActionLoading === 'delete' ? 'Deleting…' : 'Delete files copy'}
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
        folderName={createFolderDialog.folderName}
        error={createFolderDialog.error}
        onClose={handleCreateFolderClose}
        onChange={handleCreateFolderNameChange}
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
          {previewDialog.type === 'binary' && (
            <Typography variant="body2">{previewDialog.content}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={togglePreviewExpanded}>
            {previewDialog.expanded ? 'Exit full view' : 'Expand view'}
          </Button>
          <Button onClick={handlePreviewShare} disabled={!previewDialog.resource}>
            Share
          </Button>
          <Button onClick={handlePreviewSaveToSystem} disabled={!previewDialog.resource}>
            Save to system
          </Button>
          <Button onClick={handlePreviewClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={manifestDialog.open}
        onClose={handleManifestDialogClose}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit manifest</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Folder path"
              fullWidth
              value={manifestDialog.folderPath}
              onChange={(event) =>
                setManifestDialog((prev) => ({ ...prev, folderPath: event.target.value }))
              }
              helperText="Adjust folder structure (use / for nesting)"
            />
            <TextField
              label="File name"
              fullWidth
              value={manifestDialog.fileName}
              onChange={(event) =>
                setManifestDialog((prev) => ({ ...prev, fileName: event.target.value }))
              }
            />
            {manifestDialog.error && <Alert severity="warning">{manifestDialog.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleManifestDialogClose} disabled={manifestDialog.saving}>
            Cancel
          </Button>
          <Button onClick={handleManifestSave} variant="contained" disabled={manifestDialog.saving}>
            {manifestDialog.saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

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
