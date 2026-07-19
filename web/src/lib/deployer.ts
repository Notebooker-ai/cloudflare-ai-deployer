/**
 * Orchestration shared by the API endpoints: deploy/redeploy the worker, and
 * derive the dashboard state from the user's account on each visit (no DB).
 *
 * Key security model: the endpoint API key is NEVER persisted — not in KV, not
 * on our side. It exists as the worker's write-only secret (enforcement) and,
 * transiently, in the caller's encrypted session cookie (display/testing).
 * Redeploys carry the secret forward with an `inherit` binding; cycling
 * replaces it via the dedicated secrets endpoint.
 */
import type { CloudflareClient } from './cfApi';
import {
  buildWorkerScript,
  COMPATIBILITY_DATE,
  extractModelsFromScript,
  type ModelConfig,
} from './template';
import {
  ensureNamespace,
  listManagedNamespaces,
  readConfig,
  writeConfig,
  type DeployerConfig,
} from './kvStore';
import { buildBaseUrl, generateApiKey, sanitizeWorkerName } from './util';

export type StateKind =
  | 'first-visit'
  | 'healthy'
  | 'no-saved-config'
  | 'worker-missing'
  | 'drift';

export interface DashboardState {
  kind: StateKind;
  workerName?: string;
  config?: DeployerConfig;
  /** Models read back from the live worker script (for drift comparison). */
  liveModels?: ModelConfig | null;
  subdomain: string | null;
}

/**
 * Inspect the user's account and decide which UI state to show.
 * Picks the first deployer-managed namespace if one exists. Legacy blobs that
 * still contain a stored key are scrubbed here (we no longer persist keys).
 */
export async function discover(
  cf: CloudflareClient,
  accountId: string,
  subdomain: string | null,
  preferredWorker?: string
): Promise<DashboardState> {
  const managed = await listManagedNamespaces(cf, accountId);

  if (managed.length === 0) {
    return { kind: 'first-visit', subdomain };
  }

  const chosen =
    (preferredWorker && managed.find((m) => m.workerName === preferredWorker)) || managed[0];
  const workerName = chosen.workerName;

  let config = await readConfig(cf, accountId, chosen.id);

  // One-time scrub of legacy blobs that stored the key.
  if (config && (config.apiKey || config.pendingApiKey || config.apiKeyId)) {
    const { apiKey, pendingApiKey, apiKeyId, ...rest } = config;
    config = rest as DeployerConfig;
    try {
      await writeConfig(cf, accountId, chosen.id, config);
    } catch {
      /* scrub retried on next visit */
    }
  }

  const exists = await cf.scriptExists(accountId, workerName);

  if (!exists) {
    return { kind: 'worker-missing', workerName, config: config ?? undefined, subdomain };
  }

  // Read live models for drift detection.
  let liveModels: ModelConfig | null = null;
  const script = await cf.getScript(accountId, workerName);
  if (script) liveModels = extractModelsFromScript(script);

  if (!config) {
    return { kind: 'no-saved-config', workerName, liveModels, subdomain };
  }

  const drift =
    liveModels && JSON.stringify(sortModels(liveModels)) !== JSON.stringify(sortModels(config.models));

  return {
    kind: drift ? 'drift' : 'healthy',
    workerName,
    config,
    liveModels,
    subdomain,
  };
}

function sortModels(m: ModelConfig): Array<[string, string]> {
  return Object.entries(m)
    .filter(([, v]) => !!v)
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, string]>;
}

export interface DeployInput {
  workerNameRaw: string;
  models: ModelConfig;
  /** Whether the worker already exists (secret carried forward via inherit). */
  workerExists: boolean;
}

export interface DeployResult {
  config: DeployerConfig;
  workerName: string;
  baseUrl: string;
  /** Present only when a NEW key was generated (first deploy). Shown once. */
  apiKey?: string;
}

