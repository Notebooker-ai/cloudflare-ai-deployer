import { useEffect, useState } from 'react';

export interface ModelConfig {
  chat?: string;
  text_to_speech?: string;
  speech_to_text?: string;
  embedding?: string;
}

interface CatalogGroup {
  key: keyof ModelConfig;
  label: string;
  task: string;
  models: { id: string; description: string }[];
}

interface Props {
  value: ModelConfig;
  onChange: (next: ModelConfig) => void;
}

export default function ModelPicker({ value, onChange }: Props) {
  const [groups, setGroups] = useState<CatalogGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/models/catalog');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load models');
        if (!cancelled) setGroups(data.groups);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load models');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function set(key: keyof ModelConfig, id: string) {
    onChange({ ...value, [key]: id || undefined });
  }

  if (error) {
    return <p className="font-bold text-danger">! {error}</p>;
  }
  if (!groups) {
    return (
      <p className="text-fg2">
        loading model catalog<span is-="spinner" variant-="dots"></span>
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((g) => {
        const current = value[g.key] ?? '';
        // Keep a configured-but-unlisted model selectable (e.g. ids that the
        // catalog search omits) instead of silently dropping it to "none".
        const unlisted = current && !g.models.some((m) => m.id === current);
        return (
          <div key={g.key} className="min-w-0">
            <label className="mb-1 block text-fg2">{g.label.toLowerCase()}:</label>
            <select value={current} onChange={(e) => set(g.key, e.target.value)}>
              <option value="">— none —</option>
              {unlisted && <option value={current}>{current} (current)</option>}
              {g.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-fg2">{g.models.length} available · live from cloudflare</p>
          </div>
        );
      })}
    </div>
  );
}
