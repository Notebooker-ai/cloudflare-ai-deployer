import { useState } from 'react';

const DEFAULT_QUERY = 'a small sleepy kitten';
const DEFAULT_TEXTS = [
  'The cat curled up for a nap in the sun.',
  'Jet engines roar during takeoff.',
  'Puppies and kittens play together.',
  'Quarterly revenue exceeded projections.',
].join('\n');

const BAR_WIDTH = 20;

interface ResultRow {
  text: string;
  score: number;
}

export default function EmbedTester({ workerName }: { workerName: string }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [texts, setTexts] = useState(DEFAULT_TEXTS);
  const [loading, setLoading] = useState(false);
  const [dims, setDims] = useState<number | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    setError(null);
    setResults(null);
    setLoading(true);
    try {
      const res = await fetch('/api/test/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerName,
          query,
          texts: texts.split('\n').map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setDims(data.dims);
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Embedding test failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel flex min-w-0 flex-col">
      <div>
        <span is-="badge" variant-="background2">
          embeddings
        </span>
      </div>
      <p className="mt-3 text-sm text-fg2">
        Semantic similarity: candidates are ranked by how close their embedding is to the query's.
      </p>
      <label className="mt-3 mb-1 block text-accent2">query:</label>
      <input className="w-full" value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="mt-3 mb-1 block text-accent2">candidates (one per line):</label>
      <textarea
        className="h-28 w-full p-2"
        size-="small"
        value={texts}
        onChange={(e) => setTexts(e.target.value)}
      />
      {error && <p className="mt-2 font-bold text-danger">! {error}</p>}
      {results && (
        <div className="mt-3 space-y-1">
          {results.map((r, i) => {
            const filled = Math.round(Math.max(0, r.score) * BAR_WIDTH);
            return (
              <div key={i} className="flex items-baseline gap-2">
                <span className={'shrink-0 ' + (i === 0 ? 'text-ok' : 'text-fg2')}>
                  {r.score.toFixed(3)}
                </span>
                <span className={'shrink-0 ' + (i === 0 ? 'text-accent' : 'text-fg2')}>
                  [{'█'.repeat(filled)}{'░'.repeat(BAR_WIDTH - filled)}]
                </span>
                <span className="min-w-0 truncate text-fg1">{r.text}</span>
              </div>
            );
          })}
          {dims && <p className="mt-1 text-sm text-fg2">{dims} dimensions per vector</p>}
        </div>
      )}
      <div className="mt-3">
        <button size-="small" onClick={compare} disabled={loading || !query.trim()}>
          {loading ? 'embedding…' : 'compare'}
        </button>
      </div>
    </div>
  );
}
