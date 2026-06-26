import { MessageSquare, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { askQuestion, fileUrl } from "../api";
import { clearChatHistory, loadChatHistory, saveChatHistory } from "../chatStorage";
import type { ChatMessage, ChatSource } from "../types";
import { SpeechInputButton } from "./SpeechInputButton";

const EXPAND_REQUEST_RE =
  /^(?:да|покажи|показать|подробнее|разверни|открой|выведи)(?:\s+(?:полный|подробный))?(?:\s+ответ|\s+текст)?[.!?]*$/iu;

function isExpandRequest(text: string): boolean {
  return EXPAND_REQUEST_RE.test(text.trim());
}

function findPendingPreview(messages: ChatMessage[]): { question: string; history: ChatMessage[] } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.mode === "preview" && msg.pendingQuestion) {
      return { question: msg.pendingQuestion, history: messages.slice(0, i + 1) };
    }
  }
  return null;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatHistory(slug, scopePath));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"preview" | "full" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speechHint, setSpeechHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voiceBaseRef = useRef("");

  const applyVoiceTranscript = (text: string, isFinal: boolean): void => {
    const base = voiceBaseRef.current.trim();
    const next = base ? `${base} ${text}` : text;
    setInput(next);
    if (isFinal) voiceBaseRef.current = next;
  };

  useEffect(() => {
    saveChatHistory(slug, scopePath, messages);
  }, [slug, scopePath, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const requestAnswer = async (
    question: string,
    mode: "preview" | "full",
    history: ChatMessage[],
    userLabel?: string,
  ): Promise<void> => {
    if (userLabel) {
      setMessages((prev) => [...prev, { role: "user", content: userLabel }]);
    }
    setLoading(true);
    setLoadingMode(mode);
    try {
      const result = await askQuestion(slug, question, scopePath, history, mode);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          context_available: result.context_available,
          mode: result.mode,
          pendingQuestion: mode === "preview" ? question : undefined,
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
      setLoadingMode(null);
    }
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || loading || !llmConfigured) return;
    setInput("");
    voiceBaseRef.current = "";
    setError(null);

    const pending = isExpandRequest(text) ? findPendingPreview(messages) : null;
    if (pending) {
      await requestAnswer(pending.question, "full", pending.history, text);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    await requestAnswer(text, "preview", [...messages, userMsg]);
  };

  const expandAnswer = async (msg: ChatMessage, msgIndex: number): Promise<void> => {
    if (!msg.pendingQuestion || loading) return;
    setError(null);
    const history = messages.slice(0, msgIndex + 1);
    await requestAnswer(msg.pendingQuestion, "full", history, "Показать подробный ответ");
  };

  const handleClearHistory = (): void => {
    if (messages.length === 0) return;
    if (!window.confirm("Очистить историю чата для этой папки?")) return;
    setMessages([]);
    clearChatHistory(slug, scopePath);
    setError(null);
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
        <div className="tl-chat__header-actions">
          {messages.length > 0 ? (
            <button type="button" className="tl-icon-btn" onClick={handleClearHistory} title="Очистить историю">
              <Trash2 size={16} />
            </button>
          ) : null}
          <button type="button" className="tl-icon-btn" onClick={onClose} title="Закрыть чат">
            <X size={18} />
          </button>
        </div>
      </header>

      {!llmConfigured ? (
        <div className="tl-chat__notice">
          Добавьте <code>DEEPSEEK_API_KEY</code> в <code>.env</code> на сервере и перезапустите контейнер.
        </div>
      ) : null}

      <div className="tl-chat__messages">
        {messages.length === 0 ? (
          <p className="tl-chat__empty">
            Задайте вопрос по нормативке в текущей папке. Сначала ассистент подскажет, в каком разделе искать
            ответ, а полный текст с цитатами можно запросить кнопкой или словом «покажи».
          </p>
        ) : null}
        {messages.map((msg, idx) => (
          <div key={idx} className={`tl-chat__msg tl-chat__msg--${msg.role}`}>
            <p className="tl-chat__msg-text">{msg.content}</p>
            {msg.role === "assistant" && msg.mode === "preview" && msg.pendingQuestion ? (
              <button
                type="button"
                className="tl-chat__expand-btn"
                disabled={loading}
                onClick={() => void expandAnswer(msg, idx)}
              >
                Показать подробный ответ
              </button>
            ) : null}
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
        {loading ? (
          <p className="tl-chat__typing">
            {loadingMode === "full" ? "Формирую подробный ответ…" : "Ищу раздел в документах…"}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="tl-chat__error">{error}</p> : null}

      <div className="tl-chat__composer">
        {speechHint ? <p className="tl-chat__speech-hint">{speechHint}</p> : null}
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
            onChange={(e) => {
              voiceBaseRef.current = e.target.value;
              setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="tl-chat__actions">
            <SpeechInputButton
              className="tl-chat__action-btn"
              title="Нажмите и говорите — текст появится в поле"
              disabled={!llmConfigured || loading}
              onErrorChange={setSpeechHint}
              onListeningStart={() => {
                voiceBaseRef.current = input;
              }}
              onTranscript={applyVoiceTranscript}
            />
            <button
              type="submit"
              className="tl-btn tl-btn--primary tl-chat__action-btn"
              disabled={!llmConfigured || loading || !input.trim()}
              title="Отправить"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
