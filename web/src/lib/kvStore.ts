/**
 * The app's "memory" lives entirely in the USER's own Cloudflare account —
 * a KV namespace we create there, titled `cf-ai-deployer:<workerName>`, holding
 * one `config` key. This is what makes return visits work with zero database on
 * our side, and it's the readable home for the API key (Cloudflare `secret_text`
 * bindings are write-only and can't be read back for display/copy).
 */
import type { CloudflareClient } from './cfApi';
import type { ModelConfig } from './template';

export const NAMESPACE_PREFIX = 'cf-ai-deployer:';
export const CONFIG_KEY = 'config';

export interface DeployerConfig {
  schemaVersion: 1;
  workerName: string;
  baseUrl: string;
  models: ModelConfig;
  /**
   * LEGACY (schema v1 originally stored the key here). The endpoint key is no
   * longer persisted anywhere — it lives only in the encrypted session cookie
   * and must be cycled to view again. Old blobs are scrubbed on discovery.
   */
  apiKey?: string;
  apiKeyId?: string;
  pendingApiKey?: string;
  createdAt: string;
  updatedAt: string;
  keyRotatedAt?: string;
  managedBy: 'cf-ai-deployer';
}

export function namespaceTitle(workerName: string): string {
  return `${NAMESPACE_PREFIX}${workerName}`;
}

export function workerNameFromTitle(title: string): string {
  return title.slice(NAMESPACE_PREFIX.length);
}

/** Find the config namespace id for a specific worker, if it exists. */
export async function findNamespaceId(
  cf: CloudflareClient,
  accountId: string,
  workerName: string
): Promise<string | null> {
  const wanted = namespaceTitle(workerName);
  const all = await cf.listKvNamespaces(accountId);
  return all.find((n) => n.title === wanted)?.id ?? null;
}

/** List every deployer-managed namespace (title -> worker name + id). */
export async function listManagedNamespaces(
  cf: CloudflareClient,
  accountId: string
): Promise<Array<{ id: string; workerName: string }>> {
  const all = await cf.listKvNamespaces(accountId);
  return all
    .filter((n) => n.title.startsWith(NAMESPACE_PREFIX))
    .map((n) => ({ id: n.id, workerName: workerNameFromTitle(n.title) }));
}

/** Get or create the namespace for a worker; returns its id. */
export async function ensureNamespace(
  cf: CloudflareClient,
  accountId: string,
  workerName: string
): Promise<string> {
  const existing = await findNamespaceId(cf, accountId, workerName);
  if (existing) return existing;
  const created = await cf.createKvNamespace(accountId, namespaceTitle(workerName));
  return created.id;
}

export async function readConfig(
  cf: CloudflareClient,
  accountId: string,
  namespaceId: string
): Promise<DeployerConfig | null> {
  const raw = await cf.kvGet(accountId, namespaceId, CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeployerConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(
  cf: CloudflareClient,
  accountId: string,
  namespaceId: string,
  config: DeployerConfig
): Promise<void> {
  await cf.kvPut(accountId, namespaceId, CONFIG_KEY, JSON.stringify(config));
}
