import type { APIContext } from 'astro';
import { requireCfSession } from '../../lib/auth';
import { getUsage } from '../../lib/usage';
import { json, toErrorResponse } from '../../lib/util';

export const prerender = false;

/** Estimated Workers AI neuron usage for the current UTC day. */
export async function GET(ctx: APIContext) {
  try {
    const { session, cf } = await requireCfSession(ctx);
    const usage = await getUsage(cf, session.accountId);
    return json(usage);
  } catch (e) {
    return toErrorResponse(e);
  }
}
