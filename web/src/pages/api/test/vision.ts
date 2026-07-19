import type { APIContext } from 'astro';
import { requireSession } from '../../../lib/auth';
import { discover } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/**
 * Proxy an image + question to the deployed worker's chat endpoint using
 * OpenAI-style multimodal content parts (image as a data URL). Requires the
 * configured chat model to be vision-capable.
 */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const form = await ctx.request.formData();
    const file = form.get('file');
    const prompt = (form.get('prompt') ?? 'Describe this image.').toString();
    const workerName = (form.get('workerName') ?? '').toString();

    if (!(file instanceof File) || file.size === 0) {
      return json({ error: 'Upload an image file.' }, 400);
    }
    if (!file.type.startsWith('image/')) {
      return json({ error: 'Only image files are supported (PDFs are not supported by Workers AI vision models).' }, 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      return json({ error: 'Image too large — keep it under 5 MB.' }, 400);
    }

    const subdomain = session.subdomain ?? (await cf.getWorkersSubdomain(session.accountId));
    const state = await discover(cf, session.accountId, subdomain, workerName);
    if (!state.config?.apiKey || !state.config?.baseUrl) {
      return json({ error: 'No deployed endpoint or key found.' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const dataUrl = `data:${file.type};base64,${btoa(binary)}`;

    const upstream = await fetch(`${state.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chat',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    const bodyText = await upstream.text();
    if (!upstream.ok) {
      return json({ error: `Endpoint returned ${upstream.status}: ${bodyText.slice(0, 300)}` }, 502);
    }
    let answer = '';
    try {
      const parsed = JSON.parse(bodyText);
      answer = parsed.choices?.[0]?.message?.content ?? '';
    } catch {
      /* leave empty */
    }
    return json({ answer });
  } catch (e) {
    return toErrorResponse(e);
  }
}
