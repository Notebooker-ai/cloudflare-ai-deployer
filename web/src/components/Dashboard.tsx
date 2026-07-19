import { useEffect, useState } from 'react';
import ModelPicker, { type ModelConfig } from './ModelPicker';
import ApiKeyPanel from './ApiKeyPanel';
import ChatTester from './ChatTester';
import TtsTester from './TtsTester';
import SttTester from './SttTester';
import VisionTester from './VisionTester';
import UsagePanel from './UsagePanel';

const DEFAULT_MODELS: ModelConfig = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  text_to_speech: '@cf/myshell-ai/melotts',
  speech_to_text: '@cf/openai/whisper-large-v3-turbo',
  embedding: '@cf/baai/bge-base-en-v1.5',
};

type StateKind = 'first-visit' | 'healthy' | 'no-saved-config' | 'worker-missing' | 'drift';

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            {isOnboarding ? 'Deploy your endpoint' : 'Your AI endpoint'}
          </h2>
          {state.subdomain && (
            <p className="text-fg2">
              account subdomain: <span className="text-fg1">{state.subdomain}.workers.dev</span>
            </p>
          )}
        </div>
        <button size-="small" variant-="background2" onClick={logout}>
          [sign out]
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
    <div className="panel">
      <div>
        <span is-="badge" variant-="foreground0">
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
      <label className="mt-4 mb-1 block text-fg2">worker_name:</label>
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
        <label className="mb-2 block text-fg2">models:</label>
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
        <ApiKeyPanel workerName={config.workerName} baseUrl={config.baseUrl} />
        <UsagePanel />
      </div>

      <div className="panel">
        <div className="flex items-center justify-between gap-2">
          <span is-="badge" variant-="background2">
            models
          </span>
          <button size-="small" variant-="background2" onClick={save} disabled={!dirty || saving}>
            {saving ? '[redeploying…]' : dirty ? '[save & redeploy]' : '[saved]'}
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
      </div>
    </div>
  );
}
