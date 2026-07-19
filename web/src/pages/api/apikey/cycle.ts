import type { APIContext } from 'astro';
import { requireCfSession, updateSession } from '../../../lib/auth';
import { cycleKey } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/**
 * Rotate the endpoint API key in place and return the fresh, copyable value.
 * The new key is held only in the caller's encrypted session cookie — once
 * this session ends, it cannot be viewed again (cycle again to get a new one).
 */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireCfSession(ctx);
    const body = await ctx.request.json().catch(() => ({}));
    const workerName = (body.workerName ?? '') as string;
    if (!workerName) return json({ error: 'workerName is required' }, 400);

    const { apiKey } = await cycleKey(cf, session.accountId, workerName);

    await updateSession(ctx, session, {
      workerKeys: { ...session.workerKeys, [workerName]: apiKey },
    });

    return json({ ok: true, apiKey, keyRotatedAt: new Date().toISOString() });
  } catch (e) {
    return toErrorResponse(e);
  }
}
