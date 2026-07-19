import type { APIContext } from 'astro';
import { CloudflareClient } from '../../lib/cfApi';
import { clearSession, establishSession, getSession } from '../../lib/auth';
import { json, toErrorResponse } from '../../lib/util';

export const prerender = false;

/** Report current auth status (non-sensitive) for the dashboard shell. */
export async function GET(ctx: APIContext) {
  const session = await getSession(ctx);
  return json({
    authenticated: !!session,
    accountId: session?.accountId ?? null,
    exp: session?.exp ?? null,
  });
}

/** Verify a pasted token, resolve the account, and seal the session cookie. */
export async function POST(ctx: APIContext) {
  try {
    const { token, accountId: preferredAccount } = await ctx.request.json();
    if (!token || typeof token !== 'string') {
      return json({ error: 'Missing token' }, 400);
    }

    const cf = new CloudflareClient(token.trim());
    const verified = await cf.verifyToken();
    if (!verified || verified.status !== 'active') {
      return json({ error: 'Token is invalid or inactive' }, 401);
    }

    const accounts = await cf.listAccounts();
    if (!accounts.length) {
      return json({ error: 'Token can’t access any account. Check its Account Resources scope.' }, 403);
    }
    const account =
      accounts.find((a) => a.id === preferredAccount) || accounts[0];

    const subdomain = await cf.getWorkersSubdomain(account.id);

    await establishSession(ctx, {
      cfToken: token.trim(),
      accountId: account.id,
      subdomain: subdomain ?? undefined,
    });

    return json({
      ok: true,
      accountId: account.id,
      accountName: account.name,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      subdomain,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Log out — clear the cookie. */
export async function DELETE(ctx: APIContext) {
  clearSession(ctx);
  return json({ ok: true });
}
