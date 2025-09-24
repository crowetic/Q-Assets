import React, { createContext, useContext, useMemo, useRef, useState, useCallback } from 'react';

type Label = string;

type FetchEvent = {
  id: number;
  label: Label;
  startedAt: number;
};

type Ctx = {
  activeCount: number;
  activeLabels: Record<Label, number>; // label -> count
  begin: (label: Label) => number; // returns event id
  end: (id: number) => void;
  track<T>(p: Promise<T>, label: Label): Promise<T>;
  isLoading: (label: Label) => boolean; // exact label
  isLoadingPrefix: (prefix: string) => boolean; // "wiki:" matches "wiki:*"
};

const FetchTrackerCtx = createContext<Ctx | null>(null);

export const FetchTrackerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const idSeq = useRef(1);
  const events = useRef<Map<number, FetchEvent>>(new Map());
  const [activeLabels, setActiveLabels] = useState<Record<Label, number>>({});

  const begin = useCallback((label: Label) => {
    const id = idSeq.current++;
    events.current.set(id, { id, label, startedAt: Date.now() });
    setActiveLabels((prev) => ({ ...prev, [label]: (prev[label] || 0) + 1 }));
    return id;
  }, []);

  const end = useCallback((id: number) => {
    const ev = events.current.get(id);
    if (!ev) return;
    events.current.delete(id);
    setActiveLabels((prev) => {
      const n = { ...prev };
      const c = (n[ev.label] || 0) - 1;
      if (c <= 0) delete n[ev.label];
      else n[ev.label] = c;
      return n;
    });
  }, []);

  const track = useCallback(
    async <T,>(p: Promise<T>, label: Label) => {
      const id = begin(label);
      try {
        return await p;
      } finally {
        end(id);
      }
    },
    [begin, end]
  );

  const isLoading = useCallback((label: Label) => Boolean(activeLabels[label]), [activeLabels]);
  const isLoadingPrefix = useCallback(
    (prefix: string) => {
      const keys = Object.keys(activeLabels);
      for (const k of keys) if (k.startsWith(prefix)) return true;
      return false;
    },
    [activeLabels]
  );

  const activeCount = useMemo(
    () => Object.values(activeLabels).reduce((a, b) => a + b, 0),
    [activeLabels]
  );

  const value = useMemo<Ctx>(
    () => ({
      activeCount,
      activeLabels,
      begin,
      end,
      track,
      isLoading,
      isLoadingPrefix,
    }),
    [activeCount, activeLabels, begin, end, track, isLoading, isLoadingPrefix]
  );

  return <FetchTrackerCtx.Provider value={value}>{children}</FetchTrackerCtx.Provider>;
};

export const useFetchTracker = () => {
  const ctx = useContext(FetchTrackerCtx);
  if (!ctx) throw new Error('useFetchTracker must be used within <FetchTrackerProvider>');
  return ctx;
};
