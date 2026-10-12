import { useEffect, useMemo, useState } from 'react';

export const LIST_PAGE_SIZE = 60;

/**
 * Renders a long list in pages so thousands of records never hit the DOM at once.
 * The page window resets whenever `resetKey` changes (filters, search, tab).
 */
export function useProgressiveList<T>(items: readonly T[], resetKey: unknown = null, pageSize = LIST_PAGE_SIZE) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  const visible = useMemo(() => (items.length > limit ? items.slice(0, limit) : items), [items, limit]);
  return {
    visible,
    total: items.length,
    shown: visible.length,
    remaining: Math.max(0, items.length - visible.length),
    pageSize,
    showMore: () => setLimit((n) => n + pageSize),
    showAll: () => setLimit(items.length),
  };
}
