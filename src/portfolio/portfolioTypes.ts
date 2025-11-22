export interface Wallet {
  address: string;
  label?: string;
  name?: string;
}

export interface HoldingPerWallet {
  [address: string]: number; // already normalized
}

export interface HoldingAggregate {
  assetId: number;
  total: number; // sum of 'perWallet'
  perWallet: HoldingPerWallet;
}

export interface AssetMini {
  assetId: number;
  name: string;
  isDivisible: boolean;
  isUnspendable: boolean;
  owner: string;
  description?: string;
}

export interface PortfolioState {
  wallets: Wallet[];
  assetsIndex: Record<number, AssetMini>; // assetId -> mini meta
  holdings: Record<number, HoldingAggregate>;
  loading: boolean;
  error: string | null;
}
