// src/explorerStats/storage.ts
import type {  ExplorerStats } from "./types";

const PREFIX = "qassets.explorer.v1.";
const key = (id: number) => `${PREFIX}${id}`;

export function loadStats(id: number): ExplorerStats | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as ExplorerStats;
    return s?.v === 1 ? s : null;
  } catch {
    return null;
  }
}

export function saveStats(s: ExplorerStats) {
  try {
    localStorage.setItem(key(s.assetId), JSON.stringify(s));
  } catch {
    /* quota ignore */
  }
}
