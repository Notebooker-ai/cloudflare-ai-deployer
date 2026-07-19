import { useState } from 'react';

export default function TokenGate() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not verify token');
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_0.9fr]">
      <form onSubmit={submit} className="panel min-w-0">
        <div>
          <span is-="badge" variant-="foreground0">
            auth
          </span>
        </div>
        <h2 className="mt-3 font-bold">Authenticate this visit</h2>
        <p className="mt-2 text-fg1">
          Paste a scoped Cloudflare API token. We hold it only in an encrypted, expiring cookie —
          never in a database.
        </p>
        <label className="mt-5 mb-1 block text-fg2">cloudflare_api_token:</label>
        <input
          type="password"
          className="w-full"
          placeholder="paste your scoped token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error && <p className="mt-3 font-bold text-danger">! {error}</p>}
        <button type="submit" className="mt-5 w-full" disabled={loading || !token.trim()}>
          {loading ? 'verifying…' : 'continue'}
        </button>
        <button
          type="button"
          size-="small"
          variant-="background2"
          className="mt-3"
          onClick={() => setShowGuide((s) => !s)}
        >
          {showGuide ? '[- hide]' : '[? how do I create a token]'}
        </button>
        <div className="note mt-5 text-sm text-fg2">
          <p>
            <span className="font-bold text-fg1">We never save your Cloudflare token</span> — it
            lives only in an encrypted cookie that expires with your session. For best security,
            delete the token in your Cloudflare dashboard when you're done here; creating a new one
            later lets you view this dashboard again.
          </p>
          <p className="mt-2">
            Your endpoint's API key is never saved either — it's shown only when created or
            renewed. To display it here again on a later visit, renew it from the dashboard (the
            old key stops working).
          </p>
        </div>
      </form>

      <div className="panel min-w-0">
        <div>
          <span is-="badge" variant-="background2">
            setup
          </span>
        </div>
        <h3 className="mt-3 font-bold">Before you start</h3>
        <ol className="mt-2 text-fg1">
          <li>
            <span className="font-bold text-fg0">Verify your email</span> with Cloudflare —
            unverified accounts can't deploy Workers.
          </li>
          <li>
            Visit{' '}
            <a
              href="https://dash.cloudflare.com/?to=/:account/ai/workers-ai"
              target="_blank"
              rel="noreferrer"
            >
              Workers AI in your dashboard
            </a>{' '}
            once, and register your workers.dev subdomain when prompted.
          </li>
          <li>Create the API token below and paste it here.</li>
        </ol>

        <h3 className="mt-5 font-bold">What the token needs</h3>
        <p className="mt-1 text-fg1">
          Create a <span className="font-bold">Custom Token</span> scoped to a single account:
        </p>
        <ul marker-="tree" className="mt-2">
          {[
            ['Workers Scripts', 'Edit'],
            ['Workers KV Storage', 'Edit'],
            ['Workers AI', 'Read'],
            ['Account Analytics', 'Read'],
          ].map(([perm, level]) => (
            <li key={perm}>
              {perm} <span className="text-accent">→ {level}</span>
            </li>
          ))}
        </ul>
        {showGuide && (
          <div className="mt-4 text-sm text-fg1">
            <ol>
              <li>
                Open{' '}
                <a
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  dash.cloudflare.com › API Tokens
                </a>
              </li>
              <li>Create Token → Custom Token</li>
              <li>Add the permissions listed above</li>
              <li>Scope Account Resources to your account, then create and paste</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
