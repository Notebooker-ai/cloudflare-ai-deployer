/** Small shared helpers. */

export const DEFAULT_WORKER_NAME = 'cloudflare-ai';

/** Default model preset, mirroring the repo root models.json. */
export const DEFAULT_MODELS = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embedding: '@cf/baai/bge-base-en-v1.5',
  text_to_speech: '@cf/myshell-ai/melotts',
  speech_to_text: '@cf/openai/whisper-large-v3-turbo',
};

/** 64-hex-char bearer key (matches the CLI's crypto.randomBytes(32).hex). */
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateApiKeyId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(3));
  const suffix = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `k_${new Date().toISOString()}_${suffix}`;
}

/** Worker names must be lowercase alphanumeric + hyphens. */
export function sanitizeWorkerName(name: string): string {
  return (name || DEFAULT_WORKER_NAME)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54) || DEFAULT_WORKER_NAME;
}

export function buildBaseUrl(workerName: string, subdomain: string): string {
  return `https://${workerName}.${subdomain}.workers.dev/v1`;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Turn a thrown value (incl. our 401 Responses) into a Response. */
export function toErrorResponse(e: unknown): Response {
  if (e instanceof Response) return e;
  const message = e instanceof Error ? e.message : 'Unexpected error';
  const status = (e as any)?.status && Number.isInteger((e as any).status) ? (e as any).status : 500;
  return json({ error: message }, status >= 400 && status < 600 ? status : 500);
}
