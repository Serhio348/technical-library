import type {
  AskResponse,
  ChatMessage,
  Direction,
  DirectionsResponse,
  DocumentCatalogEntry,
  DocumentType,
  IndexJob,
  LibraryTree,
  SearchHit,
} from "./types";

type ApiOptions = {
  method?: string;
  json?: unknown;
  form?: FormData;
};

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method: options.method ?? (options.json !== undefined || options.form ? "POST" : "GET"),
    headers,
    body: options.form ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `http_${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<{ status: string; max_file_mb?: number; llm_configured?: boolean }> {
  return api("/health");
}

export async function askQuestion(
  slug: string,
  message: string,
  scopePath: string,
  history: ChatMessage[] = [],
  mode: "preview" | "full" = "preview",
  image?: File | null,
): Promise<AskResponse> {
  const path = `/api/library/directions/${encodeURIComponent(slug)}/ask`;
  const historyPayload = history.map((m) => ({ role: m.role, content: m.content }));

  if (image) {
    const form = new FormData();
    form.set("message", message);
    form.set("scope_path", scopePath);
    form.set("history", JSON.stringify(historyPayload));
    form.set("mode", mode);
    form.set("image", image);
    return api(path, { method: "POST", form });
  }

  return api(path, {
    method: "POST",
    json: {
      message,
      scope_path: scopePath,
      history: historyPayload,
      mode,
    },
  });
}

export async function fetchSearch(slug: string, query: string, scopePath = ""): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query });
  if (scopePath) params.set("scope_path", scopePath);
  const data = await api<{ items?: SearchHit[] }>(
    `/api/library/directions/${encodeURIComponent(slug)}/search?${params}`,
  );
  return data.items ?? [];
}

export async function ocrImageFile(file: File): Promise<string> {
  const form = new FormData();
  form.set("image", file);
  const data = await api<{ text: string }>("/api/library/ocr", { form });
  return data.text;
}

export async function fetchDirections(): Promise<DirectionsResponse> {
  return api("/api/library/directions");
}

export async function createDirection(title: string, slug?: string): Promise<Direction> {
  const data = await api<{ direction: Direction }>("/api/library/directions", {
    method: "POST",
    json: slug ? { title, slug } : { title },
  });
  return data.direction;
}

export async function fetchTree(slug: string, path = ""): Promise<LibraryTree> {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  return api(`/api/library/directions/${encodeURIComponent(slug)}/tree${q}`);
}

export async function fetchCatalog(slug: string, scopePath = ""): Promise<Record<string, DocumentCatalogEntry>> {
  const q = scopePath ? `?path=${encodeURIComponent(scopePath)}` : "";
  const data = await api<{ items?: DocumentCatalogEntry[] }>(
    `/api/library/directions/${encodeURIComponent(slug)}/catalog${q}`,
  );
  const map: Record<string, DocumentCatalogEntry> = {};
  for (const item of data.items ?? []) map[item.path] = item;
  return map;
}

export async function uploadFiles(
  slug: string,
  path: string,
  files: File[],
  docType?: DocumentType,
): Promise<{ job_id?: string }> {
  const form = new FormData();
  form.set("path", path);
  if (docType) form.set("doc_type", docType);
  for (const file of files) form.append("files", file);
  return api(`/api/library/directions/${encodeURIComponent(slug)}/upload`, { form });
}

export async function startReindexFolder(slug: string, path: string): Promise<IndexJob> {
  const data = await api<{ job_id: string; job?: IndexJob }>(
    `/api/library/directions/${encodeURIComponent(slug)}/reindex`,
    { method: "POST", json: { path } },
  );
  if (data.job) return data.job;
  return fetchIndexJobStatus(slug, data.job_id);
}

export async function startReindexFiles(
  slug: string,
  scopePath: string,
  files: string[],
): Promise<IndexJob> {
  const data = await api<{ job_id: string; job?: IndexJob }>(
    `/api/library/directions/${encodeURIComponent(slug)}/reindex`,
    { method: "POST", json: { path: scopePath, files, force: true } },
  );
  if (data.job) return data.job;
  return fetchIndexJobStatus(slug, data.job_id);
}

export async function fetchIndexJobStatus(slug: string, jobId: string): Promise<IndexJob> {
  const data = await api<{ job: IndexJob }>(
    `/api/library/directions/${encodeURIComponent(slug)}/reindex/status?job_id=${encodeURIComponent(jobId)}`,
  );
  return data.job;
}

export async function fetchActiveIndexJob(slug: string, path: string): Promise<IndexJob | null> {
  try {
    const data = await api<{ job: IndexJob }>(
      `/api/library/directions/${encodeURIComponent(slug)}/reindex/status?path=${encodeURIComponent(path)}`,
    );
    return data.job;
  } catch {
    return null;
  }
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "оценка…";
  if (seconds <= 0) return "скоро";
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} мин ${rest} сек` : `${minutes} мин`;
}

export async function createFolder(slug: string, path: string): Promise<void> {
  await api(`/api/library/directions/${encodeURIComponent(slug)}/folders`, {
    method: "POST",
    json: { path },
  });
}

export async function deleteFolder(slug: string, path: string): Promise<void> {
  await api(`/api/library/directions/${encodeURIComponent(slug)}/folders?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}

export async function deleteFile(slug: string, path: string): Promise<void> {
  await api(`/api/library/directions/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}

export async function updateDocType(slug: string, path: string, docType: DocumentType): Promise<void> {
  await api(`/api/library/directions/${encodeURIComponent(slug)}/catalog`, {
    method: "PUT",
    json: { path, doc_type: docType },
  });
}

export function fileUrl(slug: string, path: string): string {
  return `/api/library/directions/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString("ru-RU");
}

export function directionHue(slug: string): number {
  const palette = [32, 168, 210, 278, 12, 145, 95];
  let sum = 0;
  for (let i = 0; i < slug.length; i += 1) sum += slug.charCodeAt(i);
  return palette[sum % palette.length] ?? 32;
}

export function errorMessage(code: string): string {
  switch (code) {
    case "library_unavailable":
      return "Сервис библиотеки недоступен. Запустите backend на порту 3021.";
    case "unauthorized":
      return "Нет прав на это действие.";
    case "invalid_slug":
      return "Не удалось сформировать имя папки. Уточните название направления.";
    case "title_required":
      return "Укажите название направления.";
    case "invalid_file_type":
      return "Формат не поддерживается (PDF, DOC, JPEG, PNG, MD, TXT).";
    case "file_too_large":
      return "Файл слишком большой.";
    case "folder_not_empty":
      return "Папка не пустая — сначала удалите содержимое.";
    case "index_job_running":
      return "Индексация уже выполняется — дождитесь завершения.";
    case "job_not_found":
      return "Задача индексации не найдена.";
    case "deepseek_not_configured":
      return "ИИ не настроен: укажите DEEPSEEK_API_KEY в .env на сервере.";
    case "ask_failed":
      return "Не удалось получить ответ от ИИ.";
    case "ocr_no_text":
      return "На фото не найден текст.";
    case "ocr_failed":
      return "Не удалось распознать фото.";
    default:
      return "Произошла ошибка. Попробуйте ещё раз.";
  }
}
