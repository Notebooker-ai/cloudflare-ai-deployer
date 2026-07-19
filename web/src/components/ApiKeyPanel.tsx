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
    <div className="panel min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span is-="badge" className="badge-accent">
          endpoint
        </span>
        <span is-="badge" variant-="background2">
          {workerName}
        </span>
      </div>

      <label className="mt-4 mb-1 block text-fg2">base_url:</label>
      <div className="flex items-center gap-2">
        <code className="block min-w-0 flex-1 overflow-x-auto bg-bg1 px-2 py-1 whitespace-nowrap">
          {baseUrl}
        </code>
        <button size-="small" variant-="background2" className="shrink-0" onClick={() => copy(baseUrl, 'url')}>
          {copied === 'url' ? '[copied]' : '[copy]'}
        </button>
      </div>

      <label className="mt-4 mb-1 block text-fg2">bearer_api_key:</label>
      {!loaded ? (
        <p className="text-fg2">
          checking this session<span is-="spinner" variant-="dots"></span>
        </p>
      ) : key ? (
        <>
          <div className="flex items-center gap-2">
            <code className="block min-w-0 flex-1 overflow-x-auto bg-bg1 px-2 py-1 whitespace-nowrap">
              {revealed ? key : masked}
            </code>
            <button
              size-="small"
              variant-="background2"
              className="shrink-0"
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? '[hide]' : '[reveal]'}
            </button>
            <button size-="small" variant-="background2" className="shrink-0" onClick={() => copy(key, 'key')}>
              {copied === 'key' ? '[copied]' : '[copy]'}
            </button>
          </div>
          <p className="mt-2 text-sm text-fg2">
            Copy it now — we never store this key. It's visible only for this browser session;
            after that, renewing is the only way to see a key here again.
          </p>
        </>
      ) : (
        <div className="note text-fg1">
          Your endpoint key isn't viewable — keys are never stored, and this session didn't
          generate one. Your existing key keeps working for API clients that already have it; to
          see one here again, renew it below (this <span className="font-bold">replaces</span> the
          old key).
        </div>
      )}

      <div className="mt-4">
        {!confirming ? (
          <button size-="small" variant-="background2" onClick={() => setConfirming(true)}>
            {key ? '[renew key…]' : '[renew key to view…]'}
          </button>
        ) : (
          <div className="note note-danger">
            <p className="text-fg1">
              Renewing replaces the key immediately. Any client using the old key will get{' '}
              <span className="font-bold text-danger">401</span> once it propagates. Continue?
            </p>
            <div className="mt-2 flex gap-2">
              <button size-="small" onClick={cycle} disabled={cycling}>
                {cycling ? 'renewing…' : 'yes, renew now'}
              </button>
              <button size-="small" variant-="background2" onClick={() => setConfirming(false)} disabled={cycling}>
                [cancel]
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-3 font-bold text-danger">! {error}</p>}
    </div>
  );
}
