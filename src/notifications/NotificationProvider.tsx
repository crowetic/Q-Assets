import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NotifV1 } from '../types/notifications';
import { fetchNotificationByRid } from '../utils/notify';
import { loadIndex } from './notifyIndex';

type NotificationEntry = {
  key: string;
  rid: string;
  scope: string;
  notif: NotifV1;
  read: boolean;
  dismissed?: boolean;
};

type NotificationState = { byKey: Record<string, NotificationEntry> };

type Ctx = {
  state: NotificationState;
  refreshScope: (scopeKey: string, limit?: number) => Promise<void>;
  markRead: (key: string) => void;
  dismiss: (key: string) => void;
  markAllRead: () => void;
};

const STORAGE_KEY = 'qassets_notifications_v1';

const NotificationContext = createContext<Ctx | null>(null);

const keyFor = (rid: string, scope: string) => `${rid}::${scope || 'global'}`;

function migrateLegacy(raw: any): NotificationState {
  if (raw?.byKey) return raw;
  if (raw?.byId) {
    const byKey: Record<string, NotificationEntry> = {};
    Object.values(raw.byId).forEach((entry: any) => {
      if (!entry?.rid || !entry?.notif) return;
      const scope = entry.notif.scope || 'global';
      const key = keyFor(entry.rid, scope);
      byKey[key] = {
        key,
        rid: entry.rid,
        scope,
        notif: entry.notif,
        read: Boolean(entry.read),
        dismissed: Boolean(entry.dismissed),
      };
    });
    return { byKey };
  }
  return { byKey: {} };
}

function loadInitialState(): NotificationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return migrateLegacy(parsed);
    }
  } catch {
    /* empty */
  }
  return { byKey: {} };
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<NotificationState>(() => loadInitialState());

  const persist = useCallback((updater: (prev: NotificationState) => NotificationState) => {
    setState((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* empty */
      }
      return next;
    });
  }, []);

  const refreshScope = useCallback<Ctx['refreshScope']>(
    async (scopeKey, limit = 25) => {
      try {
        const index = await loadIndex(scopeKey);
        if (!index?.items?.length) return;
        const slice = index.items.slice(0, limit);
        const fetched = await Promise.all(
          slice.map(async (item) => {
            const notif = await fetchNotificationByRid(item.rid);
            if (!notif) return null;
            return { rid: item.rid, notif };
          })
        );

        persist((prev) => {
          const byKey = { ...prev.byKey };
          for (const entry of fetched) {
            if (!entry) continue;
            const scope = entry.notif.scope || scopeKey;
            const key = keyFor(entry.rid, scope);
            const existing = byKey[key];
            byKey[key] = {
              key,
              rid: entry.rid,
              scope,
              notif: entry.notif,
              read: existing?.read ?? false,
              dismissed: existing?.dismissed ?? false,
            };
          }
          const entries = Object.entries(byKey)
            .sort(([, a], [, b]) => (b.notif.createdAt || 0) - (a.notif.createdAt || 0))
            .slice(0, 120);
          const pruned: Record<string, NotificationEntry> = {};
          for (const [, entry] of entries) pruned[entry.key] = entry;
          return { byKey: pruned };
        });
      } catch (e) {
        console.error('refreshScope failed', e);
      }
    },
    [persist]
  );

  const markRead = useCallback<Ctx['markRead']>(
    (key) => {
      if (!key) return;
      persist((prev) => {
        const entry = prev.byKey[key];
        if (!entry) return prev;
        return { byKey: { ...prev.byKey, [key]: { ...entry, read: true } } };
      });
    },
    [persist]
  );

  const dismiss = useCallback<Ctx['dismiss']>(
    (key) => {
      if (!key) return;
      persist((prev) => {
        const entry = prev.byKey[key];
        if (!entry) return prev;
        return { byKey: { ...prev.byKey, [key]: { ...entry, dismissed: true } } };
      });
    },
    [persist]
  );

  const markAllRead = useCallback(() => {
    persist((prev) => {
      const byKey: Record<string, NotificationEntry> = {};
      for (const [key, entry] of Object.entries(prev.byKey)) {
        byKey[key] = { ...entry, read: true };
      }
      return { byKey };
    });
  }, [persist]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      refreshScope,
      markRead,
      dismiss,
      markAllRead,
    }),
    [state, refreshScope, markRead, dismiss, markAllRead]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
