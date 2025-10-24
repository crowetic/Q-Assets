

export async function signAndBroadcast(rawTx: string): Promise<object> {
  const signedBytes  = await qortalRequest({
    action: "SIGN_TRANSACTION",
    unsignedBytes: rawTx
  });

  console.log('signedBytes from signAndBroadcast',signedBytes)
  const res = await fetch("/transactions/process", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-API-VERSION": "2"
    },
    body: signedBytes
  });

  console.log('finalResponse',res)
  if (!res.ok) throw new Error();

  return res;
}


// GROUP CALLS --------------------------

export interface GroupSummary {
  groupId: number;
  owner: string;
  groupName: string;
  description: string;
  created: number;
  isOpen: boolean;
  approvalThreshold: string;
  minimumBlockDelay: number;
  maximumBlockDelay: number;
  memberCount: number;
  isAdmin: boolean;
}


// Low-level call to REST endpoint
export async function getAccountGroups(address: string, opts?: { signal?: AbortSignal }): Promise<GroupSummary[]> {
  if (!address) throw new Error('address is required');
  const url = `/groups/member/${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: opts?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`GET ${url} returned non-array payload`);
  }

  return data.map((g: any) => ({
    groupId: Number(g.groupId),
    owner: String(g.owner),
    groupName: String(g.groupName ?? ''),
    description: String(g.description ?? ''),
    created: Number(g.created ?? 0),
    isOpen: Boolean(g.isOpen),
    approvalThreshold: String(g.approvalThreshold ?? ''),
    minimumBlockDelay: Number(g.minimumBlockDelay ?? 0),
    maximumBlockDelay: Number(g.maximumBlockDelay ?? 0),
    memberCount: Number(g.memberCount ?? 0),
    isAdmin: Boolean(g.isAdmin),
  })) as GroupSummary[];
}

/* ---------- Convenience helpers for Q-Deck ACLs ---------- */

// just the ids
export async function getAccountGroupIds(address: string): Promise<number[]> {
  const groups = await getAccountGroups(address);
  return groups.map(g => g.groupId);
}

// groups where user is admin
export async function getAdminGroupIds(address: string): Promise<number[]> {
  const groups = await getAccountGroups(address);
  return groups.filter(g => g.isAdmin).map(g => g.groupId);
}

// predicate for “can edit this board” based on groupsAllowed
export async function userCanEditBoard(address: string, groupsAllowed: Array<string | number>): Promise<boolean> {
  const myIds = new Set(await getAccountGroupIds(address));
  // groupsAllowed might be strings; coerce to number where possible
  for (const id of groupsAllowed ?? []) {
    const n = typeof id === 'string' ? Number(id) : id;
    if (myIds.has(n)) return true;
  }
  return (groupsAllowed?.length ?? 0) === 0; // if unset/open, allow
}

// END GROUPS-RELATED


// --- helpers ---

async function resolveRecipientToAddress(recipient: string): Promise<string> {
  const looksLikeAddress = /^Q[0-9A-Za-z]{25,}$/.test(recipient.trim());
  if (looksLikeAddress) return recipient.trim();

  // Treat as Qortal name → owner address
  try {
    const data = await qortalRequest({ action: 'GET_NAME_DATA', name: recipient.trim() });
    const addr = data?.owner;
    if (typeof addr === 'string' && addr.startsWith('Q')) return addr;
  } catch { /* ignore */ }

  throw new Error(`Recipient is not a valid address or resolvable Qortal name: ${recipient}`);
}

// --- core: create unsigned TRANSFER_ASSET ---

export async function createTransferAssetTransaction(
  senderAddress: string,
  senderPublicKey: string,
  recipient: string,            // Qortal name or address
  assetId: number,
  amount: number,               // amount in the asset's native units; ensure you pass atomic if your API expects it
  opts?: {
    fee?: number;               // default 0.01
    txGroupId?: number;         // default 0
  }
): Promise<string> {
  const account = await getAccount(senderAddress);
  const recipientAddress = await resolveRecipientToAddress(recipient);

  const txBody = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: opts?.fee ?? 0.01,
    txGroupId: opts?.txGroupId ?? 0,
    recipient: recipientAddress,
    senderPublicKey,
    amount,
    assetId,
  };

  const res = await fetch('/assets/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(txBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Transfer asset failed: ${res.status} ${res.statusText} ${text}`);
  }

  const unsigned = await res.text();
  if (!await isValidQortalTx(unsigned, 'TRANSFER_ASSET')) {
    throw new Error(`Response from /assets/transfer doesn't look like a TRANSFER_ASSET; got: ${unsigned.slice(0, 16)}…`);
  }

  return unsigned;
}

