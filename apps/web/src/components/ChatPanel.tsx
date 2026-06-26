import { MessageSquare, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { askQuestion, fileUrl } from "../api";
import type { ChatMessage, ChatSource } from "../types";

export function ChatPanel({
  slug,
  scopePath,
  directionTitle,
  llmConfigured,
  onClose,
}: {
  slug: string;
  scopePath: string;
  directionTitle: string;
  llmConfigured: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || loading || !llmConfigured) return;
    setInput("");
    setError(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const history = messages.slice(-8);
      const result = await askQuestion(slug, text, scopePath, history);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          context_available: result.context_available,
        },
      ]);
    } catch (e) {
      const code = e instanceof Error ? e.message : "ask_failed";
      setError(
        code === "deepseek_not_configured"
          ? "ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env на сервере."
          : code === "ask_failed"
            ? "Не удалось получить ответ. Проверьте ключ API и логи сервера."
            : "Ошибка запроса.",
      );
    } finally {
      setLoading(false);
    }
  };

  const scopeLabel = scopePath ? scopePath.split("/").pop() : "всё направление";

  return (
    <aside className="tl-chat">
      <header className="tl-chat__header">
        <div>
          <h3 className="tl-chat__title">
            <MessageSquare size={18} />
            Спросить по документам
          </h3>
          <p className="tl-chat__scope">
            {directionTitle}
            {scopePath ? ` → ${scopeLabel}` : ""}
          </p>
        </div>
        <button type="button" className="tl-icon-btn" onClick={onClose} title="Закрыть чат">
          <X size={18} />
        </button>
      </header>

      {!llmConfigured ? (
        <div className="tl-chat__notice">
          Добавьте <code>DEEPSEEK_API_KEY</code> в <code>.env</code> на сервере и перезапустите контейнер.
        </div>
      ) : null}

      <div className="tl-chat__messages">
        {messages.length === 0 ? (
          <p className="tl-chat__empty">
            Задайте вопрос по нормативке в текущей папке. Например: «Какие требования к газопроводу?» или «Что
            говорит ГОСТ о …?»
          </p>
        ) : null}
        {messages.map((msg, idx) => (
          <div key={idx} className={`tl-chat__msg tl-chat__msg--${msg.role}`}>
            <p className="tl-chat__msg-text">{msg.content}</p>
            {msg.role === "assistant" && msg.sources && msg.sources.length > 0 ? (
              <ul className="tl-chat__sources">
                {msg.sources.map((src: ChatSource) => (
                  <li key={src.path}>
                    <a href={fileUrl(slug, src.path)} target="_blank" rel="noreferrer">
                      {src.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {msg.role === "assistant" && msg.context_available === false ? (
              <p className="tl-chat__warn">Документы не найдены — загрузите PDF и дождитесь индексации (ИИ).</p>
            ) : null}
          </div>
        ))}
        {loading ? <p className="tl-chat__typing">Ищу в документах и формирую ответ…</p> : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="tl-chat__error">{error}</p> : null}

      <form
        className="tl-chat__input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          rows={2}
          value={input}
          disabled={!llmConfigured || loading}
          placeholder="Ваш вопрос…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="tl-btn tl-btn--primary" disabled={!llmConfigured || loading || !input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
