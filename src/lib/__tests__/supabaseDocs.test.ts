import { describe, expect, it } from 'vitest';
import { collection, doc } from '../supabaseDocs';

describe('supabase document paths', () => {
  it('accepts the merchant collections used by the app', () => {
    expect(doc(null, 'users', 'uid', 'inventory', 'p1').id).toBe('p1');
    expect(collection(null, 'users', 'uid', 'vault_records').collection).toBe('vault_records');
  });

  it('rejects a path outside the merchant books', () => {
    expect(() => doc(null, 'users', 'uid', 'secrets', 'x')).toThrow(/Invalid document path/);
    expect(() => collection(null, 'public', 'uid', 'inventory')).toThrow(/Invalid collection path/);
  });
});
