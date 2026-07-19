import type { APIContext } from 'astro';
import { requireSession } from '../../../lib/auth';
import { resolveTestTarget } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/** Proxy text-to-speech to the deployed worker and stream the audio back. */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const body = await ctx.request.json();
    const workerName = (body.workerName ?? '') as string;
    const input = (body.input ?? '').toString();
    if (!input.trim()) return json({ error: 'Nothing to speak.' }, 400);

    const target = await resolveTestTarget(cf, session, workerName);
    if ('error' in target) return json({ error: target.error }, 400);

    const upstream = await fetch(`${target.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text_to_speech', input, voice: body.voice }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return json({ error: `Endpoint returned ${upstream.status}: ${text.slice(0, 300)}` }, 502);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
