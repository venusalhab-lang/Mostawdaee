import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MERCHANT_COLLECTIONS, collection, doc } from '../supabaseDocs';

describe('supabase document paths', () => {
  it('accepts the merchant collections used by the app', () => {
    expect(doc(null, 'users', 'uid', 'inventory', 'p1').id).toBe('p1');
    expect(collection(null, 'users', 'uid', 'vault_records').collection).toBe('vault_records');
    expect(collection(null, 'users', 'uid', 'store_notes').collection).toBe('store_notes');
    expect(doc(null, 'users', 'uid', 'store_notes', 'n1').id).toBe('n1');
  });

  it('rejects a path outside the merchant books', () => {
    expect(() => doc(null, 'users', 'uid', 'secrets', 'x')).toThrow(/Invalid document path/);
    expect(() => collection(null, 'public', 'uid', 'inventory')).toThrow(/Invalid collection path/);
  });

  it('keeps FirebaseProvider session-boot collections on the client allowlist', () => {
    // Guard against the post-login blank screen: a new stream/doc path that is not allowlisted
    // throws inside the auth boot effect and aborts vault/warehouse wiring.
    const source = readFileSync(
      resolve(__dirname, '../../components/FirebaseProvider.tsx'),
      'utf8',
    );
    const used = new Set<string>();
    const pattern = /\b(?:collection|doc)\(\s*db\s*,\s*'users'\s*,\s*[^,]+,\s*'([^']+)'/g;
    for (const match of source.matchAll(pattern)) used.add(match[1]);
    expect([...used].sort()).not.toEqual([]);
    const allowed = new Set<string>(MERCHANT_COLLECTIONS);
    const missing = [...used].filter((name) => !allowed.has(name)).sort();
    expect(missing).toEqual([]);
  });
});
