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
    <div className="card flex flex-col">
      <h3 className="font-serif text-xl font-medium">Text to speech</h3>
      <textarea
        className="field mt-4 h-28 resize-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Text to synthesize…"
      />
      {error && (
        <p className="mt-2 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-primary btn-md" onClick={speak} disabled={loading || !text.trim()}>
          {loading ? 'Generating…' : 'Generate audio'}
        </button>
        {audioUrl && <audio controls src={audioUrl} className="max-w-full" />}
      </div>
    </div>
  );
}
