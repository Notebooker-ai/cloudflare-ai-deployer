/**
 * Thin server-side wrapper around the Cloudflare REST + GraphQL APIs.
 *
 * Every call runs with the user's scoped token (from the encrypted session),
 * so this module only ever runs inside SSR endpoints — the token never reaches
 * the browser. We call the REST API directly with fetch rather than the Node
 * `cloudflare` SDK, which isn't meant for the Workers runtime.
 */

const API_BASE = 'https://api.cloudflare.com/client/v4';
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

export class CloudflareApiError extends Error {
  status: number;
  errors: unknown;
  constructor(message: string, status: number, errors?: unknown) {
    super(message);
    this.name = 'CloudflareApiError';
    this.status = status;
    this.errors = errors;
  }
}

export class CloudflareClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private get authHeader() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /** JSON REST call returning the unwrapped `result`. */
  private async request<T = any>(
    path: string,
    init: RequestInit = {},
    { raw = false }: { raw?: boolean } = {}
  ): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...this.authHeader, ...(init.headers || {}) },
    });

    // KV value reads and similar return raw bodies, not the CF JSON envelope.
    if (raw) {
      if (!res.ok) throw new CloudflareApiError(`CF ${res.status} on ${path}`, res.status);
      return (await res.text()) as unknown as T;
    }

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }

    if (!res.ok || (body && body.success === false)) {
      const msg = body?.errors?.[0]?.message || `Cloudflare API error (${res.status})`;
      throw new CloudflareApiError(msg, res.status, body?.errors);
    }
    return body?.result as T;
  }

  // ---- Auth / account discovery -------------------------------------------

  /** User-scoped token verification (works before the account id is known). */
  async verifyToken(): Promise<{ id: string; status: string } | null> {
    try {
      return await this.request('/user/tokens/verify');
    } catch {
      return null;
    }
  }

  async listAccounts(): Promise<Array<{ id: string; name: string }>> {
    return (await this.request('/accounts?per_page=50')) || [];
  }

  /** The account's workers.dev subdomain (the real host part, not the account id). */
  async getWorkersSubdomain(accountId: string): Promise<string | null> {
    try {
      const r = await this.request<{ subdomain: string }>(
        `/accounts/${accountId}/workers/subdomain`
      );
      return r?.subdomain || null;
    } catch {
      return null;
    }
  }

  // ---- Workers AI catalog --------------------------------------------------

  async searchAiModels(
    accountId: string,
    params: { task?: string; per_page?: number; page?: number } = {}
  ): Promise<any[]> {
    const q = new URLSearchParams();
    if (params.task) q.set('task', params.task);
    q.set('per_page', String(params.per_page ?? 100));
    q.set('page', String(params.page ?? 1));
    q.set('hide_experimental', 'false');
    return (await this.request(`/accounts/${accountId}/ai/models/search?${q}`)) || [];
  }

  // ---- Worker script -------------------------------------------------------

  async getScript(accountId: string, name: string): Promise<string | null> {
    try {
      return await this.request<string>(
        `/accounts/${accountId}/workers/scripts/${name}/content/v2`,
        {},
        { raw: true }
      );
    } catch (e) {
      if (e instanceof CloudflareApiError && e.status === 404) return null;
      throw e;
    }
  }

  async scriptExists(accountId: string, name: string): Promise<boolean> {
    try {
      await this.request(`/accounts/${accountId}/workers/scripts/${name}/settings`);
      return true;
    } catch (e) {
      if (e instanceof CloudflareApiError && e.status === 404) return false;
      throw e;
    }
  }

  /** Upload/replace a module Worker with the given bindings (multipart PUT). */
  async putScript(
    accountId: string,
    name: string,
    script: string,
    opts: { compatibilityDate: string; bindings: any[] }
  ): Promise<void> {
    const metadata = {
      main_module: 'worker.js',
      compatibility_date: opts.compatibilityDate,
      bindings: opts.bindings,
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append(
      'worker.js',
      new Blob([script], { type: 'application/javascript+module' }),
      'worker.js'
    );
    // Let fetch set the multipart boundary — do not set Content-Type manually.
    await this.request(`/accounts/${accountId}/workers/scripts/${name}`, {
      method: 'PUT',
      body: form,
    });
  }

  async enableSubdomainRoute(accountId: string, name: string): Promise<void> {
    await this.request(`/accounts/${accountId}/workers/scripts/${name}/subdomain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
  }

  /** Rotate a single secret in place without touching other bindings. */
  async putSecret(accountId: string, name: string, secretName: string, text: string): Promise<void> {
    await this.request(`/accounts/${accountId}/workers/scripts/${name}/secrets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: secretName, text, type: 'secret_text' }),
    });
  }

  // ---- KV (config store, in the user's own account) ------------------------

  async listKvNamespaces(accountId: string): Promise<Array<{ id: string; title: string }>> {
    const out: Array<{ id: string; title: string }> = [];
    for (let page = 1; page <= 10; page++) {
      const batch =
        (await this.request<Array<{ id: string; title: string }>>(
          `/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=${page}`
        )) || [];
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  async createKvNamespace(accountId: string, title: string): Promise<{ id: string; title: string }> {
    return await this.request(`/accounts/${accountId}/storage/kv/namespaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  async kvGet(accountId: string, namespaceId: string, key: string): Promise<string | null> {
    try {
      return await this.request<string>(
        `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
        {},
        { raw: true }
      );
    } catch (e) {
      if (e instanceof CloudflareApiError && e.status === 404) return null;
      throw e;
    }
  }

  async kvPut(accountId: string, namespaceId: string, key: string, value: string): Promise<void> {
    await this.request(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: value }
    );
  }

  // ---- GraphQL analytics (usage) -------------------------------------------

  async graphql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { ...this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body: any = await res.json();
    if (!res.ok || body.errors) {
      const msg = body?.errors?.[0]?.message || `GraphQL error (${res.status})`;
      throw new CloudflareApiError(msg, res.status, body?.errors);
    }
    return body.data as T;
  }
}
