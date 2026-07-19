import { useEffect, useState } from 'react';

interface Props {
  workerName: string;
  baseUrl: string;
  /** Key minted earlier in this page's flow (e.g. first deploy), if any. */
  initialKey?: string | null;
}

export default function ApiKeyPanel({ workerName, baseUrl, initialKey }: Props) {
  const [key, setKey] = useState<string | null>(initialKey ?? null);
  const [loaded, setLoaded] = useState(!!initialKey);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);
  const [cycling, setCycling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recover a key generated earlier in this session (cookie-held only).
  useEffect(() => {
    if (initialKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/apikey?worker=${encodeURIComponent(workerName)}`);
        const data = await res.json();
        if (!cancelled && res.ok) setKey(data.apiKey ?? null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workerName, initialKey]);

  async function copy(text: string, which: 'key' | 'url') {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  async function cycle() {
    setError(null);
    setCycling(true);
    try {
      const res = await fetch('/api/apikey/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to renew key');
      setKey(data.apiKey);
      setRevealed(true);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to renew key');
    } finally {
      setCycling(false);
    }
  }

  const masked = key ? key.slice(0, 6) + '•'.repeat(20) + key.slice(-4) : '';

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-xl font-medium">Endpoint &amp; API key</h3>
        <span className="rounded-[3px] bg-paper-deep px-2 py-1 font-mono text-[12px] text-ink-soft dark:bg-night-deep dark:text-ink-softinvert">
          {workerName}
        </span>
      </div>

      <label className="label mt-5 mb-2">Base URL</label>
      <div className="flex items-center gap-2">
        <code className="field overflow-x-auto whitespace-nowrap font-mono text-[13px]">
          {baseUrl}
        </code>
        <button className="btn btn-outline btn-sm shrink-0" onClick={() => copy(baseUrl, 'url')}>
          {copied === 'url' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <label className="label mt-5 mb-2">Bearer API key</label>
      {!loaded ? (
        <p className="text-[13px] text-ink-faint">Checking this session…</p>
      ) : key ? (
        <>
          <div className="flex items-center gap-2">
            <code className="field overflow-x-auto whitespace-nowrap font-mono text-[13px]">
              {revealed ? key : masked}
            </code>
            <button
              className="btn btn-outline btn-sm shrink-0"
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button className="btn btn-outline btn-sm shrink-0" onClick={() => copy(key, 'key')}>
              {copied === 'key' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">
            Copy it now — we never store this key. It's visible only for this browser session;
            after that, renewing is the only way to see a key here again.
          </p>
        </>
      ) : (
        <div className="rounded-[3px] border border-line bg-paper-deep p-3 text-[13px] text-ink-soft dark:border-line-dark dark:bg-night-deep dark:text-ink-softinvert">
          Your endpoint key isn't viewable — keys are never stored, and this session didn't
          generate one. Your existing key keeps working for API clients that already have it; to
          see one here again, renew it below (this <span className="font-semibold">replaces</span>{' '}
          the old key).
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4 dark:border-line-dark">
        {!confirming ? (
          <button className="btn btn-outline btn-sm" onClick={() => setConfirming(true)}>
            {key ? 'Renew key…' : 'Renew key to view…'}
          </button>
        ) : (
          <div className="rounded-[3px] border border-accent/40 bg-accent-soft/30 p-3 dark:bg-accent-softinvert/20">
            <p className="text-[13px] text-ink-soft dark:text-ink-softinvert">
              Renewing replaces the key immediately. Any client using the old key will get{' '}
              <span className="font-semibold">401</span> once it propagates. Continue?
            </p>
            <div className="mt-3 flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={cycle} disabled={cycling}>
                {cycling ? 'Renewing…' : 'Yes, renew now'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setConfirming(false)}
                disabled={cycling}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
