import type { APIContext } from 'astro';
import { requireSession } from '../../../lib/auth';
import { resolveTestTarget } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/**
 * Proxy a chat completion to the user's deployed worker with streaming, piping
 * the OpenAI-style SSE straight back. The worker's bearer key stays server-side
 * (session cookie only — never stored).
 */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const body = await ctx.request.json();
    const workerName = (body.workerName ?? '') as string;

    const target = await resolveTestTarget(cf, session, workerName);
    if ('error' in target) return json({ error: target.error }, 400);

    const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chat',
        messages: body.messages ?? [],
        stream: true,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 512,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return json({ error: `Endpoint returned ${upstream.status}: ${text.slice(0, 300)}` }, 502);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
