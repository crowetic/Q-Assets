import type { Service } from 'qapp-core';
import { Q_ASSETS_MANAGEMENT_GROUP_ID, qaManagementManifestId } from '../constants/qdnConstants';
import { base64ToObject, objectToBase64 } from './data';
import { searchSimpleByFullId } from './searchSimple';
import { isManagementAdminPublisher, resolvePublisherAddress } from './newsHelpers';
import { getAccountGroups, type GroupSummary } from './qortalApi';

export type PermissionId = string;

export interface ManifestRole {
  id: string;
  label: string;
  description?: string;
  groupId: number;
  permissions: PermissionId[];
  membership?: 'member' | 'admin';
  scopes?: Array<{ type: string; identifier?: string }>;
}

export interface ManifestScope {
  type: string;
  identifier: string;
  description?: string;
  requiredPermissions: PermissionId[];
}

export interface ManagementManifest {
  version: number;
  updatedAt: number;
  roles: ManifestRole[];
  scopes: ManifestScope[];
  fees?: Record<string, FeeEntry>;
  discounts?: DiscountTier[];
  defaultNewsPromoExpiryDays?: number;
  metadata?: Record<string, any>;
}

export type CurrencyCode = 'QORT' | 'QASSET';

export interface FeeEntry {
  baseAmount: number;
  currencies: CurrencyCode[];
  allow1to1?: boolean;
}

export interface DiscountTier {
  assetId: number;
  min: number;
  max?: number;
  percent: number;
}

const CURRENT_VERSION = 1;
const DEFAULT_NEWS_PROMO_EXPIRY_DAYS = 30;

const defaultManifest = (): ManagementManifest => ({
  version: CURRENT_VERSION,
  updatedAt: Date.now(),
  metadata: {
    description: 'Default Q-Assets management manifest',
  },
  fees: {
    'notifications.global': { baseAmount: 1, currencies: ['QORT', 'QASSET'], allow1to1: true },
    'qdeck.upvote': { baseAmount: 1, currencies: ['QASSET', 'QORT'], allow1to1: true },
    'qdeck.bounty': { baseAmount: 5, currencies: ['QASSET', 'QORT'], allow1to1: true },
  },
  defaultNewsPromoExpiryDays: DEFAULT_NEWS_PROMO_EXPIRY_DAYS,
  discounts: [
    { assetId: 6, min: 0, max: 500, percent: 5 },
    { assetId: 6, min: 501, max: 1000, percent: 8 },
    { assetId: 6, min: 1001, max: 2500, percent: 15 },
    { assetId: 6, min: 2501, max: 5000, percent: 25 },
    { assetId: 6, min: 5001, max: 15000, percent: 50 },
    { assetId: 6, min: 15001, max: 25000, percent: 75 },
    { assetId: 6, min: 25001, max: 50000, percent: 85 },
    { assetId: 6, min: 50001, max: 100000, percent: 95 },
    { assetId: 6, min: 100001, percent: 100 },
  ],
  roles: [
    {
      id: 'app-admin',
      label: 'App Administrators',
      description: 'Primary administrators of the Q-Assets application.',
      groupId: Q_ASSETS_MANAGEMENT_GROUP_ID,
      membership: 'admin',
      permissions: [
        'announcements.publish',
        'announcements.approve',
        'notifications.publish.global',
        'notifications.manage',
        'promotions.review',
        'wiki.publish.core',
        'wiki.overwrite.core',
        'permissions.manage.manifest',
      ],
    },
    {
      id: 'wiki-members',
      label: 'Wiki Publishers',
      description: 'Members who can publish core wiki updates.',
      groupId: Q_ASSETS_MANAGEMENT_GROUP_ID,
      membership: 'member',
      permissions: ['wiki.publish.core'],
    },
  ],
  scopes: [
    {
      type: 'announcement',
      identifier: 'global',
      requiredPermissions: ['announcements.publish', 'announcements.approve'],
    },
    {
      type: 'notifications',
      identifier: 'global',
      requiredPermissions: ['notifications.publish.global'],
    },
    {
      type: 'promotions',
      identifier: 'global',
      requiredPermissions: ['promotions.review'],
    },
  ],
});

