/**
 * Builds the deployable Worker script by injecting the chosen models into the
 * SHARED template at ../../../workers/template-unified.js. Vite's `?raw` import
 * inlines the file at build time (there's no filesystem in the Workers runtime),
 * and we reproduce the CLI's exact injection (deploy.js:125) so the app and the
 * `npm run deploy` CLI stay byte-for-byte compatible.
 */
// Vite `?raw` import resolves to the file's contents as a string at build time.
import templateSource from '../../../workers/template-unified.js?raw';

export const COMPATIBILITY_DATE = '2024-01-01';

export interface ModelConfig {
  chat?: string;
  embedding?: string;
  text_to_speech?: string;
  speech_to_text?: string;
}

/** Model slots, in display order, with the CF task name used for catalog lookup. */
export const MODEL_SLOTS: Array<{
  key: keyof ModelConfig;
  label: string;
  task: string;
  optional?: boolean;
}> = [
  { key: 'chat', label: 'Chat / Text Generation', task: 'Text Generation' },
  { key: 'text_to_speech', label: 'Text to Speech', task: 'Text-to-Speech' },
  { key: 'speech_to_text', label: 'Speech to Text', task: 'Automatic Speech Recognition' },
  { key: 'embedding', label: 'Embeddings', task: 'Text Embeddings' },
];

// Target the exact code expression, not the bare token — the token also appears
// in the template's header comment, so a naive replace of the quoted token would
// hit the comment first and leave the real assignment untouched.
const INJECT_EXPR = 'globalThis.__MODELS_CONFIG__ || "__DEPLOY_INJECT_CONFIG__"';

export function buildWorkerScript(models: ModelConfig): string {
  // Drop empty slots so the worker only enables endpoints that have a model.
  const clean: ModelConfig = {};
  for (const [k, v] of Object.entries(models)) {
    if (v) (clean as any)[k] = v;
  }
  const source = templateSource as string;
  if (!source.includes(INJECT_EXPR)) {
    throw new Error('Worker template is missing the config injection point.');
  }
  return source.replace(
    INJECT_EXPR,
    `globalThis.__MODELS_CONFIG__ || ${JSON.stringify(clean)}`
  );
}

/**
 * Best-effort recovery of the injected model config from a deployed script's
 * source (used to detect drift when the KV mirror is missing). Returns null if
 * it can't be parsed.
 */
export function extractModelsFromScript(script: string): ModelConfig | null {
  const marker = 'globalThis.__MODELS_CONFIG__ || ';
  const idx = script.indexOf(marker);
  if (idx === -1) return null;
  const after = script.slice(idx + marker.length).trimStart();
  if (!after.startsWith('{')) return null;
  // Balance braces to isolate the injected object literal.
  let depth = 0;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === '{') depth++;
    else if (after[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(after.slice(0, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