// --- convenience: build → sign → broadcast ---

export async function transferAsset(
  senderAddress: string,
  senderPublicKey: string,
  recipient: string,       // name or address
  assetId: number,
  amount: number,
  opts?: { fee?: number; txGroupId?: number }
): Promise<object> {
  const unsigned = await createTransferAssetTransaction(
    senderAddress,
    senderPublicKey,
    recipient,
    assetId,
    amount,
    opts
  );

  return await signAndBroadcast(unsigned);
}



export const getPrimaryAccountName = async (address: string): Promise<string> => {
  try {
    const name = await qortalRequest({
      action: 'GET_PRIMARY_NAME',
      address,
    });
    return name ?? '';
  } catch (err) {
    console.error(`Failed to get primary name for ${address}:`, err);
    return '';
  }
};

export async function getAccount(address: string): Promise<any> {
  return await qortalRequest({ action: 'GET_ACCOUNT_DATA', address });
}

export async function getAllAccountNames(address: string): Promise<string[]> {
  const addr = (address || '').trim();
  if (!addr) return [];
  try {
    const rows = await qortalRequest({ action: 'GET_ACCOUNT_NAMES', address: addr } as any);
    if (Array.isArray(rows)) {
      return rows
        .map((r: any) => (typeof r === 'string' ? r : r?.name))
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0)
        .map((s: string) => s.trim());
    }
  } catch {}
  // HTTP fallback some nodes provide
  try {
    const res = await fetch(`/names/address/${addr}`, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) {
        return rows
          .map((r: any) => (typeof r === 'string' ? r : r?.name))
          .filter((s: any) => typeof s === 'string' && s.trim().length > 0)
          .map((s: string) => s.trim());
      }
    }
  } catch {}
  return [];
}

export interface SignatureResponse {
  type: string;
  timestamp: number;
  reference?: string;
  fee?: string;
  signature: string;
  txGroupId?: number;
  recipient: string;
  blockHeight?: number;
  approvalStatus?: string;
  creatorAddress: string;
  senderPublicKey: string;
  amount: string;
  assetId?: number;
  assetName?: string;
}

export const getTransactionInfoBySignature = async (txSig: string): Promise<SignatureResponse> => {
  // Call fetch and parse JSON
  const res = await fetch(`/names/transactions/signature/${txSig}`, {
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch transaction: ${res.statusText}`);
  }

  // Now parse the body as JSON
  const data = (await res.json()) as SignatureResponse;

  // Return data directly, since it's already typed
  return data;
};




async function isValidQortalTx(base58Tx: string, txType: string): Promise<boolean> {
  const res = await fetch(`/transactions/decode?ignoreValidityChecks=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: base58Tx
  });

  if (!res.ok) return false;

  const tx = await res.json();
  return tx?.type === txType;
}



export async function createIssueAssetTransaction(
  issuerAddress: string,
  issuerPublicKey: string,
  assetName: string,
  description: string,
  quantity: number,
  data?: string,
  divisible: boolean = true,
  unspendable: boolean = false,
  
): Promise<string> {
  const account = await getAccount(issuerAddress);
  const txBody = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: 0.01,
    txGroupId: 0,
    recipient: null,
    issuerPublicKey,
    assetName,
    description,
    quantity,
    data: data ? data : "none",
    isDivisible: divisible,
    isUnspendable: unspendable,
  };
  const result = await fetch('/assets/issue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(txBody),
  });
  console.log('txBody', txBody)

  if (!result.ok) {
    throw new Error(`Issue asset failed: ${result.status} ${result.statusText}`);
  }

  const sig = await result.text();
  if (!await isValidQortalTx(sig, "ISSUE_ASSET")) throw new Error(`response from issueAssetTransaction doesn't seem to be a signature: ${sig}`);

  return sig;
}



