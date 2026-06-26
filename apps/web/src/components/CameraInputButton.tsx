import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { ocrImageFile } from "../api";

export function CameraInputButton({
  onText,
  onHintChange,
  onBeforeCapture,
  disabled,
  className = "",
  title = "Сфотографировать вопрос",
}: {
  onText: (text: string) => void;
  onHintChange?: (message: string | null) => void;
  onBeforeCapture?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const hintTimerRef = useRef<number | null>(null);

  const setHint = (message: string | null, autoClearMs?: number): void => {
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    onHintChange?.(message);
    if (message && autoClearMs) {
      hintTimerRef.current = window.setTimeout(() => {
        hintTimerRef.current = null;
        onHintChange?.(null);
      }, autoClearMs);
    }
  };

  const handlePick = (): void => {
    if (disabled || loading) return;
    onBeforeCapture?.();
    inputRef.current?.click();
  };

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || loading) return;
    setLoading(true);
    setHint("Распознаём текст на фото…");
    try {
      const text = await ocrImageFile(file);
      onText(text);
      setHint(null);
    } catch (e) {
      const code = e instanceof Error ? e.message : "ocr_failed";
      const message =
        code === "ocr_no_text"
          ? "На фото не найден текст. Снимите ближе при хорошем свете."
          : code === "file_too_large"
            ? "Фото слишком большое (макс. 8 МБ)."
            : "Не удалось распознать фото.";
      setHint(message, 4500);
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="tl-visually-hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className={`tl-icon-btn${loading ? " tl-camera-input__btn--loading" : ""} ${className}`.trim()}
        disabled={disabled || loading}
        title={title}
        onClick={handlePick}
      >
        {loading ? <Loader2 size={16} className="tl-spin" /> : <Camera size={16} />}
      </button>
    </>
  );
}
