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
    mode: session ? (session.cfToken ? 'cloudflare' : 'creds') : null,
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

    // Validate by listing accounts — this is the capability the app actually
    // needs, and it works for account-scoped tokens that don't include
    // "User Details: Read" (which /user/tokens/verify requires). A truly
    // invalid token fails here with a 4xx.
    let accounts;
    try {
      accounts = await cf.listAccounts();
    } catch {
      return json({ error: 'Token is invalid or lacks account access.' }, 401);
    }
    if (!accounts.length) {
      return json({ error: 'Token can’t access any account. Check its Account Resources scope.' }, 403);
    }
    const account =
      accounts.find((a) => a.id === preferredAccount) || accounts[0];

    // Pre-flight the token's permissions so a gap surfaces here, with a clear
    // message, instead of as a bare "Authentication error" mid-flow.
    const caps = await cf.checkCapabilities(account.id);
    const missingCore = [
      ...(caps.workers ? [] : ['Workers Scripts: Edit']),
      ...(caps.kv ? [] : ['Workers KV Storage: Edit']),
    ];
    if (missingCore.length) {
      return json(
        {
          error: `Token is missing required permission${missingCore.length > 1 ? 's' : ''}: ${missingCore.join(', ')}. Edit the token at dash.cloudflare.com → API Tokens and retry.`,
        },
        403
      );
    }
    const warnings = [
      ...(caps.ai ? [] : ['Workers AI: Read missing — model catalog won’t load.']),
      ...(caps.analytics ? [] : ['Account Analytics: Read missing — usage monitoring won’t load.']),
    ];

    const subdomain = await cf.getWorkersSubdomain(account.id);

    // Upgrading from a credentials-only session: carry the endpoint key into
    // workerKeys (worker name = first hostname label) so testers keep working.
    const prior = await getSession(ctx);
    let workerKeys: Record<string, string> | undefined = prior?.workerKeys;
    if (prior?.endpoint) {
      try {
        const host = new URL(prior.endpoint.baseUrl).hostname;
        const workerName = host.split('.')[0];
        if (workerName) workerKeys = { ...workerKeys, [workerName]: prior.endpoint.apiKey };
      } catch {
        /* ignore malformed */
      }
    }

    await establishSession(ctx, {
      cfToken: token.trim(),
      accountId: account.id,
      subdomain: subdomain ?? undefined,
      workerKeys,
    });

    return json({
      ok: true,
      accountId: account.id,
      accountName: account.name,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      subdomain,
      warnings,
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
