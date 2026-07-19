/**
 * Orchestration shared by the API endpoints: deploy/redeploy the worker, and
 * derive the dashboard state from the user's account on each visit (no DB).
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
  findNamespaceId,
  listManagedNamespaces,
  readConfig,
  writeConfig,
  type DeployerConfig,
} from './kvStore';
import {
  buildBaseUrl,
  generateApiKey,
  generateApiKeyId,
  sanitizeWorkerName,
} from './util';

export type StateKind =
  | 'first-visit'
  | 'healthy'
  | 'key-unrecoverable'
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
 * Picks the first deployer-managed namespace if one exists.
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

  const config = await readConfig(cf, accountId, chosen.id);
  const exists = await cf.scriptExists(accountId, workerName);

  if (!exists) {
    return { kind: 'worker-missing', workerName, config: config ?? undefined, subdomain };
  }

  // Read live models for drift detection.
  let liveModels: ModelConfig | null = null;
  const script = await cf.getScript(accountId, workerName);
  if (script) liveModels = extractModelsFromScript(script);

  if (!config || !config.apiKey) {
    return { kind: 'key-unrecoverable', workerName, config: config ?? undefined, liveModels, subdomain };
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
  /** Reuse an existing key (redeploy) or generate a fresh one (first deploy). */
  apiKey?: string;
  apiKeyId?: string;
}

export interface DeployResult {
  config: DeployerConfig;
  workerName: string;
  baseUrl: string;
  apiKey: string;
}

/** Deploy (or redeploy) the worker and persist config into the user's KV. */
export async function deploy(
  cf: CloudflareClient,
  accountId: string,
  subdomain: string,
  input: DeployInput
): Promise<DeployResult> {
  const workerName = sanitizeWorkerName(input.workerNameRaw);
  const apiKey = input.apiKey ?? generateApiKey();
  const apiKeyId = input.apiKeyId ?? generateApiKeyId();

  const script = buildWorkerScript(input.models);
  await cf.putScript(accountId, workerName, script, {
    compatibilityDate: COMPATIBILITY_DATE,
    bindings: [
      { type: 'ai', name: 'AI' },
      { type: 'secret_text', name: 'API_KEY', text: apiKey },
    ],
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
    apiKey,
    apiKeyId,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    keyRotatedAt: existing?.keyRotatedAt,
    managedBy: 'cf-ai-deployer',
  };
  await writeConfig(cf, accountId, namespaceId, config);

  return { config, workerName, baseUrl, apiKey };
}

/**
 * Rotate the API key: write a pending copy first (crash-safe), flip the worker
 * secret in place (no full redeploy), then promote pending -> apiKey.
 */
export async function cycleKey(
  cf: CloudflareClient,
  accountId: string,
  workerName: string
): Promise<{ apiKey: string; config: DeployerConfig }> {
  const namespaceId = await findNamespaceId(cf, accountId, workerName);
  if (!namespaceId) throw new Error('No config namespace found for this worker.');
  const existing = await readConfig(cf, accountId, namespaceId);
  if (!existing) throw new Error('No stored config found for this worker.');

  const newKey = generateApiKey();
  const newKeyId = generateApiKeyId();
  const nowIso = new Date().toISOString();

  // 1) persist pending so the freshly generated key is never lost mid-flight.
  await writeConfig(cf, accountId, namespaceId, { ...existing, pendingApiKey: newKey, updatedAt: nowIso });

  // 2) flip the worker secret in place.
  await cf.putSecret(accountId, workerName, 'API_KEY', newKey);

  // 3) promote.
  const promoted: DeployerConfig = {
    ...existing,
    apiKey: newKey,
    apiKeyId: newKeyId,
    pendingApiKey: undefined,
    keyRotatedAt: nowIso,
    updatedAt: nowIso,
  };
  delete (promoted as any).pendingApiKey;
  await writeConfig(cf, accountId, namespaceId, promoted);

  return { apiKey: newKey, config: promoted };
}
