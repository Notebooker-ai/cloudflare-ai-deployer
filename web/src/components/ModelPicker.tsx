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
    return <p className="text-[14px] font-semibold text-red-700 dark:text-red-400">{error}</p>;
  }
  if (!groups) {
    return <p className="text-[14px] text-ink-faint">Loading model catalog…</p>;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g.key}>
          <label className="label mb-2">{g.label}</label>
          <select
            className="field"
            value={value[g.key] ?? ''}
            onChange={(e) => set(g.key, e.target.value)}
          >
            <option value="">— none —</option>
            {g.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[12px] text-ink-faint">{g.models.length} available</p>
        </div>
      ))}
    </div>
  );
}
