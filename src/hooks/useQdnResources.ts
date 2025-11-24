import { useCallback, useEffect, useRef, useState } from 'react';

export type QdnStatus = {
  status: string;
  id: string;
  title: string;
  description: string;
};

export type QdnResource = {
  name: string;
  service: string;
  identifier: string;
  status?: QdnStatus;
  size?: number;
  created?: number;
  updated?: number;
  metadata?: Record<string, any>;
};

const PAGE = 500;
const MAX_AUTO_PAGES = 40;

/**
 * Generic hook for listing QDN resources for a given name, with paging support.
 */
export function useQdnResources(name: string | null) {
  const [rows, setRows] = useState<QdnResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);

  const resetState = useCallback(() => {
    setRows([]);
    setOffset(0);
    setHasMore(false);
    setError(null);
    offsetRef.current = 0;
    hasMoreRef.current = false;
  }, []);

  const fetchPage = useCallback(
    async (startOffset?: number) => {
      if (!name) return { count: 0, hasMore: false };
      const nextOffset =
        typeof startOffset === 'number' && startOffset >= 0 ? startOffset : offsetRef.current;
      setLoading(true);
      setError(null);
      console.log(offset);
      try {
        const res = await qortalRequest({
          action: 'LIST_QDN_RESOURCES',
          name,
          default: false,
          includeStatus: true,
          includeMetadata: true,
          followedOnly: false,
          excludeBlocked: false,
          limit: PAGE,
          offset: nextOffset,
          reverse: true,
        });
        const list: QdnResource[] = Array.isArray(res) ? res : [];
        setRows((prev) => (nextOffset === 0 ? list : prev.concat(list)));
        const more = list.length === PAGE;
        const updatedOffset = nextOffset + list.length;
        setHasMore(more);
        setOffset(updatedOffset);
        offsetRef.current = updatedOffset;
        hasMoreRef.current = more;
        return { count: list.length, hasMore: more };
      } catch (e: any) {
        setError(e?.message || 'Failed to list resources');
        if (nextOffset === 0) {
          setRows([]);
          setOffset(0);
        }
        hasMoreRef.current = false;
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [name]
  );

  const loadMore = useCallback(async () => {
    if (!name) return;
    await fetchPage();
  }, [name, fetchPage]);

  const loadAll = useCallback(async () => {
    if (!name) return;
    if (!hasMoreRef.current) return;
    let iterations = 0;
    while (hasMoreRef.current && iterations < MAX_AUTO_PAGES) {
      await fetchPage();
      iterations += 1;
    }
  }, [name, fetchPage]);

  const reload = useCallback(async () => {
    resetState();
    if (!name) return;
    await fetchPage(0);
  }, [resetState, fetchPage, name]);

  useEffect(() => {
    resetState();
    if (name) void fetchPage(0);
  }, [name, fetchPage, resetState]);

  return { rows, loading, hasMore, loadMore, loadAll, error, reset: resetState, reload };
}
