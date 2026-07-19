import type { APIContext } from 'astro';
import { requireSession } from '../../lib/auth';
import { discover } from '../../lib/deployer';
import { json, toErrorResponse } from '../../lib/util';

export const prerender = false;

/** Return the current (readable) API key from the user's KV config. */
export async function GET(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const worker = new URL(ctx.request.url).searchParams.get('worker') ?? undefined;
    const subdomain = session.subdomain ?? (await cf.getWorkersSubdomain(session.accountId));
    const state = await discover(cf, session.accountId, subdomain, worker);

    if (!state.config?.apiKey) {
      return json({ apiKey: null, recoverable: false, kind: state.kind });
    }
    return json({
      apiKey: state.config.apiKey,
      apiKeyId: state.config.apiKeyId,
      keyRotatedAt: state.config.keyRotatedAt ?? null,
      recoverable: true,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
