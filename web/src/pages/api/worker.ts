import type { APIContext } from 'astro';
import { requireCfSession, requireSession, updateSession } from '../../lib/auth';
import { discover, deploy } from '../../lib/deployer';
import { json, toErrorResponse } from '../../lib/util';
import { sanitizeWorkerName } from '../../lib/util';
import type { ModelConfig } from '../../lib/template';

export const prerender = false;

/** Discovery: derive the dashboard state from the user's account (no DB). */
export async function GET(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);

    // Credentials-only mode: no Cloudflare access — describe the endpoint by
    // asking it directly which models are live.
    if (!cf || !session.accountId) {
      const ep = session.endpoint;
      if (!ep) return json({ error: 'Session has no Cloudflare access.' }, 403);
      let models: Record<string, string> = {};
      try {
        const res = await fetch(`${ep.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${ep.apiKey}` },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const parsed: any = await res.json();
          for (const m of parsed.data ?? []) {
            if (m.type && m.backend) models[m.type] = m.backend;
          }
        }
      } catch {
        /* endpoint unreachable; dashboard shows testers anyway */
      }
      return json({
        kind: 'creds-only',
        baseUrl: ep.baseUrl,
        apiKey: ep.apiKey,
        models,
        subdomain: null,
      });
    }

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
    const { session, cf } = await requireCfSession(ctx);
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
            'No workers.dev subdomain is registered on this account. Visit Workers & Pages (or Workers AI) in your Cloudflare dashboard once to register your subdomain — and make sure your account email is verified — then retry.',
        },
        400
      );
    }

    // Redeploys carry the existing secret forward (inherit binding), so model
    // changes never touch the key. Only a first deploy mints one.
    const workerName = sanitizeWorkerName(workerNameRaw);
    const workerExists = await cf.scriptExists(session.accountId, workerName);

    const result = await deploy(cf, session.accountId, subdomain, {
      workerNameRaw,
      models,
      workerExists,
    });

    // A newly minted key is held only in the encrypted session cookie so the
    // dashboard can display it and the testers can use it. Never persisted.
    if (result.apiKey) {
      await updateSession(ctx, session, {
        workerKeys: { ...session.workerKeys, [result.workerName]: result.apiKey },
      });
    }

    return json({ ok: true, ...result });
  } catch (e) {
    return toErrorResponse(e);
  }
}