const coerceManifest = (input: any): ManagementManifest => {
  if (!input || typeof input !== 'object') return defaultManifest();
  const manifest: ManagementManifest = {
    version: Number(input.version) || CURRENT_VERSION,
    updatedAt: Number(input.updatedAt) || Date.now(),
    metadata: input.metadata || {},
    defaultNewsPromoExpiryDays:
      typeof input.defaultNewsPromoExpiryDays === 'number' && input.defaultNewsPromoExpiryDays >= 0
        ? input.defaultNewsPromoExpiryDays
        : DEFAULT_NEWS_PROMO_EXPIRY_DAYS,
    roles: Array.isArray(input.roles)
      ? (input.roles
          .map((role: any): ManifestRole | null => {
            if (!role || typeof role !== 'object') return null;
            if (typeof role.id !== 'string' || !role.id.trim()) return null;
            return {
              id: role.id.trim(),
              label: String(role.label || role.id),
              description: role.description ? String(role.description) : undefined,
              groupId: Number(role.groupId) || Q_ASSETS_MANAGEMENT_GROUP_ID,
              permissions: Array.isArray(role.permissions)
                ? role.permissions.map((p: any) => String(p).trim()).filter(Boolean)
                : [],
              membership:
                role.membership === 'admin'
                  ? 'admin'
                  : role.membership === 'member'
                    ? 'member'
                    : undefined,
              scopes: Array.isArray(role.scopes)
                ? (role.scopes
                    .map((s: any) => {
                      if (!s || typeof s !== 'object') return null;
                      if (!s.type) return null;
                      return {
                        type: String(s.type),
                        identifier: s.identifier ? String(s.identifier) : undefined,
                      };
                    })
                    .filter(Boolean) as Array<{ type: string; identifier?: string }>)
                : undefined,
            };
          })
          .filter(Boolean) as ManifestRole[])
      : [],
    scopes: Array.isArray(input.scopes)
      ? (input.scopes
          .map((scope: any): ManifestScope | null => {
            if (!scope || typeof scope !== 'object') return null;
            if (!scope.type || !scope.identifier) return null;
            return {
              type: String(scope.type),
              identifier: String(scope.identifier),
              description: scope.description ? String(scope.description) : undefined,
              requiredPermissions: Array.isArray(scope.requiredPermissions)
                ? scope.requiredPermissions.map((p: any) => String(p).trim()).filter(Boolean)
                : [],
            };
          })
          .filter(Boolean) as ManifestScope[])
      : [],
  };

  if (!manifest.roles.length) manifest.roles = defaultManifest().roles;
  if (!manifest.scopes.length) manifest.scopes = defaultManifest().scopes;
  return manifest;
};

async function fetchManifestHit(): Promise<{ name: string; service: Service } | null> {
  const hits = await searchSimpleByFullId(qaManagementManifestId);
  if (!hits.length) return null;
  const adminHits: typeof hits = [];
  for (const hit of hits) {
    if (await isManagementAdminPublisher(hit.name)) adminHits.push(hit);
  }
  const candidates = adminHits.length ? adminHits : hits;
  const sorted = candidates
    .slice()
    .sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
  const latest = sorted[0];
  if (!latest) return null;
  return { name: latest.name, service: (latest.service as Service) || 'DOCUMENT' };
}

export async function loadManagementManifest(): Promise<ManagementManifest> {
  const hit = await fetchManifestHit();
  if (!hit) return defaultManifest();
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: hit.name,
      service: hit.service,
      identifier: qaManagementManifestId,
      encoding: 'base64',
    });
    const data64 = res?.data64 ?? res;
    if (!data64 || typeof data64 !== 'string') return defaultManifest();
    const parsed = base64ToObject(data64);
    return coerceManifest(parsed);
  } catch {
    return defaultManifest();
  }
}

export async function publishManagementManifest(manifest: ManagementManifest, publisher: string) {
  const payload = await objectToBase64({
    ...manifest,
    version: CURRENT_VERSION,
    updatedAt: Date.now(),
  });
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: 'DOCUMENT',
    name: publisher,
    identifier: qaManagementManifestId,
    data64: payload,
  });
  _manifestCache = { manifest: { ...manifest, updatedAt: Date.now() }, at: Date.now() };
}

let _manifestCache: { manifest: ManagementManifest; at: number } | null = null;
const MANIFEST_CACHE_TTL = 60_000;

async function getCachedManifest(): Promise<ManagementManifest> {
  const now = Date.now();
  if (_manifestCache && now - _manifestCache.at < MANIFEST_CACHE_TTL) {
    return _manifestCache.manifest;
  }
  const manifest = await loadManagementManifest();
  _manifestCache = { manifest, at: now };
  return manifest;
}

export async function getNewsPromoExpiryDays(): Promise<number> {
  const manifest = await getCachedManifest();
  if (typeof manifest.defaultNewsPromoExpiryDays === 'number') {
    return manifest.defaultNewsPromoExpiryDays;
  }
  return DEFAULT_NEWS_PROMO_EXPIRY_DAYS;
}

export async function derivePermissionsForGroups(groups: GroupSummary[]): Promise<PermissionId[]> {
  const manifest = await getCachedManifest();
  const perms = new Set<PermissionId>();
  manifest.roles.forEach((role) => {
    groups.forEach((group) => {
      if (group.groupId !== role.groupId) return;
      if (role.membership === 'admin' && !group.isAdmin) return;
      role.permissions.forEach((perm) => perms.add(perm));
    });
  });
  return Array.from(perms);
}

export async function publisherHasPermission(publisher: string, permission: PermissionId) {
  const manifest = await getCachedManifest();
  const relevantRoles = manifest.roles.filter((role) => role.permissions.includes(permission));
  if (!relevantRoles.length) return false;

  const address = await resolvePublisherAddress(publisher);
  if (!address) return false;
  const groups = await getAccountGroups(address).catch(() => []);
  if (!groups.length) return false;

  return relevantRoles.some((role) => {
    const group = groups.find((g) => g.groupId === role.groupId);
    if (!group) return false;
    if (role.membership === 'admin') return Boolean(group.isAdmin);
    return true;
  });
}
