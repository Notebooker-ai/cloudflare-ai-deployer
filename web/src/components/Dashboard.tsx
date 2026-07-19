import { useEffect, useState } from 'react';
import ModelPicker, { type ModelConfig } from './ModelPicker';
import ApiKeyPanel from './ApiKeyPanel';
import ChatTester from './ChatTester';
import TtsTester from './TtsTester';
import UsagePanel from './UsagePanel';

const DEFAULT_MODELS: ModelConfig = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  text_to_speech: '@cf/myshell-ai/melotts',
  speech_to_text: '@cf/openai/whisper-large-v3-turbo',
  embedding: '@cf/baai/bge-base-en-v1.5',
};

type StateKind = 'first-visit' | 'healthy' | 'key-unrecoverable' | 'worker-missing' | 'drift';

interface DeployerConfig {
  workerName: string;
  baseUrl: string;
  models: ModelConfig;
  apiKey: string;
  keyRotatedAt?: string;
}

interface DashboardState {
  kind: StateKind;
  workerName?: string;
  config?: DeployerConfig;
  liveModels?: ModelConfig | null;
  subdomain: string | null;
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
      <div className="card">
        <p className="font-semibold text-red-700 dark:text-red-400">{error}</p>
        <button className="btn btn-outline btn-sm mt-3" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }
  if (!state) {
    return <p className="text-ink-faint">Loading your account…</p>;
  }

  const isOnboarding = state.kind === 'first-visit' || state.kind === 'worker-missing';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-3xl font-medium">
            {isOnboarding ? 'Deploy your endpoint' : 'Your AI endpoint'}
          </h2>
          {state.subdomain && (
            <p className="text-[13px] text-ink-faint">
              Account subdomain: <span className="font-mono">{state.subdomain}.workers.dev</span>
            </p>
          )}
        </div>
        <button className="btn btn-outline btn-sm" onClick={logout}>
          Sign out
        </button>
      </div>

      {isOnboarding ? (
        <Onboarding state={state} onDeployed={refresh} />
      ) : (
        <Manage state={state} />
      )}
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
    <div className="card card-featured">
      {state.kind === 'worker-missing' && (
        <div className="mb-4 rounded-[3px] border border-accent/40 bg-accent-soft/30 p-3 text-[13px] dark:bg-accent-softinvert/20">
          We found saved config but the worker is gone. Redeploy to bring it back.
        </div>
      )}
      <label className="label mb-2">Worker name</label>
      <input
        className="field font-mono"
        value={workerName}
        onChange={(e) => setWorkerName(e.target.value)}
        placeholder="cloudflare-ai"
      />
      <p className="mt-1 text-[12px] text-ink-faint">
        Becomes <span className="font-mono">{workerName || 'cloudflare-ai'}.{state.subdomain ?? '<subdomain>'}.workers.dev</span>
      </p>

      <div className="mt-6">
        <label className="label mb-3">Choose your models</label>
        <ModelPicker value={models} onChange={setModels} />
      </div>

      {error && (
        <p className="mt-4 text-[14px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
      <button className="btn btn-primary btn-lg mt-6" onClick={deploy} disabled={deploying}>
        {deploying ? 'Deploying…' : 'Deploy to my Cloudflare'}
      </button>
    </div>
  );
}

function Manage({ state }: { state: DashboardState }) {
  const config = state.config!;
  const [models, setModels] = useState<ModelConfig>(config.models);
  const [savedModels, setSavedModels] = useState<ModelConfig>(config.models);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(config.apiKey ?? null);

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
        <div className="card border-accent dark:border-accent-invert">
          <p className="text-[14px]">
            The live worker's models differ from your saved config. Saving below will redeploy from
            what's selected.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ApiKeyPanel
          workerName={config.workerName}
          baseUrl={config.baseUrl}
          apiKey={apiKey}
          recoverable={state.kind !== 'key-unrecoverable'}
          onRotated={(k) => setApiKey(k)}
        />
        <UsagePanel />
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl font-medium">Models</h3>
          <button
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? 'Redeploying…' : dirty ? 'Save & redeploy' : 'Saved'}
          </button>
        </div>
        <div className="mt-4">
          <ModelPicker value={models} onChange={setModels} />
        </div>
        {error && (
          <p className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {savedModels.chat && <ChatTester workerName={config.workerName} />}
        {savedModels.text_to_speech && <TtsTester workerName={config.workerName} />}
      </div>
    </div>
  );
}
