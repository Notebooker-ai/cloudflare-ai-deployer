/**
 * Session guard shared by every SSR endpoint and gated page.
 * Reads the encrypted cookie, unseals it, and hands back the payload plus a
 * ready-to-use Cloudflare client. Throws a 401 Response when unauthenticated.
 */
import type { APIContext, AstroGlobal } from 'astro';
import { CloudflareClient } from './cfApi';
import {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  seal,
  sessionCookieOptions,
  unseal,
  type SessionPayload,
} from './session';

type Ctx = APIContext | AstroGlobal;

function getSecret(ctx: Ctx): string {
  const secret = (ctx.locals as any)?.runtime?.env?.SESSION_SECRET;
  if (!secret) {
    throw new Response('Server misconfigured: SESSION_SECRET missing', { status: 500 });
  }
  return secret;
}

/** Returns the session payload or null (does not throw) — for page shells. */
export async function getSession(ctx: Ctx): Promise<SessionPayload | null> {
  const cookie = ctx.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return unseal(cookie, getSecret(ctx));
}

export interface AuthedContext {
  session: SessionPayload;
  /** Null for credentials-only sessions (no Cloudflare token). */
  cf: CloudflareClient | null;
}

/** Require a valid session; throws a 401 Response if absent/expired. */
export async function requireSession(ctx: Ctx): Promise<AuthedContext> {
  const session = await getSession(ctx);
  if (!session) {
    throw new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Sliding renewal: re-issue the cookie so active use keeps it alive
  // (capped by MAX_LIFETIME via iat, enforced in unseal).
  const now = Math.floor(Date.now() / 1000);
  const renewed: SessionPayload = { ...session, exp: now + DEFAULT_TTL_SECONDS };
  const resealed = await seal(renewed, getSecret(ctx));
  ctx.cookies.set(COOKIE_NAME, resealed, sessionCookieOptions(DEFAULT_TTL_SECONDS));

  return { session, cf: session.cfToken ? new CloudflareClient(session.cfToken) : null };
}

/** Like requireSession, but rejects credentials-only sessions (403). */
export async function requireCfSession(ctx: Ctx): Promise<{
  session: SessionPayload & { cfToken: string; accountId: string };
  cf: CloudflareClient;
}> {
  const { session, cf } = await requireSession(ctx);
  if (!cf || !session.cfToken || !session.accountId) {
    throw new Response(
      JSON.stringify({ error: 'This action needs a Cloudflare API token — unlock full management from the dashboard.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return { session: session as SessionPayload & { cfToken: string; accountId: string }, cf };
}

/** Establish a new session cookie after a token is verified. */
export async function establishSession(
  ctx: Ctx,
  payload: Omit<SessionPayload, 'exp' | 'iat'>
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + DEFAULT_TTL_SECONDS };
  const sealed = await seal(full, getSecret(ctx));
  ctx.cookies.set(COOKIE_NAME, sealed, sessionCookieOptions(DEFAULT_TTL_SECONDS));
}

/**
 * Re-seal the session with updates (e.g. a freshly generated worker key).
 * Preserves iat; renews exp like the sliding renewal does.
 */
export async function updateSession(
  ctx: Ctx,
  session: SessionPayload,
  patch: Partial<SessionPayload>
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const next: SessionPayload = { ...session, ...patch, exp: now + DEFAULT_TTL_SECONDS };
  const sealed = await seal(next, getSecret(ctx));
  ctx.cookies.set(COOKIE_NAME, sealed, sessionCookieOptions(DEFAULT_TTL_SECONDS));
}

export function clearSession(ctx: Ctx): void {
  // Expire via set() with the same attributes the cookie was issued with;
  // verified live to emit `nb_session=; Max-Age=0` and end the session.
  ctx.cookies.set(COOKIE_NAME, '', { ...sessionCookieOptions(0), maxAge: 0 });
}
