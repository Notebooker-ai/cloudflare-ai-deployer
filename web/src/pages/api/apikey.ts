import type { APIContext } from 'astro';
import { requireSession } from '../../lib/auth';
import { sessionWorkerKey } from '../../lib/deployer';
import { json, toErrorResponse } from '../../lib/util';

export const prerender = false;

/**
 * Return the endpoint API key for this session, if one was generated during
 * it (deploy or cycle). Keys are never persisted — a returning visitor gets
 * null and renews (cycles) to view a new one.
 */
export async function GET(ctx: APIContext) {
  try {
    const { session } = await requireSession(ctx);
    const worker = new URL(ctx.request.url).searchParams.get('worker') ?? '';
    const apiKey = worker ? sessionWorkerKey(session.workerKeys, worker) : null;
    return json({ apiKey, recoverable: !!apiKey });
  } catch (e) {
    return toErrorResponse(e);
  }
}
