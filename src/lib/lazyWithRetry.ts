import { lazy, type ComponentType } from 'react';

const RETRY_DELAYS_MS = [400, 1500];

/** True for a screen bundle that failed to download (offline, or replaced by a newer deploy). */
export function isChunkLoadError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \S+ failed/i.test(message);
}

/** React.lazy keeps a failed import forever, so the download is retried before giving up. */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await factory();
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length || !isChunkLoadError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  });
}
