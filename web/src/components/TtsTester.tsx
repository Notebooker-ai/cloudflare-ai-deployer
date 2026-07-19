import { useState } from 'react';

export default function TtsTester({ workerName }: { workerName: string }) {
  const [text, setText] = useState('Try out your own AI with Notebooker.');
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function speak() {
    setError(null);
    setLoading(true);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    try {
      const res = await fetch('/api/test/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName, input: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'TTS failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div box-="square" shear-="top" className="flex min-w-0 flex-col">
      <div className="-mt-[0.5lh]">
        <span is-="badge" variant-="background2">
          text-to-speech
        </span>
      </div>
      <textarea
        className="mt-3 h-24 w-full p-2"
        size-="small"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="text to synthesize…"
      />
      {error && <p className="mt-2 font-bold text-danger">! {error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button size-="small" onClick={speak} disabled={loading || !text.trim()}>
          {loading ? 'generating…' : 'generate audio'}
        </button>
        {audioUrl && <audio controls src={audioUrl} className="max-w-full" />}
      </div>
    </div>
  );
}
