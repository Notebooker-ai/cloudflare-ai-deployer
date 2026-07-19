/**
 * Encrypted, expiring session — no server-side store, no database.
 *
 * The user's Cloudflare API token lives ONLY inside an AES-GCM-sealed cookie.
 * The key is derived from SESSION_SECRET (a wrangler secret). Tampering fails
 * decryption; the embedded `exp` is verified server-side so a forged browser
 * clock can't extend a session.
 */

export interface SessionPayload {
  /** User's scoped Cloudflare API token. */
  cfToken: string;
  /** Account id resolved once at auth time. */
  accountId: string;
  /** Account's workers.dev subdomain (for building base URLs), if known. */
  subdomain?: string;
  /** Absolute expiry, epoch seconds. */
  exp: number;
  /** Issued-at, epoch seconds (for absolute-lifetime cap on sliding renewal). */
  iat: number;
}

const COOKIE_NAME = 'nb_session';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const MAX_LIFETIME_SECONDS = 24 * 60 * 60; // hard cap even with sliding renewal

export { COOKIE_NAME, DEFAULT_TTL_SECONDS, MAX_LIFETIME_SECONDS };

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest('SHA-256', raw); // 32 bytes -> AES-256
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(payload: SessionPayload, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toBase64Url(combined);
}

export async function unseal(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const combined = fromBase64Url(token);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    if (typeof payload.iat === 'number' && now - payload.iat > MAX_LIFETIME_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie attributes used everywhere we set the session. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
