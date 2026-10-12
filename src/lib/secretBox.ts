import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Server-only. Encrypts merchant API secrets at rest with AES-256-GCM under a key that never leaves the server. */

export function parseSecretKey(raw: string | undefined): Buffer | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  return key.length === 32 ? key : null;
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** Returns null when the value was not sealed with this key or was tampered with. */
export function openSecret(sealed: string, key: Buffer): string | null {
  const [version, iv, tag, body] = String(sealed ?? '').split(':');
  if (version !== 'v1' || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
