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
    <div box-="square" shear-="top" className="flex min-w-0 flex-col">
      <div className="-mt-[0.5lh]">
        <span is-="badge" variant-="background2">
          vision
        </span>
      </div>
      <p className="mt-3 text-sm text-fg2">
        Ask questions about an image. Images only — Workers AI vision models don't read PDFs.
      </p>
      {!visionReady && (
        <div box-="square" className="mt-3 text-sm text-fg1">
          ! Your current chat model{chatModel ? ` (${chatModel})` : ''} doesn't appear to support
          images. Pick a vision-capable one — e.g. @cf/meta/llama-3.2-11b-vision-instruct or
          @cf/meta/llama-4-scout-17b-16e-instruct — then save &amp; redeploy.
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        className="mt-3"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {preview && (
        <img
          src={preview}
          alt="preview"
          className="mt-3 max-h-48 w-auto self-start border-2 border-bg2"
        />
      )}
      <input
        className="mt-3 w-full"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="what do you want to know about it?"
      />
      {error && <p className="mt-2 font-bold text-danger">! {error}</p>}
      {answer !== null && (
        <div className="mt-3 bg-bg1 p-2 whitespace-pre-wrap text-fg1">
          {answer || <span className="text-fg2">(empty answer)</span>}
        </div>
      )}
      <div className="mt-3">
        <button size-="small" onClick={ask} disabled={loading || !file}>
          {loading ? 'asking…' : 'ask'}
        </button>
      </div>
    </div>
  );
}
