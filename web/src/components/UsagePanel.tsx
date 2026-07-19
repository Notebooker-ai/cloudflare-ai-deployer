import { useEffect, useState } from 'react';

interface Usage {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedNeuronsToday: number;
  freeDailyNeurons: number;
  percentOfFreeUsed: number;
  estimated: boolean;
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/usage');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load usage');
      setUsage(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const pct = usage ? Math.min(100, usage.percentOfFreeUsed) : 0;
  const over = pct >= 90;

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-xl font-medium">Free neuron usage</h3>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      <p className="mt-1 text-[12px] text-ink-faint">Estimated · today (UTC) · resets 00:00 UTC</p>

      {error && (
        <p className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}

      {usage && (
        <>
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="font-serif text-3xl font-medium">
                {usage.estimatedNeuronsToday.toLocaleString()}
              </span>
              <span className="text-[13px] text-ink-faint">
                / {usage.freeDailyNeurons.toLocaleString()} neurons
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-paper-deep dark:bg-night-deep">
              <div
                className={
                  'h-full rounded-full transition-all ' +
                  (over ? 'bg-red-600' : 'bg-accent dark:bg-accent-invert')
                }
                style={{ width: `${pct}%` }}
              />
            </div>
            {over && (
              <p className="mt-2 text-[13px] font-semibold text-red-700 dark:text-red-400">
                Approaching the free daily limit — usage beyond this bills on your Cloudflare account.
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <Stat label="Requests" value={usage.totalRequests} />
            <Stat label="Input tokens" value={usage.totalInputTokens} />
            <Stat label="Output tokens" value={usage.totalOutputTokens} />
          </div>
          <p className="mt-4 text-[12px] text-ink-faint">
            Estimated from request/token analytics (Cloudflare exposes no direct neuron figure). See
            the authoritative number in your{' '}
            <a
              className="text-accent hover:underline dark:text-accent-invert"
              href="https://dash.cloudflare.com/?to=/:account/ai/workers-ai"
              target="_blank"
              rel="noreferrer"
            >
              Workers AI dashboard
            </a>
            .
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[3px] border border-line bg-paper-deep p-3 dark:border-line-dark dark:bg-night-deep">
      <div className="font-serif text-xl font-medium">{value.toLocaleString()}</div>
      <div className="text-[12px] text-ink-faint">{label}</div>
    </div>
  );
}
