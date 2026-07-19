import type { APIContext } from 'astro';
import { requireSession } from '../../../lib/auth';
import { resolveTestTarget } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/**
 * Proxy an uploaded audio/video file to the deployed worker's
 * /v1/audio/transcriptions endpoint. The worker key stays server-side.
 */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const form = await ctx.request.formData();
    const file = form.get('file');
    const workerName = (form.get('workerName') ?? '').toString();
    if (!(file instanceof File) || file.size === 0) {
      return json({ error: 'Upload an audio or video file.' }, 400);
    }
    // Workers AI request bodies are limited; keep uploads reasonable.
    if (file.size > 25 * 1024 * 1024) {
      return json({ error: 'File too large — keep it under 25 MB.' }, 400);
    }

    const target = await resolveTestTarget(cf, session, workerName);
    if ('error' in target) return json({ error: target.error }, 400);

    const upstreamForm = new FormData();
    upstreamForm.append('file', file, file.name || 'upload');

    const upstream = await fetch(`${target.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.apiKey}` },
      body: upstreamForm,
    });

    const body = await upstream.text();
    if (!upstream.ok) {
      return json({ error: `Endpoint returned ${upstream.status}: ${body.slice(0, 300)}` }, 502);
    }
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
