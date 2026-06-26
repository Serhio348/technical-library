import { env } from "../config.js";

type WhisperResponse = {
  text?: string;
  error?: { message?: string };
};

export async function transcribeVoice(audioBuffer: Buffer): Promise<string> {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("speech_not_configured");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", env.OPENAI_WHISPER_MODEL);
  form.append("language", "ru");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });

  const data = (await res.json()) as WhisperResponse;
  if (!res.ok) {
    const err = data.error?.message ?? res.statusText;
    throw new Error(`whisper_http_${res.status}: ${err}`);
  }

  const text = data.text?.trim();
  if (!text) throw new Error("whisper_empty");
  return text;
}
