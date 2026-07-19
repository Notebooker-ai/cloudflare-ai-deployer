import { useState } from 'react';

interface Props {
  workerName: string;
  baseUrl: string;
  apiKey: string | null;
  recoverable: boolean;
  onRotated: (newKey: string) => void;
}

export default function ApiKeyPanel({ workerName, baseUrl, apiKey, recoverable, onRotated }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);
  const [cycling, setCycling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(apiKey);

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
      if (!res.ok) throw new Error(data.error || 'Failed to cycle key');
      setKey(data.apiKey);
      setRevealed(true);
      onRotated(data.apiKey);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cycle key');
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
      {key ? (
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

          <div className="mt-5 border-t border-line pt-4 dark:border-line-dark">
            {!confirming ? (
              <button className="btn btn-outline btn-sm" onClick={() => setConfirming(true)}>
                Cycle key…
              </button>
            ) : (
              <div className="rounded-[3px] border border-accent/40 bg-accent-soft/30 p-3 dark:bg-accent-softinvert/20">
                <p className="text-[13px] text-ink-soft dark:text-ink-softinvert">
                  Rotating replaces the key immediately. Any client using the old key will get{' '}
                  <span className="font-semibold">401</span> once it propagates. Continue?
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={cycle} disabled={cycling}>
                    {cycling ? 'Cycling…' : 'Yes, rotate now'}
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
        </>
      ) : (
        <div className="rounded-[3px] border border-line bg-paper-deep p-3 text-[13px] text-ink-soft dark:border-line-dark dark:bg-night-deep dark:text-ink-softinvert">
          {recoverable
            ? 'No key stored.'
            : 'Your key can’t be recovered (Cloudflare secrets are write-only). Cycle to generate a new one.'}
          <div className="mt-3">
            <button className="btn btn-primary btn-sm" onClick={cycle} disabled={cycling}>
              {cycling ? 'Generating…' : 'Generate a new key'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
