// src/portfolio/PortfolioProvider.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import type { Wallet, PortfolioState, HoldingAggregate, AssetMini } from './portfolioTypes';
import { getAssetBalances } from '../utils/qortalAssetRequests'; // you already have these
import pLimit from 'p-limit';
import { useAuth } from 'qapp-core';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../bootstrap/assetsBootstrap';
import { getAccountDataCached, getNameDataCached, getPrimaryNameCached } from '../utils/qortalApi';

type Action =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; payload: { wallets: Wallet[]; assetsIndex: Record<number, AssetMini> } }
  | { type: 'INIT_FAIL'; error: string }
  | { type: 'SET_WALLETS'; wallets: Wallet[] }
  | { type: 'SET_HOLDINGS'; holdings: Record<number, HoldingAggregate> }
  | { type: 'MERGE_ASSETS_INDEX'; assets: Record<number, AssetMini> }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_LOADING'; loading: boolean };

const initialState: PortfolioState = {
  wallets: [],
  assetsIndex: {},
  holdings: {},
  loading: false,
  error: null,
};

function reducer(state: PortfolioState, action: Action): PortfolioState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, loading: true, error: null };
    case 'INIT_SUCCESS':
      return { ...state, ...action.payload, loading: false, error: null };
    case 'INIT_FAIL':
      return { ...state, loading: false, error: action.error };
    case 'SET_WALLETS':
      return { ...state, wallets: action.wallets };
    case 'SET_HOLDINGS':
      return { ...state, holdings: action.holdings };
    case 'MERGE_ASSETS_INDEX':
      return { ...state, assetsIndex: { ...state.assetsIndex, ...action.assets } };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    default:
      return state;
  }
}

interface PortfolioContextValue extends PortfolioState {
  addWallet: (address: string, label?: string) => boolean;
  addWalletByNameOrAddress: (input: string, label?: string) => Promise<boolean>;
  removeWallet: (address: string) => void;
  setWallets: (wallets: Wallet[]) => void;
  refreshHoldings: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextValue | undefined>(undefined);

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { address: userAddress } = useAuth();

  // Load initial wallets from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('qa_portfolio_wallets');
    const wallets: Wallet[] = saved ? JSON.parse(saved) : [];
    const skipMine = localStorage.getItem('qa_portfolio_skip_mine') === '1';

