import type { QdnResource, QdnStatus } from '../../../hooks/useQdnResources';

type StructuredMeta = {
  folderSegments: string[];
  fileName: string;
};

export type StructuredEntry = StructuredMeta & {
  resource: QdnResource;
  isPrivate: boolean;
};

export type FolderNode = {
  key: string;
  name: string;
  parentKey: string | null;
  childKeys: string[];
  files: StructuredEntry[];
  resource?: QdnResource;
};

export type FolderDescriptor = {
  segments: string[];
  name?: string;
  resource: QdnResource;
};

export type ManifestResource = {
  identifier: string;
  service: string;
  name: string;
  created?: number;
  size?: number;
  metadata?: Record<string, any>;
  status?: QdnStatus;
};

export type ManifestStructured = {
  identifier: string;
  path: string;
  fileName: string;
  service?: string;
};

export type ManifestFolder = {
  path: string;
  name?: string;
};

export type ManifestDoc = {
  version: 1;
  generatedAt: number;
  services: Record<string, number>;
  totals: {
    resources: number;
    structuredFiles: number;
  };
  resourceTypes?: Record<string, string>;
  resources?: ManifestResource[];
  structuredFiles?: ManifestStructured[];
  folders?: ManifestFolder[];
  lastSynced?: number;
};

export type ServiceBucket = {
  service: string;
  label: string;
  count: number;
  newest?: number;
};

export type PublishTask =
  | {
      type: 'resource';
      payload: {
        name: string;
        service: string;
        identifier: string;
        data64: string;
        metadata?: Record<string, any>;
        tags?: string[];
        title?: string;
        description?: string;
      };
    }
  | {
      type: 'manifest';
      payload: ManifestDoc;
    };
