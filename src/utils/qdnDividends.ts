import { base64ToObject } from 'qapp-core';
import { assetDividendHeadId, assetDividendItemId, assetDividendItemPrefix, Q_ASSET_APP_PUBLISHER, Q_ASSETS_VERSION,} from '../constants/qdnConstants';
import {type DividendEntry, type DividendHead } from '../types/dividendsObject'
import { searchSimpleNameIdPrefix } from '../utils/searchSimple';
import { objectToBase64 } from './data';

// Fetch issuer’s primary name (optional nicety)
export async function getPrimaryName(address: string): Promise<string | null> {
  try {
    const res = await qortalRequest({ action: 'GET_PRIMARY_NAME', address });
    if (res && typeof res === 'string') return res;
    if (res && typeof res?.name === 'string') return res.name;
  } catch {}
  return null;
}



export async function getNextDividendCounter(publishName: string, assetId: number): Promise<number> {
  const prefix = assetDividendItemPrefix(assetId);

  // Fast path via head
  try {
    const head = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: publishName,
      service: 'DOCUMENT',
      identifier: assetDividendHeadId(assetId),
      encoding: 'base64'
    });
    if (head && typeof head === 'string') {
      const json = base64ToObject(head) as DividendHead;
      if (Number.isFinite(json?.lastCounter)) return Number(json.lastCounter) + 1;
    }
  } catch { /* head not present, fall through */ }

  // Faster, targeted scan by prefix
  const hits = await searchSimpleNameIdPrefix(prefix, publishName);
  let maxCounter = 0;

  for (const h of hits) {
    if (h.identifier?.startsWith(prefix)) {
      const n = Number(h.identifier.slice(prefix.length));
      if (Number.isFinite(n) && n > maxCounter) maxCounter = n;
    }
  }
  return maxCounter + 1;
}


// Publish a single dividend JSON record
export async function publishDividendEntry(publishName: string, assetId: number, entry: DividendEntry, counter: number) {
  const identifier = assetDividendItemId(assetId, counter);
  const data64 = await objectToBase64(entry);

  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: publishName,
    service: 'DOCUMENT',
    identifier,
    data64,
    title: `Dividends for asset #${entry.assetId} — run ${counter}`,
    description: `Payout ${counter} for ${entry.assetName ?? `#${entry.assetId}`}`,
    encrypt: false,
  });

  return identifier;
}

// Publish/refresh the head pointer
export async function publishDividendHead(publishName: string, assetId: number, lastCounter: number, lastIdentifier: string) {
  const head: DividendHead = {
    app: Q_ASSET_APP_PUBLISHER,
    appVersion: Q_ASSETS_VERSION,
    assetId,
    lastCounter,
    lastIdentifier,
    updated: Date.now()
  };
  const data64 = await objectToBase64(head);

  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: publishName,
    service: 'DOCUMENT',
    identifier: assetDividendHeadId(assetId),
    data64,
    title: `Dividends head for asset #${assetId}`,
    description: `Tracks the latest dividend payout counter for this asset.`,
    encrypt: false,
  });
}
