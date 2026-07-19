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
    <div className="card flex flex-col">
      <h3 className="font-serif text-xl font-medium">Chat</h3>
      <div
        ref={scrollRef}
        className="mt-4 h-72 overflow-y-auto rounded-[3px] border border-line bg-paper-deep p-3 dark:border-line-dark dark:bg-night-deep"
      >
        {messages.length === 0 ? (
          <p className="text-[14px] text-ink-faint">
            Say hello to your endpoint — responses stream in live.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <span
                  className={
                    'inline-block max-w-[85%] whitespace-pre-wrap rounded-[6px] px-3 py-2 text-[14px] ' +
                    (m.role === 'user'
                      ? 'bg-ink text-paper dark:bg-ink-invert dark:text-night'
                      : 'bg-paper-card text-ink dark:bg-night-card dark:text-ink-invert')
                  }
                >
                  {m.content || (streaming ? '…' : '')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-2 text-[13px] font-semibold text-red-700 dark:text-red-400">{error}</p>
      )}
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          className="field"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button className="btn btn-primary btn-md shrink-0" disabled={streaming || !input.trim()}>
          {streaming ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
