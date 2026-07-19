import type { APIContext } from 'astro';
import { requireSession } from '../../../lib/auth';
import { cycleKey } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/** Rotate the API key in place and return the fresh, copyable value. */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const body = await ctx.request.json().catch(() => ({}));
    const workerName = (body.workerName ?? '') as string;
    if (!workerName) return json({ error: 'workerName is required' }, 400);

    const { apiKey, config } = await cycleKey(cf, session.accountId, workerName);
    return json({ ok: true, apiKey, apiKeyId: config.apiKeyId, keyRotatedAt: config.keyRotatedAt });
  } catch (e) {
    return toErrorResponse(e);
  }
}
