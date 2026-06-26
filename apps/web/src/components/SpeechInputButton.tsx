import { Mic, MicOff } from "lucide-react";
import { useEffect } from "react";
import { useSpeechInput } from "../useSpeechInput";

export function SpeechInputButton({
  onTranscript,
  onListeningStart,
  onErrorChange,
  disabled,
  title = "Голосовой ввод",
  className = "",
}: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onListeningStart?: () => void;
  onErrorChange?: (message: string | null) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}): React.ReactElement | null {
  const { supported, listening, error, toggle } = useSpeechInput({
    onResult: onTranscript,
    onListeningStart,
  });

  useEffect(() => {
    onErrorChange?.(error);
  }, [error, onErrorChange]);

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`tl-icon-btn tl-speech-input__btn${listening ? " tl-speech-input__btn--active" : ""} ${className}`.trim()}
      title={listening ? "Остановить запись" : title}
      disabled={disabled}
      aria-pressed={listening}
      onClick={toggle}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
  );
}
