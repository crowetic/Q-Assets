import { uniqueId6 } from './ids';
import type { QdnResource } from '../hooks/useQdnResources';
import type {
  FolderDescriptor,
  FolderNode,
  StructuredEntry,
} from '../pages/manage/data/DataExplorer.types';
import { filterUserTags } from './qdnTags';
import { resourceIsPrivate } from './qdnEncryption';

export const sanitizeIdentifier = (value: string) => {
  if (!value) return '';
  return value
    .replace(/[^a-z0-9\-_.]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .toLowerCase();
};

export const parseRecipientList = (value: string) =>
  value
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean);

export const normalizePathSegments = (input?: string) => {
  if (!input) return [] as string[];
  return input
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean);
};

export const getShareTargetMeta = (resource: QdnResource) =>
  (resource.metadata as any)?.qassetsShareTarget;

export const isShareResource = (resource: QdnResource) => Boolean(getShareTargetMeta(resource));

export const matchesSearch = (resource: QdnResource, query: string) => {
  if (!query) return true;
  const lower = query.toLowerCase();
  const identifier = (resource.identifier || '').toLowerCase();
  const service = (resource.service || '').toLowerCase();
  const title =
    typeof resource.metadata?.title === 'string' ? resource.metadata.title.toLowerCase() : '';
  const desc =
    typeof resource.metadata?.description === 'string'
      ? resource.metadata.description.toLowerCase()
      : '';
  return (
    identifier.includes(lower) ||
    service.includes(lower) ||
    title.includes(lower) ||
    desc.includes(lower)
  );
};

export const stripStructuredMetadata = (
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

export const inferStructuredMeta = (resource: QdnResource): StructuredEntry | null => {
  const md = resource.metadata || {};
  const tags: string[] = Array.isArray((md as any).tags) ? (md as any).tags : [];
  if (getShareTargetMeta(resource)) return null;

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

export const inferFolderDescriptor = (resource: QdnResource): FolderDescriptor | null => {
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

export const dedupeFolderDescriptors = (descriptors: FolderDescriptor[]): FolderDescriptor[] => {
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

export const buildFolderMap = (
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