export async function issueAsset(
  issuerAddress: string,
  issuerPublicKey: string,
  assetName: string,
  description: string,
  quantity: number,
  data?: string,
  divisible: boolean = true,
  unspendable: boolean = false,
  
): Promise<object> {
  const unsigned = await createIssueAssetTransaction(
    issuerAddress,
    issuerPublicKey,
    assetName,
    description,
    quantity,
    data,
    divisible,
    unspendable,
  );

  console.log('unsignedTx', unsigned)
  return await signAndBroadcast(unsigned);
}


// --- core: create unsigned UPDATE_ASSET ---

/**
 * Build an unsigned UPDATE_ASSET transaction for /assets/update.
 *
 * You can update any subset of:
 *  - newOwner (Qortal name or address)
 *  - newDescription (string)
 *  - newData (string or object -> stringified)
 *
 * @param ownerAddress     current owner's address (your account address)
 * @param ownerPublicKey   current owner's public key
 * @param assetId          asset to update
 * @param changes          fields to change (any subset)
 * @param opts             fee/txGroupId overrides
 * @returns base58-encoded unsigned transaction
 */
export async function createUpdateAssetTransaction(
  ownerAddress: string,
  ownerPublicKey: string,
  assetId: number,
  changes: {
    newOwner?: string;            // Qortal name or address
    newDescription?: string;
    newData?: string | object;    // if object, will be JSON.stringified
  },
  opts?: {
    fee?: number;                 // default 0.01
    txGroupId?: number;           // default 0
  }
): Promise<string> {
  if (!changes || (!changes.newOwner && !changes.newDescription && typeof changes.newData === 'undefined')) {
    throw new Error('Nothing to update: provide at least one of newOwner, newDescription, or newData');
  }

  const account = await getAccount(ownerAddress);

  // Normalize optional fields
  const txBody: any = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: opts?.fee ?? 0.01,
    txGroupId: opts?.txGroupId ?? 0,
    assetId,
    ownerPublicKey
  };

  if (typeof changes.newOwner === 'string' && changes.newOwner.trim().length > 0) {
    // Accept Qortal name or address
    txBody.newOwner = await resolveRecipientToAddress(changes.newOwner.trim());
  }

  if (typeof changes.newDescription === 'string') {
    txBody.newDescription = changes.newDescription;
  }

  if (typeof changes.newData !== 'undefined') {
    txBody.newData = typeof changes.newData === 'string'
      ? changes.newData
      : JSON.stringify(changes.newData);
  }

  const res = await fetch('/assets/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(txBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Update asset failed: ${res.status} ${res.statusText} ${text}`);
  }

  const unsigned = await res.text();

  // Qortal type guard (mirrors your other helpers)
  if (!await isValidQortalTx(unsigned, 'UPDATE_ASSET')) {
    throw new Error(`Response from /assets/update doesn't look like UPDATE_ASSET; got: ${unsigned.slice(0, 16)}…`);
  }

  return unsigned;
}

// --- convenience: build → sign → broadcast ---

/**
 * High-level convenience API to update an asset and broadcast it.
 */
export async function updateAsset(
  ownerAddress: string,
  ownerPublicKey: string,
  assetId: number,
  changes: {
    newOwner?: string;            // Qortal name or address
    newDescription?: string;
    newData?: string | object;
  },
  opts?: { fee?: number; txGroupId?: number }
): Promise<object> {
  const unsigned = await createUpdateAssetTransaction(
    ownerAddress,
    ownerPublicKey,
    assetId,
    changes,
    opts
  );

  return await signAndBroadcast(unsigned);
}



