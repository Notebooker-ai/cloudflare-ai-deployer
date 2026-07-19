import { useState } from 'react';

export default function SttTester({ workerName }: { workerName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transcribe() {
    if (!file) return;
    setError(null);
    setText(null);
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('workerName', workerName);
      const res = await fetch('/api/test/stt', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setText(data.text ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div box-="square" shear-="top" className="flex min-w-0 flex-col">
      <div className="-mt-[0.5lh]">
        <span is-="badge" variant-="background2">
          speech-to-text
        </span>
      </div>
      <p className="mt-3 text-sm text-fg2">
        Upload audio (or video with an audio track) and transcribe it.
      </p>
      <input
        type="file"
        accept="audio/*,video/*"
        className="mt-3"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setText(null);
          setError(null);
        }}
      />
      {error && <p className="mt-2 font-bold text-danger">! {error}</p>}
      {text !== null && (
        <div className="mt-3 bg-bg1 p-2 text-fg1">
          {text || <span className="text-fg2">(no speech detected)</span>}
        </div>
      )}
      <div className="mt-3">
        <button size-="small" onClick={transcribe} disabled={loading || !file}>
          {loading ? 'transcribing…' : 'transcribe'}
        </button>
      </div>
    </div>
  );
}
