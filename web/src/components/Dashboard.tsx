import { useEffect, useState } from 'react';
import ModelPicker, { type ModelConfig } from './ModelPicker';
import ApiKeyPanel from './ApiKeyPanel';
import ChatTester from './ChatTester';
import TtsTester from './TtsTester';
import SttTester from './SttTester';
import VisionTester from './VisionTester';
import UsagePanel from './UsagePanel';
import EmbedTester from './EmbedTester';

const DEFAULT_MODELS: ModelConfig = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  text_to_speech: '@cf/myshell-ai/melotts',
  speech_to_text: '@cf/openai/whisper-large-v3-turbo',
  embedding: '@cf/baai/bge-base-en-v1.5',
};

type StateKind =
  | 'first-visit'
  | 'healthy'
  | 'no-saved-config'
  | 'worker-missing'
  | 'drift'
  | 'creds-only';

interface DeployerConfig {
  workerName: string;
  baseUrl: string;
  models: ModelConfig;
  keyRotatedAt?: string;
}

interface DashboardState {
  kind: StateKind;
  workerName?: string;
  config?: DeployerConfig;
  liveModels?: ModelConfig | null;
  subdomain: string | null;
  /* creds-only mode */
  baseUrl?: string;
  apiKey?: string;
  models?: ModelConfig;
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/worker');
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    window.location.href = '/';
  }

  if (error) {
    return (
      <div className="panel">
        <p className="font-bold text-danger">! {error}</p>
        <button size-="small" variant-="background2" className="mt-3" onClick={refresh}>
          [retry]
        </button>
      </div>
    );
  }
  if (!state) {
    return (
      <p className="text-fg2">
        loading your account<span is-="spinner" variant-="dots"></span>
      </p>
    );
  }

  const isOnboarding = state.kind === 'first-visit' || state.kind === 'worker-missing';
  const isCredsOnly = state.kind === 'creds-only';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            {isOnboarding ? 'Deploy your endpoint' : 'Your OpenAI Compatible AI endpoint'}
          </h2>
          {state.subdomain && (
            <p className="text-fg2">
              account subdomain: <span className="text-fg1">{state.subdomain}.workers.dev</span>
            </p>
          )}
          {isCredsOnly && <p className="text-fg2">testing with credentials only</p>}
        </div>
        <button size-="small" variant-="background2" onClick={logout}>
          [sign out]
        </button>
      </div>

      {isCredsOnly ? (
        <CredsOnly state={state} />
      ) : isOnboarding ? (
        <Onboarding state={state} onDeployed={refresh} />
      ) : (
        <Manage state={state} />
      )}
    </div>
  );
}

