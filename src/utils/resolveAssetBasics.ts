// utils/resolveAssetBasics.ts
import { readAssetsIndexSync, ensureAssetMini } from '../bootstrap/assetsBootstrap';

export type AssetBasics = {
  assetId: number;
  assetName: string;
  ownerAddress: string;
  maxSupply: number;
};

export async function resolveAssetBasics(assetId: number): Promise<AssetBasics | null> {
  const idx = readAssetsIndexSync();
  const cached = idx?.[assetId];
  if (cached?.name && cached?.owner) {
    return { assetId, assetName: cached.name, ownerAddress: cached.owner, maxSupply: cached.quantity };
  }

  const mini = await ensureAssetMini(assetId);
  if (!mini) return null;
  return { assetId, assetName: mini.name, ownerAddress: mini.owner, maxSupply: mini.quantity };
}
