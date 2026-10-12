import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '../lazyWithRetry';

describe('chunk load errors', () => {
  it('recognises a screen bundle that failed to download', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Vault-abc.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 12 failed.' })).toBe(true);
  });

  it('leaves ordinary render errors to the normal retry', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