/** Deploy (or redeploy) the worker and persist non-secret config to KV. */
export async function deploy(
  cf: CloudflareClient,
  accountId: string,
  subdomain: string,
  input: DeployInput
): Promise<DeployResult> {
  const workerName = sanitizeWorkerName(input.workerNameRaw);

  // First deploy mints a key; redeploys inherit the existing secret unchanged.
  const newKey = input.workerExists ? undefined : generateApiKey();
  const secretBinding = input.workerExists
    ? { type: 'inherit', name: 'API_KEY' }
    : { type: 'secret_text', name: 'API_KEY', text: newKey };

  const script = buildWorkerScript(input.models);
  await cf.putScript(accountId, workerName, script, {
    compatibilityDate: COMPATIBILITY_DATE,
    bindings: [{ type: 'ai', name: 'AI' }, secretBinding],
  });

  // Best-effort: enable the workers.dev route.
  try {
    await cf.enableSubdomainRoute(accountId, workerName);
  } catch {
    /* subdomain may already be enabled or unavailable; non-fatal */
  }

  const baseUrl = buildBaseUrl(workerName, subdomain);
  const nowIso = new Date().toISOString();

  const namespaceId = await ensureNamespace(cf, accountId, workerName);
  const existing = await readConfig(cf, accountId, namespaceId);

  const config: DeployerConfig = {
    schemaVersion: 1,
    workerName,
    baseUrl,
    models: input.models,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    keyRotatedAt: existing?.keyRotatedAt,
    managedBy: 'cf-ai-deployer',
  };
  await writeConfig(cf, accountId, namespaceId, config);

  return { config, workerName, baseUrl, apiKey: newKey };
}

/**
 * Rotate the API key: flip the worker secret in place (no full redeploy) and
 * stamp keyRotatedAt in KV. The new key is returned to the caller and held
 * only in their session cookie — never persisted.
 */
export async function cycleKey(
  cf: CloudflareClient,
  accountId: string,
  workerName: string
): Promise<{ apiKey: string }> {
  const newKey = generateApiKey();
  await cf.putSecret(accountId, workerName, 'API_KEY', newKey);

  // Best-effort timestamp update; the blob never holds the key itself.
  try {
    const namespaceId = await ensureNamespace(cf, accountId, workerName);
    const existing = await readConfig(cf, accountId, namespaceId);
    if (existing) {
      const nowIso = new Date().toISOString();
      const { apiKey, pendingApiKey, apiKeyId, ...rest } = existing;
      await writeConfig(cf, accountId, namespaceId, {
        ...(rest as DeployerConfig),
        keyRotatedAt: nowIso,
        updatedAt: nowIso,
      });
    }
  } catch {
    /* non-fatal */
  }

  return { apiKey: newKey };
}

/** Resolve the endpoint bearer key for server-side test proxies. */
export function sessionWorkerKey(
  workerKeys: Record<string, string> | undefined,
  workerName: string
): string | null {
  return workerKeys?.[workerName] ?? null;
}

/**
 * Resolve the target base URL + bearer key for the in-browser testers.
 * The key comes from the session only; if this session didn't generate one
 * (deploy/cycle), testing requires renewing the key first.
 */
export async function resolveTestTarget(
  cf: CloudflareClient | null,
  session: {
    accountId?: string;
    subdomain?: string;
    workerKeys?: Record<string, string>;
    endpoint?: { baseUrl: string; apiKey: string };
  },
  workerName: string
): Promise<{ baseUrl: string; apiKey: string } | { error: string }> {
  // Credentials-only mode: the session carries the target directly.
  if (session.endpoint) return session.endpoint;

  const name = sanitizeWorkerName(workerName);
  const apiKey = sessionWorkerKey(session.workerKeys, name);
  if (!apiKey) {
    return {
      error:
        'No endpoint key in this session — keys are never stored. Renew the API key on the dashboard, then try again.',
    };
  }
  if (!cf || !session.accountId) return { error: 'Session has no Cloudflare access.' };
  const subdomain = session.subdomain ?? (await cf.getWorkersSubdomain(session.accountId));
  if (!subdomain) return { error: 'No workers.dev subdomain on this account.' };
  return { baseUrl: buildBaseUrl(name, subdomain), apiKey };
}
