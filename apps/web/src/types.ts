export type DocumentType =
  | "law"
  | "standard"
  | "tkp"
  | "regulation"
  | "instruction"
  | "classifier"
  | "other";

export type Direction = {
  slug: string;
  title: string;
  created_at: string;
};

export type LibraryFile = {
  name: string;
  path: string;
  size: number;
  modified_at: string;
  kind: "file";
  content_type: string;
  has_text: boolean;
  text_index_status: "none" | "ready" | "partial";
  text_index_note: string | null;
};

export type LibraryFolder = {
  name: string;
  path: string;
  kind: "folder";
};

export type LibraryTree = {
  slug: string;
  title: string;
  path: string;
  folders: LibraryFolder[];
  files: LibraryFile[];
};

export type DocumentCatalogEntry = {
  path: string;
  doc_type: DocumentType;
  title: string;
};

export type DirectionsResponse = {
  directions: Direction[];
  default_direction?: string;
  default_scope_path?: string;
};

export type IndexJob = {
  job_id: string;
  slug: string;
  scope_path: string;
  status: "running" | "done" | "failed";
  phase: "scanning" | "indexing";
  total: number;
  processed: number;
  updated: number;
  failed: number;
  percent: number;
  current_file: string | null;
  elapsed_seconds: number;
  eta_seconds: number | null;
  message: string;
};

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  law: "Закон",
  standard: "ГОСТ / СП",
  tkp: "ТКП",
  regulation: "Приказ / правила",
  instruction: "Инструкция",
  classifier: "Классификатор",
  other: "Другое",
};

export const DOC_TYPE_OPTIONS: Array<{ value: DocumentType | ""; label: string }> = [
  { value: "", label: "Авто" },
  ...Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({
    value: value as DocumentType,
    label,
  })),
];
