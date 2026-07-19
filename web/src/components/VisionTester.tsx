import { useState } from 'react';

/** Substrings identifying chat models known to accept image input. */
const VISION_HINTS = ['vision', 'llama-4-scout'];

export function isVisionCapable(chatModel?: string): boolean {
  if (!chatModel) return false;
  const m = chatModel.toLowerCase();
  return VISION_HINTS.some((h) => m.includes(h));
}

export default function VisionTester({
  workerName,
  chatModel,
}: {
  workerName: string;
  chatModel?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('Describe this image.');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visionReady = isVisionCapable(chatModel);

  function pick(f: File | null) {
    setFile(f);
    setAnswer(null);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function ask() {
    if (!file) return;
    setError(null);
    setAnswer(null);
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('prompt', prompt);
      form.append('workerName', workerName);
      const res = await fetch('/api/test/vision', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setAnswer(data.answer ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vision request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card flex flex-col">
      <h3 className="font-serif text-xl font-medium">Vision</h3>
      <p className="mt-1 text-[13px] text-ink-faint">
        Ask questions about an image. Images only — Workers AI vision models don’t read PDFs.
      </p>
      {!visionReady && (
        <div className="mt-3 rounded-[3px] border border-accent/40 bg-accent-soft/30 p-3 text-[13px] dark:bg-accent-softinvert/20">
          Your current chat model{chatModel ? ` (${chatModel})` : ''} doesn’t appear to support
          images. Pick a vision-capable one — e.g.{' '}
          <span className="font-mono text-[12px]">@cf/meta/llama-3.2-11b-vision-instruct</span> or{' '}
          <span className="font-mono text-[12px]">@cf/meta/llama-4-scout-17b-16e-instruct</span> —
          then save &amp; redeploy.
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        className="field mt-4 file:mr-3 file:rounded-[3px] file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-sans file:text-[13px] file:font-semibold file:text-paper dark:file:bg-ink-invert dark:file:text-night"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {preview && (
        <img
          src={preview}
          alt="preview"
          className="mt-3 max-h-48 w-auto self-start rounded-[3px] border border-line dark:border-line-dark"
        />
      )}
      <input
        className="field mt-3"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What do you want to know about it?"
      />
      {error && (
        <p className="mt-2 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
      {answer !== null && (
        <div className="mt-3 whitespace-pre-wrap rounded-[3px] border border-line bg-paper-deep p-3 text-[14px] dark:border-line-dark dark:bg-night-deep">
          {answer || <span className="text-ink-faint">(empty answer)</span>}
        </div>
      )}
      <div className="mt-3">
        <button className="btn btn-primary btn-md" onClick={ask} disabled={loading || !file}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
