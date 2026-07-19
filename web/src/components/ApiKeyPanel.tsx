import { useEffect, useState } from 'react';

interface Props {
  workerName: string;
  baseUrl: string;
  /** Deployed model ids, included in the downloadable creds file. */
  models?: Record<string, string | undefined>;
}

export default function ApiKeyPanel({ workerName, baseUrl, models }: Props) {
  const [key, setKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);
  const [cycling, setCycling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recover a key generated or pasted earlier in this session (cookie-held).
  useEffect(() => {
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
  }, [workerName]);

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
      setJustGenerated(true);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to renew key');
    } finally {
      setCycling(false);
    }
  }

  async function submitPaste(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPasteBusy(true);
    try {
      const res = await fetch('/api/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName, apiKey: pasteValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Key was rejected');
      setKey(data.apiKey);
      setPasting(false);
      setPasteValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Key was rejected');
    } finally {
      setPasteBusy(false);
    }
  }

  function downloadCreds() {
    if (!key) return;
    const modelLines = Object.entries(models ?? {})
      .filter(([, v]) => !!v)
      .map(([k, v]) => `#   ${k.padEnd(16)} ${v}`)
      .join('\n');
    const content = `# Open Notebooker — endpoint credentials
# Generated ${new Date().toISOString()}
# Keep this file safe: the key is not stored anywhere else.

OPENAI_BASE_URL=${baseUrl}
OPENAI_API_KEY=${key}

# Deployed models:
${modelLines || '#   (see GET /v1/models)'}

# Quick test:
#   curl ${baseUrl}/chat/completions \\
#     -H "Authorization: Bearer ${key}" \\
#     -H "Content-Type: application/json" \\
#     -d '{"model":"chat","messages":[{"role":"user","content":"hi"}]}'
`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workerName}-credentials.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
      {!loaded ? (
        <p className="text-fg2">
          checking this session<span is-="spinner" variant-="dots"></span>
        </p>
      ) : key ? (
        <>
          <div className="flex items-center gap-2">
            <code className="block min-w-0 flex-1 overflow-x-auto bg-bg1 px-2 py-1 whitespace-nowrap text-ok">
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
          {justGenerated ? (
            <div className="note note-danger mt-2 text-sm">
              <span className="font-bold">Save this key somewhere safe now</span> (password
              manager, .env file, or download it below). We never store it — after this browser
              session it can't be shown again, only replaced.
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg2">
              Held for this browser session only — we never store keys.
            </p>
          )}
          <div className="mt-3">
            <button size-="small" variant-="background2" onClick={downloadCreds}>
              [&#xf019; download credentials.txt]
            </button>
          </div>
        </>
      ) : (
        <div className="note text-fg1">
          Keys are never stored, and this session doesn't have one. Paste the key you saved when
          it was generated, or renew to get a new one (renewing{' '}
          <span className="font-bold">replaces</span> the old key — existing clients keep working
          until then).
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!key && !pasting && (
          <button size-="small" variant-="background2" onClick={() => setPasting(true)}>
            [paste saved key…]
          </button>
        )}
        {!confirming && (
          <button size-="small" variant-="background2" onClick={() => setConfirming(true)}>
            {key ? '[renew key…]' : '[renew key to view…]'}
          </button>
        )}
      </div>

      {pasting && (
        <form onSubmit={submitPaste} className="mt-3 flex gap-2">
          <input
            type="password"
            className="min-w-0 flex-1"
            placeholder="paste your saved endpoint key"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button size-="small" className="shrink-0 self-center" disabled={pasteBusy || !pasteValue.trim()}>
            {pasteBusy ? 'verifying…' : 'use key'}
          </button>
          <button
            type="button"
            size-="small"
            variant-="background2"
            className="shrink-0 self-center"
            onClick={() => {
              setPasting(false);
              setPasteValue('');
            }}
          >
            [cancel]
          </button>
        </form>
      )}

      {confirming && (
        <div className="note note-danger mt-3">
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

      {error && <p className="mt-3 font-bold text-danger">! {error}</p>}
    </div>
  );
}
