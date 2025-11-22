export type DividendEntry = {
  app: string; // Q-Assets
  appVersion: string; // e.g., 0.51b
  type: 'dividends';
  assetId: number;
  assetName?: string;
  payoutAssetId: number; // 0 = QORT
  payoutAssetName?: string; // “QORT” or “Asset #id”
  totalInput: number; // exactly the user’s entered total (8dp)
  totalPlanned: number; // sum of per-recipient (8dp)
  issuerAddress: string;
  issuerPrimaryName?: string | null;
  timestamp: number; // ms
  recipients: Array<{
    address: string;
    name?: string | null;
    amount: number; // 8dp
    // optional tx id if available from API; keep nullable to avoid blocking
    txId?: string | null;
  }>;
  notes?: string;
  meta?: Record<string, any>;
};

export type DividendHead = {
  app: string; // Q-Assets
  appVersion: string;
  assetId: number;
  lastCounter: number; // last used counter (>= 0)
  lastIdentifier: string; // full identifier string for the last entry
  updated: number; // ms
};
