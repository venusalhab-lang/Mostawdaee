import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, parseSecretKey, sealSecret } from '../secretBox';

describe('secretBox', () => {
  const key = randomBytes(32);

  it('round-trips and never stores the plain text', () => {
    const sealed = sealSecret('s3cr3t-كلمة', key);
    expect(sealed).not.toContain('s3cr3t');
    expect(openSecret(sealed, key)).toBe('s3cr3t-كلمة');
    expect(sealSecret('same', key)).not.toBe(sealSecret('same', key));
  });

  it('refuses a wrong key or a tampered value', () => {
    const sealed = sealSecret('value', key);
    expect(openSecret(sealed, randomBytes(32))).toBeNull();
    const parts = sealed.split(':');
    parts[3] = Buffer.from('other').toString('base64');
    expect(openSecret(parts.join(':'), key)).toBeNull();
    expect(openSecret('garbage', key)).toBeNull();
  });

  it('accepts 32-byte keys as hex or base64 only', () => {
    expect(parseSecretKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(parseSecretKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseSecretKey('short')).toBeNull();
    expect(parseSecretKey(undefined)).toBeNull();
  });
});
