import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechInputError =
  | "not-allowed"
  | "no-speech"
  | "network"
  | "aborted"
  | "unknown";

const ERROR_MESSAGES: Record<SpeechInputError, string> = {
  "not-allowed": "Разрешите доступ к микрофону в браузере.",
  "no-speech": "Речь не распознана. Попробуйте ещё раз.",
  network: "Сеть недоступна для распознавания речи.",
  aborted: "",
  unknown: "Не удалось распознать речь.",
};

export function useSpeechInput(options: {
  onResult: (text: string, isFinal: boolean) => void;
  onListeningStart?: () => void;
  lang?: string;
}): {
  supported: boolean;
  listening: boolean;
  error: string | null;
  toggle: () => void;
  stop: () => void;
} {
  const { onResult, onListeningStart, lang = "ru-RU" } = options;
  const onResultRef = useRef(onResult);
  const onListeningStartRef = useRef(onListeningStart);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const clearError = useCallback((): void => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setError(null);
  }, []);

  const showError = useCallback(
    (message: string): void => {
      if (!message) return;
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      setError(message);
      errorTimerRef.current = window.setTimeout(() => {
        errorTimerRef.current = null;
        setError(null);
      }, 4500);
    },
    [],
  );

  useEffect(() => {
    onResultRef.current = onResult;
    onListeningStartRef.current = onListeningStart;
  }, [onResult, onListeningStart]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const stop = useCallback((): void => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback((): void => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    if (listening) {
      stop();
      return;
    }

    clearError();
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }
      const trimmed = transcript.trim();
      if (!trimmed) return;
      const isFinal = event.results[event.results.length - 1]?.isFinal ?? false;
      if (isFinal) clearError();
      onResultRef.current(trimmed, isFinal);
    };

    recognition.onerror = (event) => {
      const code = event.error as SpeechInputError;
      if (code === "aborted") return;
      const message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
      if (message) showError(message);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      onListeningStartRef.current?.();
      recognition.start();
      setListening(true);
    } catch {
      showError(ERROR_MESSAGES.unknown);
      setListening(false);
    }
  }, [clearError, lang, listening, showError, stop]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { supported, listening, error, toggle, stop };
}
