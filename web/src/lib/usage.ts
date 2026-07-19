/**
 * Workers AI usage monitor.
 *
 * Cloudflare exposes NO direct "neurons consumed" field (confirmed absent from
 * the public GraphQL schema), so we query request/token counts from the
 * `aiInferenceAdaptiveGroups` dataset and ESTIMATE neurons. The number is
 * clearly labelled as an estimate in the UI, with a dashboard link for the
 * authoritative figure.
 */
import type { CloudflareClient } from './cfApi';

/** Free tier: 10,000 neurons/day, resets 00:00 UTC. */
export const FREE_DAILY_NEURONS = 10_000;

/**
 * Rough neurons-per-1k-tokens estimate for text generation. Cloudflare's per
 * model rates vary; this is a blended approximation for budgeting, not billing.
 * (Derived from published $0.011/1k-neuron pricing and typical model rates.)
 */
const NEURONS_PER_1K_INPUT_TOKENS = 12;
const NEURONS_PER_1K_OUTPUT_TOKENS = 45;
/** Fallback per-request cost for non-text models where tokens are 0 (TTS/STT). */
const NEURONS_PER_REQUEST_FALLBACK = 120;

export interface UsagePoint {
  datetimeHour: string;
  modelId: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  estimatedNeurons: number;
}

export interface UsageSummary {
  since: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedNeuronsToday: number;
  freeDailyNeurons: number;
  percentOfFreeUsed: number;
  points: UsagePoint[];
  estimated: true;
}

function estimateNeurons(input: number, output: number, count: number): number {
  if (input === 0 && output === 0) return count * NEURONS_PER_REQUEST_FALLBACK;
  return (
    (input / 1000) * NEURONS_PER_1K_INPUT_TOKENS +
    (output / 1000) * NEURONS_PER_1K_OUTPUT_TOKENS
  );
}

const QUERY = `
query Usage($accountTag: String!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      aiInferenceAdaptiveGroups(
        filter: { datetimeHour_geq: $start, datetimeHour_lt: $end }
        limit: 1000
        orderBy: [datetimeHour_ASC]
      ) {
        count
        sum { totalInputTokens totalOutputTokens }
        dimensions { modelId datetimeHour }
      }
    }
  }
}`;

/** Start of the current UTC day, ISO string. */
function startOfUtcDayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function getUsage(cf: CloudflareClient, accountId: string): Promise<UsageSummary> {
  const start = startOfUtcDayIso();
  const end = new Date().toISOString();

  const data = await cf.graphql<any>(QUERY, { accountTag: accountId, start, end });
  const groups = data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];

  const points: UsagePoint[] = groups.map((g: any) => {
    const input = g.sum?.totalInputTokens ?? 0;
    const output = g.sum?.totalOutputTokens ?? 0;
    const count = g.count ?? 0;
    return {
      datetimeHour: g.dimensions?.datetimeHour ?? '',
      modelId: g.dimensions?.modelId ?? 'unknown',
      count,
      inputTokens: input,
      outputTokens: output,
      estimatedNeurons: estimateNeurons(input, output, count),
    };
  });

  const totalRequests = points.reduce((a, p) => a + p.count, 0);
  const totalInputTokens = points.reduce((a, p) => a + p.inputTokens, 0);
  const totalOutputTokens = points.reduce((a, p) => a + p.outputTokens, 0);
  const estimatedNeuronsToday = Math.round(points.reduce((a, p) => a + p.estimatedNeurons, 0));

  return {
    since: start,
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    estimatedNeuronsToday,
    freeDailyNeurons: FREE_DAILY_NEURONS,
    percentOfFreeUsed: Math.min(100, (estimatedNeuronsToday / FREE_DAILY_NEURONS) * 100),
    points,
    estimated: true,
  };
}
