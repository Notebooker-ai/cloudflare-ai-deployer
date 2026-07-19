import { useRef, useState } from 'react';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatTester({ workerName }: { workerName: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput('');

    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);
    scrollToBottom();

    try {
      const res = await fetch('/api/test/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName, messages: history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: 'assistant',
                  content: next[next.length - 1].content + delta,
                };
                return next;
              });
              scrollToBottom();
            }
          } catch {
            /* ignore keep-alive / partial */
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="panel flex min-w-0 flex-col">
      <div>
        <span is-="badge" variant-="background2">
          chat
        </span>
      </div>
      <div ref={scrollRef} className="mt-3 h-72 overflow-y-auto bg-bg1 p-2">
        {messages.length === 0 ? (
          <p className="text-fg2">Say hello to your endpoint — responses stream in live.</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {m.role === 'user' ? (
                  <>
                    <span className="font-bold text-accent">you&gt;</span>{' '}
                    <span className="font-bold">{m.content}</span>
                  </>
                ) : (
                  <>
                    <span className="text-accent2">ai&gt;</span>{' '}
                    <span className="text-fg1">
                      {m.content}
                      {!m.content && streaming && <span is-="spinner" variant-="dots"></span>}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-2 font-bold text-danger">! {error}</p>}
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1"
          placeholder="type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button size-="small" className="shrink-0 self-center" disabled={streaming || !input.trim()}>
          {streaming ? '…' : 'send'}
        </button>
      </form>
    </div>
  );
}
