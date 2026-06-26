import { Mic, MicOff } from "lucide-react";
import { useSpeechInput } from "../useSpeechInput";

export function SpeechInputButton({
  onTranscript,
  onListeningStart,
  disabled,
  title = "Голосовой ввод",
}: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onListeningStart?: () => void;
  disabled?: boolean;
  title?: string;
}): React.ReactElement | null {
  const { supported, listening, error, toggle } = useSpeechInput({
    onResult: onTranscript,
    onListeningStart,
  });

  if (!supported) return null;

  return (
    <span className="tl-speech-input">
      <button
        type="button"
        className={`tl-icon-btn tl-speech-input__btn${listening ? " tl-speech-input__btn--active" : ""}`}
        title={listening ? "Остановить запись" : title}
        disabled={disabled}
        aria-pressed={listening}
        onClick={toggle}
      >
        {listening ? <MicOff size={15} /> : <Mic size={15} />}
      </button>
      {error ? <span className="tl-speech-input__error">{error}</span> : null}
    </span>
  );
}
