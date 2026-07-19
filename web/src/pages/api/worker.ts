import type { APIContext } from 'astro';
import { requireSession } from '../../lib/auth';
import { discover, deploy } from '../../lib/deployer';
import { json, toErrorResponse } from '../../lib/util';
import type { ModelConfig } from '../../lib/template';

export const prerender = false;

/** Discovery: derive the dashboard state from the user's account (no DB). */
export async function GET(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const subdomain = session.subdomain ?? (await cf.getWorkersSubdomain(session.accountId));
    const preferred = new URL(ctx.request.url).searchParams.get('worker') ?? undefined;
    const state = await discover(cf, session.accountId, subdomain, preferred);
    return json(state);
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Deploy (or redeploy) the worker with the chosen models. */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const body = await ctx.request.json();
    const models = (body.models ?? {}) as ModelConfig;
    const workerNameRaw = (body.workerName ?? '') as string;

    if (!models.chat && !models.text_to_speech && !models.speech_to_text && !models.embedding) {
      return json({ error: 'Select at least one model.' }, 400);
    }

    const subdomain = session.subdomain ?? (await cf.getWorkersSubdomain(session.accountId));
    if (!subdomain) {
      return json(
        {
          error:
            'No workers.dev subdomain is registered on this account. Enable it once in the Cloudflare dashboard (Workers & Pages → your subdomain), then retry.',
        },
        400
      );
    }

    // Reuse the existing key on redeploy so clients keep working.
    const existing = await discover(cf, session.accountId, subdomain, workerNameRaw);
    const reuseKey = existing.config?.apiKey;
    const reuseKeyId = existing.config?.apiKeyId;

    const result = await deploy(cf, session.accountId, subdomain, {
      workerNameRaw,
      models,
      apiKey: reuseKey,
      apiKeyId: reuseKeyId,
    });

    return json({ ok: true, ...result });
  } catch (e) {
    return toErrorResponse(e);
  }
}
