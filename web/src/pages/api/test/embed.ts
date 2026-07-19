import type { APIContext } from 'astro';
import { requireSession } from '../../../lib/auth';
import { resolveTestTarget } from '../../../lib/deployer';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Embeddings tester: embed a query plus candidate texts through the deployed
 * worker and rank the candidates by cosine similarity — the intuitive way to
 * see an embedding model working.
 */
export async function POST(ctx: APIContext) {
  try {
    const { session, cf } = await requireSession(ctx);
    const body = await ctx.request.json();
    const workerName = (body.workerName ?? '') as string;
    const query = (body.query ?? '').toString().trim();
    const texts: string[] = (Array.isArray(body.texts) ? body.texts : [])
      .map((t: unknown) => String(t).trim())
      .filter(Boolean)
      .slice(0, 20);

    if (!query) return json({ error: 'query is required' }, 400);
    if (texts.length < 2) return json({ error: 'Provide at least two candidate texts.' }, 400);

    const target = await resolveTestTarget(cf, session, workerName);
    if ('error' in target) return json({ error: target.error }, 400);

    const upstream = await fetch(`${target.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'embedding', input: [query, ...texts] }),
    });
    const bodyText = await upstream.text();
    if (!upstream.ok) {
      return json({ error: `Endpoint returned ${upstream.status}: ${bodyText.slice(0, 300)}` }, 502);
    }

    const parsed = JSON.parse(bodyText);
    const vectors: number[][] = (parsed.data ?? []).map((d: any) => d.embedding);
    if (vectors.length !== texts.length + 1) {
      return json({ error: 'Unexpected embeddings response shape.' }, 502);
    }

    const [queryVec, ...textVecs] = vectors;
    const results = texts
      .map((text, i) => ({ text, score: cosine(queryVec, textVecs[i]) }))
      .sort((a, b) => b.score - a.score);

    return json({ dims: queryVec.length, results });
  } catch (e) {
    return toErrorResponse(e);
  }
}