    if (userAddress && !skipMine && !wallets.some((w) => w.address === userAddress)) {
      wallets.unshift({ address: userAddress, label: 'My Account' });
    }
    (async () => {
      try {
        dispatch({ type: 'INIT_START' });
        const cached = readAssetsIndexSync();
        if (cached) {
          dispatch({ type: 'INIT_SUCCESS', payload: { wallets, assetsIndex: cached } });
        }
        const fresh = await ensureAssetsIndexLoaded();
        if (!cached || Object.keys(fresh).length !== Object.keys(cached).length) {
          dispatch({ type: 'INIT_SUCCESS', payload: { wallets, assetsIndex: fresh } });
        }

        localStorage.setItem('qa_portfolio_wallets', JSON.stringify(wallets));
      } catch (e: any) {
        dispatch({ type: 'INIT_FAIL', error: String(e?.message || e) });
      }
    })();
  }, [userAddress]);

  // Persist wallets
  useEffect(() => {
    localStorage.setItem('qa_portfolio_wallets', JSON.stringify(state.wallets));
  }, [state.wallets]);

  const addWallet = useCallback(
    (address: string, label?: string): boolean => {
      const a = address.trim();
      if (!a) return false;
      if (state.wallets.some((w) => w.address === a)) return false;
      dispatch({ type: 'SET_WALLETS', wallets: [...state.wallets, { address: a, label }] });
      return true;
    },
    [state.wallets]
  );

  const setWallets = useCallback((wallets: Wallet[]) => {
    const unique: Wallet[] = [];
    const seen = new Set<string>();
    wallets.forEach((w) => {
      if (!w.address) return;
      const addr = w.address.trim();
      if (!addr || seen.has(addr)) return;
      seen.add(addr);
      unique.push({ address: addr, label: w.label, name: w.name });
    });
    dispatch({ type: 'SET_WALLETS', wallets: unique });
  }, []);

  // helpers at top of file (or a small utils module)
  const isQortalAddress = (s: string) => /^Q[0-9A-Za-z]{25,}$/.test(s);

  async function resolveNameToAddress(name: string): Promise<string | null> {
    try {
      const data = await getNameDataCached(name);
      const owner = data?.owner;
      return typeof owner === 'string' && owner.startsWith('Q') ? owner : null;
    } catch {
      return null;
    }
  }

  async function normalizeAndVerifyAddress(addr: string): Promise<string | null> {
    // Some nodes throw for empty accounts; still accept valid-looking addresses
    try {
      const acc = await getAccountDataCached(addr);
      if (acc?.address && typeof acc.address === 'string') return acc.address; // canonicalize
      return addr;
    } catch {
      return isQortalAddress(addr) ? addr : null;
    }
  }

  const addWalletByNameOrAddress = useCallback(
    async (input: string, label?: string): Promise<boolean> => {
      const raw = (input ?? '').trim();
      if (!raw) return false;

      let finalAddress: string | null = null;
      let resolvedName: string | undefined;

      if (isQortalAddress(raw)) {
        // Address provided
        finalAddress = await normalizeAndVerifyAddress(raw);
        if (!finalAddress) return false;

        // Optional: show the user's primary name if it exists
        try {
          const n = await getPrimaryNameCached(finalAddress);
          if (typeof n === 'string' && n) resolvedName = n;
        } catch {
          /* ignore */
        }
      } else {
        // Name provided
        resolvedName = raw;
        const addr = await resolveNameToAddress(raw);
        if (!addr) return false;

        finalAddress = await normalizeAndVerifyAddress(addr);
        if (!finalAddress) return false;
      }

      // De-dupe
      if (state.wallets.some((w) => w.address === finalAddress)) return false;

      // Persist
      dispatch({
        type: 'SET_WALLETS',
        wallets: [...state.wallets, { address: finalAddress, label, name: resolvedName }],
      });
      return true;
    },
    [state.wallets]
  );

  const removeWallet = useCallback(
    (address: string) => {
      if (address === userAddress) localStorage.setItem('qa_portfolio_skip_mine', '1');
      const next = state.wallets.filter((w) => w.address !== address);
      dispatch({ type: 'SET_WALLETS', wallets: next });
    },
    [state.wallets, userAddress]
  );

  const refreshHoldings = useCallback(async () => {
    // ✅ include auth user even if not tracked
    const addresses = Array.from(
      new Set(
        [...state.wallets.map((w) => w.address), userAddress || undefined].filter(
          Boolean
        ) as string[]
      )
    );

    if (addresses.length === 0) {
      dispatch({ type: 'SET_HOLDINGS', holdings: {} });
      return;
    }

    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      let balances: any[] = [];
      try {
        balances = await getAssetBalances({
          addresses,
          excludeZero: true,
        });
      } catch {
        const assetIds = Object.keys(state.assetsIndex).map(Number);
        const limit = pLimit(4);
        const chunkSize = 400;
        const chunks: number[][] = [];
        for (let i = 0; i < assetIds.length; i += chunkSize)
          chunks.push(assetIds.slice(i, i + chunkSize));

        const resultsArrays = await Promise.all(
          chunks.map((chunk) =>
            limit(() =>
              getAssetBalances({
                addresses, // <-- now includes auth address, deduped
                assetIds: chunk,
                excludeZero: true,
              })
            )
          )
        );

        balances = ([] as any[]).concat(...resultsArrays);
      }

      const holdings: Record<number, HoldingAggregate> = {};
      for (const b of balances) {
        const aid = b.assetId as number;
        const addr = b.address as string;
        const amount = parseFloat(b.balance);
        if (!holdings[aid]) holdings[aid] = { assetId: aid, total: 0, perWallet: {} };
        holdings[aid].total += amount;
        holdings[aid].perWallet[addr] = (holdings[aid].perWallet[addr] || 0) + amount;
      }

      dispatch({ type: 'SET_HOLDINGS', holdings });

      const missingIds = Object.keys(holdings)
        .map(Number)
        .filter((id) => !state.assetsIndex[id]);
      if (missingIds.length) {
        const limit = pLimit(4);
        const fetched = await Promise.all(
          missingIds.map((id) =>
            limit(async () => {
              const info = await ensureAssetMini(id).catch(() => null);
              return info ? { id, info } : null;
            })
          )
        );
        const merge: Record<number, AssetMini> = {};
        for (const row of fetched) {
          if (!row) continue;
          merge[row.id] = row.info;
        }
        if (Object.keys(merge).length) {
          dispatch({ type: 'MERGE_ASSETS_INDEX', assets: merge });
        }
      }
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', error: String(e?.message || e) });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.wallets, state.assetsIndex, userAddress]);

  const value = useMemo<PortfolioContextValue>(
    () => ({
      ...state,
      addWallet,
      addWalletByNameOrAddress,
      removeWallet,
      setWallets,
      refreshHoldings,
    }),
    [state, addWallet, addWalletByNameOrAddress, removeWallet, setWallets, refreshHoldings]
  );

  useEffect(() => {
    if (!Object.keys(state.assetsIndex).length) return;
    if (!state.wallets.length) {
      dispatch({ type: 'SET_HOLDINGS', holdings: {} });
      return;
    }
    const t = setTimeout(() => {
      void refreshHoldings();
    }, 50);
    return () => clearTimeout(t);
  }, [state.assetsIndex, state.wallets, refreshHoldings]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
};

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used within PortfolioProvider');
  return ctx;
}
