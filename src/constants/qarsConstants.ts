// Centralized versions + QDN identifier helpers for QARS

// ---- Versions ---------------------------------------------------------------
export const QARS_SCHEMA_VERSION = 1 as const;
export const QARS_WEIGHTS_VERSION = 1 as const;

// Prefer to inject via Vite env or a global, but default if not provided.
export const APP_QARS_CODE_VERSION: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any)?.env?.VITE_QARS_CODE_VERSION) ||
  (typeof window !== 'undefined' && (window as any)?._qarsCodeVersion) ||
  '0.1.0';

// Schema string used in snapshots
export function qarsSnapshotSchema(): `qars-snapshot@${typeof QARS_SCHEMA_VERSION}` {
  return `qars-snapshot@${QARS_SCHEMA_VERSION}`;
}

// ---- QDN Service ------------------------------------------------------------
// We’ll use DOCUMENT for all QARS JSON blobs.
export const QARS_QDN_SERVICE = 'DOCUMENT' as const;

// Optional: allow an app-owned “official” name context for certain publishes.
// Leave undefined to publish under the current user’s name.
export const QASSETS_OWNER_NAME:
  | string
  | undefined =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any)?.env?.VITE_QASSETS_OWNER_NAME) ||
  (typeof window !== 'undefined' && (window as any)?._qassetsOwnerName) ||
  undefined;

// If you want to enforce admin priority via a group, put its ID here.
export const QASSETS_MANAGEMENT_GROUP_ID: number | undefined = undefined;

// In block terms, how long admin-published data should be preferred over community.
export const ADMIN_MAX_AGE_BLOCKS_DEFAULT = 1440;

// ---- Identifier Builders ----------------------------------------------------
// Philosophy:
//  - Each asset has a single canonical "HEAD" per-publisher that always reflects latest.
//  - We also support per-epoch ids for immutable history and easier aggregation.
//
//   HEAD examples:
//     qars_snapshot__<assetId>__head
//     qars_aggregate__<assetId>__head
//
//   Historical (per height):
//     qars_snapshot__<assetId>__h<asOfHeight>
//     qars_aggregate__<assetId>__h<asOfHeight>
//
//   Weights/config live by version:
//     qars_weights__v<version>
//     qars_config__v<version>

export const QARS_ID_PREFIX = 'qars';

export function snapshotHeadId(assetId: number) {
  return `${QARS_ID_PREFIX}_snapshot__${assetId}__head`;
}
export function snapshotEpochId(assetId: number, asOfHeight: number) {
  return `${QARS_ID_PREFIX}_snapshot__${assetId}__h${asOfHeight}`;
}

export function aggregateHeadId(assetId: number) {
  return `${QARS_ID_PREFIX}_aggregate__${assetId}__head`;
}
export function aggregateEpochId(assetId: number, asOfHeight: number) {
  return `${QARS_ID_PREFIX}_aggregate__${assetId}__h${asOfHeight}`;
}

export function inputsProofId(assetId: number, asOfHeight: number) {
  return `${QARS_ID_PREFIX}_inputs_proof__${assetId}__h${asOfHeight}`;
}

export function weightsId(version: number = QARS_WEIGHTS_VERSION) {
  return `${QARS_ID_PREFIX}_weights__v${version}`;
}

// Optional future config doc if you want published runtime knobs:
export function configId(version: number = QARS_WEIGHTS_VERSION) {
  return `${QARS_ID_PREFIX}_config__v${version}`;
}


export const MIN_UPVOTE_QORT = 5
export const PAYMENT_WINDOW_MIN = 30