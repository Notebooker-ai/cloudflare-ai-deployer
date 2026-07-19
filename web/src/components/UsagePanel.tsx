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

const BAR_WIDTH = 30;

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
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);

  return (
    <div className="panel min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span is-="badge" className="badge-accent">
          neurons
        </span>
        <button size-="small" variant-="background2" onClick={load} disabled={loading}>
          {loading ? '[…]' : '[refresh]'}
        </button>
      </div>
      <p className="mt-3 text-sm text-fg2">estimated · today (UTC) · resets 00:00 UTC</p>

      {error && <p className="mt-3 font-bold text-danger">! {error}</p>}

      {usage && (
        <>
          <div className="mt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xl font-bold">
                {usage.estimatedNeuronsToday.toLocaleString()}
              </span>
              <span className="text-fg2">/ {usage.freeDailyNeurons.toLocaleString()} free</span>
            </div>
            <p
              className={
                'mt-1 overflow-hidden font-bold whitespace-nowrap ' +
                (over ? 'text-danger' : 'text-accent')
              }
            >
              [{bar}] {pct.toFixed(0)}%
            </p>
            {over && (
              <p className="mt-1 font-bold text-danger">
                ! approaching the free daily limit — usage beyond this bills on your account
              </p>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="requests" value={usage.totalRequests} />
            <Stat label="tok_in" value={usage.totalInputTokens} />
            <Stat label="tok_out" value={usage.totalOutputTokens} />
          </div>
          <p className="mt-3 text-sm text-fg2">
            Estimated from request/token analytics (Cloudflare exposes no direct neuron figure).
            Authoritative number:{' '}
            <a
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
    <div className="bg-bg1 p-2">
      <div className="font-bold">{value.toLocaleString()}</div>
      <div className="text-sm text-fg2">{label}</div>
    </div>
  );
}
