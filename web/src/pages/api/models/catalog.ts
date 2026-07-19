import type { APIContext } from 'astro';
import { requireCfSession } from '../../../lib/auth';
import { MODEL_SLOTS } from '../../../lib/template';
import { json, toErrorResponse } from '../../../lib/util';

export const prerender = false;

/** Models that cannot work in the worker's request/response API. */
const EXCLUDED_MODELS = new Set([
  '@cf/deepgram/flux', // WebSocket-only ("only supports websocket connections")
]);

/** Live Workers AI catalog, grouped by our model slots. Powers the pickers. */
export async function GET(ctx: APIContext) {
  try {
    const { session, cf } = await requireCfSession(ctx);

    const groups = await Promise.all(
      MODEL_SLOTS.map(async (slot) => {
        let models: any[] = [];
        try {
          models = await cf.searchAiModels(session.accountId, { task: slot.task, per_page: 100 });
        } catch {
          models = [];
        }
        return {
          key: slot.key,
          label: slot.label,
          task: slot.task,
          models: models
            .map((m) => ({
              id: m.name ?? m.id,
              description: m.description ?? '',
            }))
            .filter((m) => m.id && !EXCLUDED_MODELS.has(m.id))
            .sort((a, b) => a.id.localeCompare(b.id)),
        };
      })
    );

    return json({ groups });
  } catch (e) {
    return toErrorResponse(e);
  }
}