function CredsOnly({ state }: { state: DashboardState }) {
  const models = state.models ?? {};
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);
  const [token, setToken] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = state.apiKey ?? '';
  const baseUrl = state.baseUrl ?? '';
  const masked = key ? key.slice(0, 6) + '•'.repeat(20) + key.slice(-4) : '';

  async function copy(text: string, which: 'key' | 'url') {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  function downloadCreds() {
    const content = `# Open Notebooker — endpoint credentials\n\nOPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=${key}\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'endpoint-credentials.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnlocking(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not verify token');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setUnlocking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel min-w-0">
          <div>
            <span is-="badge" className="badge-accent">
              endpoint
            </span>
          </div>
          <label className="mt-4 mb-1 block text-accent2">base_url:</label>
          <div className="flex items-center gap-2">
            <code className="block min-w-0 flex-1 overflow-x-auto bg-bg1 px-2 py-1 whitespace-nowrap text-ok">
              {baseUrl}
            </code>
            <button size-="small" variant-="background2" className="shrink-0" onClick={() => copy(baseUrl, 'url')}>
              {copied === 'url' ? '[copied]' : '[copy]'}
            </button>
          </div>
          <label className="mt-4 mb-1 block text-accent2">bearer_api_key:</label>
          <div className="flex items-center gap-2">
            <code className="block min-w-0 flex-1 overflow-x-auto bg-bg1 px-2 py-1 whitespace-nowrap text-ok">
              {revealed ? key : masked}
            </code>
            <button size-="small" variant-="background2" className="shrink-0" onClick={() => setRevealed((r) => !r)}>
              {revealed ? '[hide]' : '[reveal]'}
            </button>
            <button size-="small" variant-="background2" className="shrink-0" onClick={() => copy(key, 'key')}>
              {copied === 'key' ? '[copied]' : '[copy]'}
            </button>
          </div>
          <div className="mt-3">
            <button size-="small" variant-="background2" onClick={downloadCreds}>
              [&#xf019; download credentials.txt]
            </button>
          </div>
        </div>

        <form onSubmit={unlock} className="panel min-w-0">
          <div>
            <span is-="badge" variant-="background2">
              unlock
            </span>
          </div>
          <p className="mt-3 text-fg1">
            Usage monitoring, model management, deploys, and key renewal need a scoped{' '}
            <a href="/" target="_blank" rel="noreferrer">
              Cloudflare API token
            </a>
            . Paste one to unlock — your endpoint credentials carry over.
          </p>
          <label className="mt-3 mb-1 block text-accent2">cloudflare_api_token:</label>
          <input
            type="password"
            className="w-full"
            placeholder="paste your scoped token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {error && <p className="mt-2 font-bold text-danger">! {error}</p>}
          <button className="mt-4 w-full" disabled={unlocking || !token.trim()}>
            {unlocking ? 'verifying…' : 'unlock full management'}
          </button>
        </form>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {models.chat && <ChatTester workerName="endpoint" />}
        {models.text_to_speech && <TtsTester workerName="endpoint" />}
        {models.speech_to_text && <SttTester workerName="endpoint" />}
        {models.chat && <VisionTester workerName="endpoint" chatModel={models.chat} />}
        {models.embedding && <EmbedTester workerName="endpoint" />}
      </div>
    </div>
  );
}

function Onboarding({ state, onDeployed }: { state: DashboardState; onDeployed: () => void }) {
  const [workerName, setWorkerName] = useState(state.workerName || 'cloudflare-ai');
  const [models, setModels] = useState<ModelConfig>(state.config?.models || DEFAULT_MODELS);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deploy() {
    setError(null);
    setDeploying(true);
    try {
      const res = await fetch('/api/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName, models }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deploy failed');
      onDeployed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="panel">
      <div>
        <span is-="badge" className="badge-accent">
          deploy
        </span>
      </div>
      {state.kind === 'worker-missing' && (
        <div className="note mt-3 text-fg1">
          We found saved config but the worker is gone. Redeploy to bring it back.
        </div>
      )}
      {!state.subdomain && (
        <div className="note note-danger mt-3">
          <p className="font-bold text-danger">! no workers.dev subdomain on this account</p>
          <p className="mt-1 text-fg1">
            Deploys will fail until it exists. Open{' '}
            <a
              href="https://dash.cloudflare.com/?to=/:account/workers-and-pages"
              target="_blank"
              rel="noreferrer"
            >
              Workers &amp; Pages in your Cloudflare dashboard
            </a>{' '}
            once and register your subdomain (it will prompt you the first time). Also make sure
            your Cloudflare account email is verified — unverified accounts can't deploy Workers.
            Then come back and hit deploy.
          </p>
        </div>
      )}
      <label className="mt-4 mb-1 block text-accent2">worker_name:</label>
      <input
        className="w-full"
        value={workerName}
        onChange={(e) => setWorkerName(e.target.value)}
        placeholder="cloudflare-ai"
      />
      <p className="mt-1 text-sm text-fg2">
        → {workerName || 'cloudflare-ai'}.{state.subdomain ?? '<subdomain>'}.workers.dev
      </p>

      <div className="mt-5">
        <label className="mb-2 block text-accent2">models:</label>
        <ModelPicker value={models} onChange={setModels} />
      </div>

      {error && <p className="mt-4 font-bold text-danger">! {error}</p>}
      <button className="mt-5 w-full" onClick={deploy} disabled={deploying}>
        {deploying ? 'deploying…' : 'deploy to my cloudflare'}
      </button>
    </div>
  );
}

function Manage({ state }: { state: DashboardState }) {
  // 'no-saved-config': KV blob is gone but the worker is live — derive a
  // working config from the live script + subdomain.
  const config: DeployerConfig = state.config ?? {
    workerName: state.workerName!,
    baseUrl: `https://${state.workerName}.${state.subdomain}.workers.dev/v1`,
    models: state.liveModels ?? {},
  };
  const [models, setModels] = useState<ModelConfig>(config.models);
  const [savedModels, setSavedModels] = useState<ModelConfig>(config.models);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(models) !== JSON.stringify(savedModels);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName: config.workerName, models }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Redeploy failed');
      setSavedModels(models);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Redeploy failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {state.kind === 'drift' && (
        <div className="note text-fg1">
          ! The live worker's models differ from your saved config. Saving below will redeploy
          from what's selected.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ApiKeyPanel workerName={config.workerName} baseUrl={config.baseUrl} models={savedModels} />
        <UsagePanel />
      </div>

      <div className="panel">
        <div className="flex items-center justify-between gap-2">
          <span is-="badge" variant-="background2">
            models
          </span>
          <button size-="small" variant-="background2" onClick={save} disabled={saving}>
            {saving ? '[redeploying…]' : dirty ? '[save & redeploy]' : '[redeploy]'}
          </button>
        </div>
        <div className="mt-4">
          <ModelPicker value={models} onChange={setModels} />
        </div>
        {error && <p className="mt-3 font-bold text-danger">! {error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {savedModels.chat && <ChatTester workerName={config.workerName} />}
        {savedModels.text_to_speech && <TtsTester workerName={config.workerName} />}
        {savedModels.speech_to_text && <SttTester workerName={config.workerName} />}
        {savedModels.chat && (
          <VisionTester workerName={config.workerName} chatModel={savedModels.chat} />
        )}
        {savedModels.embedding && <EmbedTester workerName={config.workerName} />}
      </div>
    </div>
  );
}
