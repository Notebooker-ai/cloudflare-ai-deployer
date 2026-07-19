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
    <div className="grid gap-8 md:grid-cols-[1fr_0.9fr]">
      <form onSubmit={submit} className="card card-featured">
        <h2 className="font-serif text-2xl font-medium">Authenticate this visit</h2>
        <p className="mt-2 text-[15px] text-ink-soft dark:text-ink-softinvert">
          Paste a scoped Cloudflare API token. We hold it only in an encrypted, expiring cookie —
          never in a database.
        </p>
        <label className="label mt-6 mb-2">Cloudflare API token</label>
        <input
          type="password"
          className="field font-mono"
          placeholder="paste your scoped token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error && (
          <p className="mt-3 text-[14px] font-semibold text-red-700 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-lg mt-6 w-full"
          disabled={loading || !token.trim()}
        >
          {loading ? 'Verifying…' : 'Continue'}
        </button>
        <button
          type="button"
          className="mt-3 text-[13px] font-semibold text-accent hover:underline dark:text-accent-invert"
          onClick={() => setShowGuide((s) => !s)}
        >
          {showGuide ? 'Hide' : 'How do I create a token?'}
        </button>
      </form>

      <div className="card">
        <h3 className="font-serif text-xl font-medium">What the token needs</h3>
        <p className="mt-2 text-[14px] text-ink-soft dark:text-ink-softinvert">
          Create a <span className="font-semibold">Custom Token</span> scoped to a single account
          with these permissions:
        </p>
        <ul className="mt-4 space-y-2 text-[14px]">
          {[
            ['Workers Scripts', 'Edit'],
            ['Workers KV Storage', 'Edit'],
            ['Workers AI', 'Read'],
            ['Account Analytics', 'Read'],
          ].map(([perm, level]) => (
            <li key={perm} className="flex items-center justify-between border-b border-line pb-2 dark:border-line-dark">
              <span>{perm}</span>
              <span className="font-mono text-[12px] font-semibold text-accent dark:text-accent-invert">
                {level}
              </span>
            </li>
          ))}
        </ul>
        {showGuide && (
          <div className="mt-4 text-[13px] text-ink-soft dark:text-ink-softinvert">
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Open{' '}
                <a
                  className="text-accent hover:underline dark:text-accent-invert"
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
