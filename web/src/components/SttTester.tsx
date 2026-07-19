import { useRef, useState } from 'react';

export default function SttTester({ workerName }: { workerName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    <div className="card flex flex-col">
      <h3 className="font-serif text-xl font-medium">Speech to text</h3>
      <p className="mt-1 text-[13px] text-ink-faint">
        Upload audio (or video with an audio track) and transcribe it.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="field mt-4 file:mr-3 file:rounded-[3px] file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-sans file:text-[13px] file:font-semibold file:text-paper dark:file:bg-ink-invert dark:file:text-night"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setText(null);
          setError(null);
        }}
      />
      {error && (
        <p className="mt-2 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
      {text !== null && (
        <div className="mt-3 rounded-[3px] border border-line bg-paper-deep p-3 text-[14px] dark:border-line-dark dark:bg-night-deep">
          {text || <span className="text-ink-faint">(no speech detected)</span>}
        </div>
      )}
      <div className="mt-3">
        <button
          className="btn btn-primary btn-md"
          onClick={transcribe}
          disabled={loading || !file}
        >
          {loading ? 'Transcribing…' : 'Transcribe'}
        </button>
      </div>
    </div>
  );
}
