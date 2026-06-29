import { MessageSquare, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { askQuestion, fileUrl } from "../api";
import { clearChatHistory, loadChatHistory, saveChatHistory } from "../chatStorage";
import type { ChatMessage, ChatSource } from "../types";
import { SpeechInputButton } from "./SpeechInputButton";
import { CameraInputButton } from "./CameraInputButton";
import { AttachFileButton, isAskAttachmentFile, isImageAttachmentFile } from "./AttachFileButton";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOC_BYTES = 50 * 1024 * 1024;

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

function userMessageLabel(text: string, attachment?: File | null): string {
  if (text) return text;
  if (attachment) {
    if (isImageAttachmentFile(attachment)) return "📷 Вопрос с фото";
    return `📄 ${attachment.name}`;
  }
  return "";
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
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"preview" | "full" | null>(null);
  const [loadingWithAttachment, setLoadingWithAttachment] = useState(false);
  const [loadingAttachmentIsImage, setLoadingAttachmentIsImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerHint, setComposerHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voiceBaseRef = useRef("");

  const clearAttachment = useCallback((): void => {
    setAttachedFile(null);
    setAttachedPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const attachFile = useCallback(
    (file: File): void => {
      if (!isAskAttachmentFile(file)) {
        setComposerHint("Формат не поддерживается (PDF, DOC, DOCX, TXT, MD, JPEG, PNG).");
        return;
      }
      const isImage = isImageAttachmentFile(file);
      const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
      if (file.size > maxBytes) {
        setComposerHint(isImage ? "Фото слишком большое (макс. 8 МБ)." : "Файл слишком большой (макс. 50 МБ).");
        return;
      }
      clearAttachment();
      setAttachedFile(file);
      setAttachedPreview(isImage ? URL.createObjectURL(file) : null);
      setComposerHint(null);
    },
    [clearAttachment],
  );

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

  useEffect(() => {
    return () => {
      if (attachedPreview) URL.revokeObjectURL(attachedPreview);
    };
  }, [attachedPreview]);

  const requestAnswer = async (
    question: string,
    mode: "preview" | "full",
    history: ChatMessage[],
    options?: {
      userLabel?: string;
      attachment?: File | null;
      imagePreview?: string | null;
      skipUserBubble?: boolean;
    },
  ): Promise<void> => {
    const attachment = options?.attachment ?? null;
    const imagePreview = options?.imagePreview ?? null;
    const isImage = attachment ? isImageAttachmentFile(attachment) : false;

    if (!options?.skipUserBubble) {
      const label = options?.userLabel ?? userMessageLabel(question, attachment);
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: label,
          ...(imagePreview ? { imagePreview } : {}),
          ...(isImage ? { hasImage: true } : {}),
          ...(attachment && !isImage ? { attachmentName: attachment.name } : {}),
        },
      ]);
    }

    setLoading(true);
    setLoadingMode(mode);
    setLoadingWithAttachment(!!attachment);
    setLoadingAttachmentIsImage(!!attachment && isImage);
    try {
      const result = await askQuestion(slug, question, scopePath, history, mode, attachment);
      const resolvedQuestion = result.resolved_question ?? question;

      setMessages((prev) => {
        const next = [...prev];
        if (attachment) {
          let userIdx = -1;
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i]?.role === "user") {
              userIdx = i;
              break;
            }
          }
          if (userIdx >= 0) {
            const recognized = result.recognized_question?.trim();
            const content = recognized
              ? question.trim()
                ? `${question.trim()}\n\n${recognized}`
                : recognized
              : next[userIdx]!.content;
            next[userIdx] = {
              ...next[userIdx]!,
              content,
              ...(isImage ? { hasImage: true } : { attachmentName: attachment.name }),
            };
          }
        }
        next.push({
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          context_available: result.context_available,
          mode: result.mode,
          pendingQuestion: mode === "preview" ? resolvedQuestion : undefined,
        });
        return next;
      });

      if (result.recognized_question) {
        const prefix = isImage ? "Распознано с фото" : "Из файла";
        setComposerHint(
          `${prefix}: ${result.recognized_question.slice(0, 120)}${result.recognized_question.length > 120 ? "…" : ""}`,
        );
        window.setTimeout(() => setComposerHint(null), 5000);
      }
    } catch (e) {
      const code = e instanceof Error ? e.message : "ask_failed";
      setError(
        code === "deepseek_not_configured"
          ? "ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env на сервере."
          : code === "ocr_no_text" || code === "extract_no_text"
            ? "Не удалось прочитать текст. Для фото экрана отправьте скриншот (PNG) файлом; для Word — .docx."
            : code === "ask_failed"
              ? "Не удалось получить ответ. Проверьте ключ API и логи сервера."
              : "Ошибка запроса.",
      );
    } finally {
      setLoading(false);
      setLoadingMode(null);
      setLoadingWithAttachment(false);
      setLoadingAttachmentIsImage(false);
    }
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    const attachment = attachedFile;
    if ((!text && !attachment) || loading || !llmConfigured) return;

    setInput("");
    voiceBaseRef.current = "";
    const preview = attachedPreview;
    const isImage = attachment ? isImageAttachmentFile(attachment) : false;
    clearAttachment();
    setError(null);

    const pending = text && isExpandRequest(text) ? findPendingPreview(messages) : null;
    if (pending) {
      await requestAnswer(pending.question, "full", pending.history, { userLabel: text });
      return;
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: userMessageLabel(text, attachment),
      ...(preview ? { imagePreview: preview } : {}),
      ...(isImage ? { hasImage: true } : {}),
      ...(attachment && !isImage ? { attachmentName: attachment.name } : {}),
    };
    const history = [...messages, userMsg];
    setMessages((prev) => [...prev, userMsg]);
    await requestAnswer(text, "preview", history, {
      attachment,
      imagePreview: preview,
      skipUserBubble: true,
    });
  };

  const expandAnswer = async (msg: ChatMessage, msgIndex: number): Promise<void> => {
    if (!msg.pendingQuestion || loading) return;
    setError(null);
    const history = messages.slice(0, msgIndex + 1);
    await requestAnswer(msg.pendingQuestion, "full", history, { userLabel: "Показать подробный ответ" });
  };

  const handleClearHistory = (): void => {
    if (messages.length === 0) return;
    if (!window.confirm("Очистить историю чата для этой папки?")) return;
    setMessages([]);
    clearChatHistory(slug, scopePath);
    setError(null);
  };

  const handlePaste = (e: React.ClipboardEvent): void => {
    const item = Array.from(e.clipboardData.items).find((entry) => entry.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) attachFile(file);
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((entry) => isAskAttachmentFile(entry));
    if (file) attachFile(file);
  };

  const scopeLabel = scopePath ? scopePath.split("/").pop() : "всё направление";
  const canSend = (input.trim().length > 0 || attachedFile !== null) && llmConfigured && !loading;

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
            Задайте вопрос текстом, голосом или прикрепите файл (PDF, Word, фото) — ассистент прочитает
            вложение и подскажет, где искать ответ в документах.
          </p>
        ) : null}
        {messages.map((msg, idx) => (
          <div key={idx} className={`tl-chat__msg tl-chat__msg--${msg.role}`}>
            {msg.imagePreview ? (
              <img src={msg.imagePreview} alt="" className="tl-chat__msg-image" />
            ) : msg.hasImage ? (
              <p className="tl-chat__msg-image-placeholder">📷 Фото вопроса</p>
            ) : msg.attachmentName ? (
              <p className="tl-chat__msg-file">📄 {msg.attachmentName}</p>
            ) : null}
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
            {loadingWithAttachment
              ? loadingAttachmentIsImage
                ? "Распознаём фото и ищу в документах…"
                : "Читаю файл и ищу в документах…"
              : loadingMode === "full"
                ? "Формирую подробный ответ…"
                : "Ищу раздел в документах…"}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="tl-chat__error">{error}</p> : null}

      <div className="tl-chat__composer">
        {composerHint ? <p className="tl-chat__speech-hint">{composerHint}</p> : null}
        <form
          className={`tl-chat__input-row${dragOver ? " tl-chat__input-row--drag" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="tl-chat__composer-field">
            {attachedFile ? (
              <div className="tl-chat__attachment">
                {attachedPreview ? (
                  <img src={attachedPreview} alt="Прикреплённое фото" className="tl-chat__attachment-thumb" />
                ) : (
                  <span className="tl-chat__attachment-doc">📄 {attachedFile.name}</span>
                )}
                <button
                  type="button"
                  className="tl-chat__attachment-remove"
                  title="Убрать вложение"
                  onClick={clearAttachment}
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
            <textarea
              rows={2}
              value={input}
              disabled={!llmConfigured || loading}
              placeholder="Ваш вопрос… можно прикрепить PDF, Word или фото"
              onPaste={handlePaste}
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
          </div>
          <div className="tl-chat__actions">
            <SpeechInputButton
              className="tl-chat__action-btn"
              title="Голосовой ввод"
              disabled={!llmConfigured || loading}
              onErrorChange={setComposerHint}
              onListeningStart={() => {
                voiceBaseRef.current = input;
              }}
              onTranscript={applyVoiceTranscript}
            />
            <CameraInputButton
              className="tl-chat__action-btn"
              variant="attach"
              title="Прикрепить фото"
              disabled={!llmConfigured || loading}
              onHintChange={setComposerHint}
              onImageSelected={attachFile}
            />
            <AttachFileButton
              className="tl-chat__action-btn"
              disabled={!llmConfigured || loading}
              onHintChange={setComposerHint}
              onFileSelected={attachFile}
            />
            <button
              type="submit"
              className="tl-btn tl-btn--primary tl-chat__action-btn tl-chat__action-btn--send"
              disabled={!canSend}
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
