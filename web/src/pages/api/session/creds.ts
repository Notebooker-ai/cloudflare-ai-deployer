import type { APIContext } from 'astro';
import { establishSession } from '../../../lib/auth';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/**
 * Credentials-only sign-in: just an endpoint base URL + bearer key (e.g. from
 * a downloaded credentials.txt). Verified against the endpoint's /models, then
 * held in the encrypted session cookie — no Cloudflare token involved, so the
 * dashboard runs in test-only mode.
 */
export async function POST(ctx: APIContext) {
  try {
    const body = await ctx.request.json().catch(() => ({}));
    let baseUrl = (body.baseUrl ?? '').toString().trim().replace(/\/+$/, '');
    const apiKey = (body.apiKey ?? '').toString().trim();

    if (!baseUrl || !apiKey) return json({ error: 'baseUrl and apiKey are required' }, 400);
    if (!/^https:\/\//.test(baseUrl)) return json({ error: 'baseUrl must be https' }, 400);
    if (!/\/v1$/.test(baseUrl)) baseUrl = `${baseUrl}/v1`;

    let probe: Response;
    try {
      probe = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return json({ error: 'Could not reach that endpoint. Check the base URL.' }, 400);
    }
    if (probe.status === 401) {
      return json({ error: 'The endpoint rejected that key (401).' }, 400);
    }
    if (!probe.ok) {
      return json({ error: `Endpoint responded with ${probe.status}. Check the base URL.` }, 400);
    }

    await establishSession(ctx, { endpoint: { baseUrl, apiKey } });
    return json({ ok: true, mode: 'creds' });
  } catch (e) {
    return toErrorResponse(e);
  }
}
