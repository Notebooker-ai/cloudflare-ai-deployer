import type { APIContext } from 'astro';
import { requireSession, updateSession } from '../../lib/auth';
import { sessionWorkerKey } from '../../lib/deployer';
import { buildBaseUrl, json, sanitizeWorkerName, toErrorResponse } from '../../lib/util';

export const prerender = false;

/**
 * Return the endpoint API key for this session, if one was generated during
 * it (deploy or cycle) or pasted in. Keys are never persisted — a returning
 * visitor gets null and either pastes a saved key or renews to get a new one.
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

/**
 * Accept a key the user saved elsewhere: verify it actually authenticates
 * against their deployed worker, then hold it in the session cookie only.
 */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const body = await ctx.request.json().catch(() => ({}));
    const workerName = sanitizeWorkerName((body.workerName ?? '').toString());
    const apiKey = (body.apiKey ?? '').toString().trim();
    if (!workerName || !apiKey) return json({ error: 'workerName and apiKey are required' }, 400);

    const subdomain = session.subdomain ?? (await cf.getWorkersSubdomain(session.accountId));
    if (!subdomain) return json({ error: 'No workers.dev subdomain on this account.' }, 400);

    const probe = await fetch(`${buildBaseUrl(workerName, subdomain)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (probe.status === 401) {
      return json({ error: 'That key was rejected by your endpoint (401). Paste the current key, or renew.' }, 400);
    }
    if (!probe.ok) {
      return json({ error: `Could not verify the key against your endpoint (${probe.status}).` }, 502);
    }

    await updateSession(ctx, session, {
      workerKeys: { ...session.workerKeys, [workerName]: apiKey },
    });
    return json({ ok: true, apiKey });
  } catch (e) {
    return toErrorResponse(e);
  }
}
