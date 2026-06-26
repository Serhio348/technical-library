import {
  BookOpen,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IndexProgressPanel } from "./components/IndexProgressPanel";
import {
  createDirection,
  createFolder,
  deleteFile,
  deleteFolder,
  directionHue,
  errorMessage,
  fetchActiveIndexJob,
  fetchCatalog,
  fetchDirections,
  fetchHealth,
  fetchIndexJobStatus,
  fetchTree,
  fileUrl,
  formatBytes,
  formatDate,
  getLibrarySecret,
  setLibrarySecret,
  startReindexFiles,
  startReindexFolder,
  updateDocType,
  uploadFiles,
} from "./api";
import type { Direction, DocumentType, IndexJob, LibraryTree } from "./types";
import { DOC_TYPE_LABELS, DOC_TYPE_OPTIONS } from "./types";
import { ensureUniqueSlug } from "./slugify";

type View = "home" | "direction";

export function App(): React.ReactElement {
  const [view, setView] = useState<View>("home");
  const [directions, setDirections] = useState<Direction[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>("");
  const [tree, setTree] = useState<LibraryTree | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [catalog, setCatalog] = useState<Record<string, { doc_type: DocumentType }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [uploadDocType, setUploadDocType] = useState<DocumentType | "">("");
  const [showCreate, setShowCreate] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [secretDraft, setSecretDraft] = useState(getLibrarySecret());
  const [createTitle, setCreateTitle] = useState("");
  const [maxFileMb, setMaxFileMb] = useState(200);
  const [indexJob, setIndexJob] = useState<IndexJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeDirection = directions.find((d) => d.slug === activeSlug);

  const reloadDirections = useCallback(async () => {
    const data = await fetchDirections();
    setDirections(data.directions ?? []);
    if (data.default_direction && !activeSlug) {
      setActiveSlug(data.default_direction);
    }
  }, [activeSlug]);

  const reloadTree = useCallback(async (slug: string, path: string) => {
    const data = await fetchTree(slug, path);
    setTree(data);
    setCurrentPath(data.path ?? path);
  }, []);

  const reloadCatalog = useCallback(async (slug: string) => {
    const map = await fetchCatalog(slug);
    setCatalog(map);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const health = await fetchHealth();
        if (health.max_file_mb) setMaxFileMb(health.max_file_mb);
        await reloadDirections();
      } catch {
        setError(errorMessage("library_unavailable"));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadDirections]);

  useEffect(() => {
    if (view !== "direction" || !activeSlug) return;
    void reloadTree(activeSlug, currentPath).catch(() => setError("Не удалось загрузить папку."));
    void reloadCatalog(activeSlug).catch(() => undefined);
    void fetchActiveIndexJob(activeSlug, currentPath)
      .then((job) => {
        if (job) setIndexJob(job);
      })
      .catch(() => undefined);
  }, [view, activeSlug, currentPath, reloadTree, reloadCatalog]);

  useEffect(() => {
    if (!indexJob || indexJob.status !== "running" || !activeSlug) return;
    const jobId = indexJob.job_id;
    const timer = window.setInterval(() => {
      void fetchIndexJobStatus(activeSlug, jobId)
        .then((job) => {
          setIndexJob(job);
          if (job.status !== "running") {
            void reloadTree(activeSlug, currentPath).catch(() => undefined);
            void reloadCatalog(activeSlug).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [indexJob?.job_id, indexJob?.status, activeSlug, currentPath, reloadTree, reloadCatalog]);

  useEffect(() => {
    if (!indexJob || (indexJob.status !== "done" && indexJob.status !== "failed")) return;
    const timer = window.setTimeout(() => setIndexJob(null), 8000);
    return () => window.clearTimeout(timer);
  }, [indexJob?.job_id, indexJob?.status]);

  const trackIndexJob = useCallback(async (job: IndexJob) => {
    setIndexJob(job);
  }, []);

  const openDirection = (slug: string): void => {
    setActiveSlug(slug);
    setCurrentPath("");
    setView("direction");
    setError(null);
  };

  const goHome = (): void => {
    setView("home");
    setTree(null);
    setCurrentPath("");
    setError(null);
  };

  const handleCreateDirection = async (): Promise<void> => {
    const title = createTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const dir = await createDirection(title);
      await reloadDirections();
      setShowCreate(false);
      setCreateTitle("");
      openDirection(dir.slug);
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "error"));
    } finally {
      setBusy(false);
    }
  };

  const createSlugPreview =
    createTitle.trim().length > 0
      ? ensureUniqueSlug(
          createTitle,
          directions.map((d) => d.slug),
        )
      : "";

  const handleUpload = async (files: FileList | File[]): Promise<void> => {
    if (!activeSlug || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadFiles(activeSlug, currentPath, [...files], uploadDocType || undefined);
      if (result.job_id) {
        await trackIndexJob(await fetchIndexJobStatus(activeSlug, result.job_id));
      }
      await reloadTree(activeSlug, currentPath);
      await reloadCatalog(activeSlug);
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "error"));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleReindexFolder = async (): Promise<void> => {
    if (!activeSlug) return;
    setError(null);
    try {
      await trackIndexJob(await startReindexFolder(activeSlug, currentPath));
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "error"));
    }
  };

  const handleReindexFile = async (filePath: string): Promise<void> => {
    if (!activeSlug) return;
    setError(null);
    try {
      await trackIndexJob(await startReindexFiles(activeSlug, filePath, [filePath]));
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "error"));
    }
  };

  const handleCreateFolder = async (): Promise<void> => {
    const name = newFolder.trim();
    if (!activeSlug || !name) return;
    const path = currentPath ? `${currentPath}/${name}` : name;
    setBusy(true);
    setError(null);
    try {
      await createFolder(activeSlug, path);
      setNewFolder("");
      await reloadTree(activeSlug, currentPath);
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "error"));
    } finally {
      setBusy(false);
    }
  };

  const pathParts = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <div className="tl-app">
      <header className="tl-header">
        <div className="tl-header__brand">
          <div className="tl-header__logo">
            <BookOpen size={22} strokeWidth={1.75} />
          </div>
          <div>
            <p className="tl-header__kicker">Technical Library</p>
            <h1 className="tl-header__title">Нормативная библиотека</h1>
          </div>
        </div>
        <div className="tl-header__actions">
          <button type="button" className="tl-btn tl-btn--ghost" onClick={() => setShowSecret(true)}>
            <KeyRound size={16} />
            Доступ
          </button>
          {view === "direction" ? (
            <button type="button" className="tl-btn tl-btn--ghost" onClick={goHome}>
              <Layers size={16} />
              Все направления
            </button>
          ) : (
            <button type="button" className="tl-btn tl-btn--primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              Направление
            </button>
          )}
        </div>
      </header>

      <main className="tl-main">
        {loading ? (
          <div className="tl-state">Загрузка…</div>
        ) : view === "home" ? (
          <HomeView
            directions={directions}
            onOpen={openDirection}
            onCreate={() => setShowCreate(true)}
          />
        ) : activeDirection && tree ? (
          <DirectionView
            direction={activeDirection}
            tree={tree}
            currentPath={currentPath}
            pathParts={pathParts}
            catalog={catalog}
            newFolder={newFolder}
            uploadDocType={uploadDocType}
            busy={busy}
            maxFileMb={maxFileMb}
            fileInputRef={fileInputRef}
            onNavigate={setCurrentPath}
            onNewFolderChange={setNewFolder}
            onUploadDocTypeChange={setUploadDocType}
            onCreateFolder={() => void handleCreateFolder()}
            onUpload={(files) => void handleUpload(files)}
            onDeleteFolder={async (path, name) => {
              if (!window.confirm(`Удалить папку «${name}»?`)) return;
              setBusy(true);
              try {
                await deleteFolder(activeSlug, path);
                await reloadTree(activeSlug, currentPath);
              } catch (e) {
                setError(errorMessage(e instanceof Error ? e.message : "error"));
              } finally {
                setBusy(false);
              }
            }}
            onDeleteFile={async (path) => {
              if (!window.confirm(`Удалить файл?`)) return;
              setBusy(true);
              try {
                await deleteFile(activeSlug, path);
                await reloadTree(activeSlug, currentPath);
                await reloadCatalog(activeSlug);
              } catch (e) {
                setError(errorMessage(e instanceof Error ? e.message : "error"));
              } finally {
                setBusy(false);
              }
            }}
            onDocTypeChange={async (path, docType) => {
              try {
                await updateDocType(activeSlug, path, docType);
                await reloadCatalog(activeSlug);
              } catch (e) {
                setError(errorMessage(e instanceof Error ? e.message : "error"));
              }
            }}
            indexJob={indexJob}
            indexRunning={indexJob?.status === "running"}
            onReindexFolder={() => void handleReindexFolder()}
            onReindexFile={(path) => void handleReindexFile(path)}
          />
        ) : (
          <div className="tl-state">Направление не найдено.</div>
        )}

        {error ? (
          <div className="tl-toast" role="alert">
            {error}
            <button type="button" className="tl-toast__close" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        ) : null}
      </main>

      {showCreate ? (
        <Modal title="Новое направление" onClose={() => setShowCreate(false)}>
          <p className="tl-modal__hint">
            Направление — область документов: газоснабжение, электроснабжение, охрана труда, бухгалтерия и т.д.
            Внутри создаются подпапки (ТКП, законы, инструкции).
          </p>
          <label className="tl-field">
            <span>Название</span>
            <input
              value={createTitle}
              placeholder="Газоснабжение"
              autoFocus
              onChange={(e) => setCreateTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && createTitle.trim()) void handleCreateDirection();
              }}
            />
          </label>
          {createSlugPreview ? (
            <p className="tl-field__generated">
              Имя папки на сервере: <code>{createSlugPreview}</code>
              <span className="tl-field__generated-note">
                Формируется автоматически из названия — для хранения файлов и ссылок. Менять не нужно.
              </span>
            </p>
          ) : null}
          <div className="tl-modal__actions">
            <button type="button" className="tl-btn tl-btn--ghost" onClick={() => setShowCreate(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="tl-btn tl-btn--primary"
              disabled={busy || !createTitle.trim()}
              onClick={() => void handleCreateDirection()}
            >
              Создать
            </button>
          </div>
        </Modal>
      ) : null}

      {showSecret ? (
        <Modal title="Ключ доступа" onClose={() => setShowSecret(false)}>
          <p className="tl-modal__hint">
            Для загрузки и удаления нужен <code>LIBRARY_SHARED_SECRET</code> с сервера. Хранится только в этой
            вкладке браузера.
          </p>
          <label className="tl-field">
            <span>x-library-secret</span>
            <input
              type="password"
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              placeholder="секрет из .env"
            />
          </label>
          <div className="tl-modal__actions">
            <button type="button" className="tl-btn tl-btn--ghost" onClick={() => setShowSecret(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="tl-btn tl-btn--primary"
              onClick={() => {
                setLibrarySecret(secretDraft);
                setShowSecret(false);
              }}
            >
              Сохранить
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function HomeView({
  directions,
  onOpen,
  onCreate,
}: {
  directions: Direction[];
  onOpen: (slug: string) => void;
  onCreate: () => void;
}): React.ReactElement {
  if (directions.length === 0) {
    return (
      <section className="tl-hero">
        <div className="tl-hero__card">
          <h2>Начните с направления</h2>
          <p>
            Библиотека универсальная: каждый пользователь создаёт свои направления и подпапки для подвидов
            документов — ТКП, законы, инструкции, классификаторы.
          </p>
          <button type="button" className="tl-btn tl-btn--primary tl-btn--lg" onClick={onCreate}>
            <Plus size={18} />
            Создать первое направление
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="tl-grid-section">
      <div className="tl-grid-section__head">
        <h2>Направления</h2>
        <p>Выберите область или создайте новую</p>
      </div>
      <div className="tl-direction-grid">
        {directions.map((dir) => {
          const hue = directionHue(dir.slug);
          return (
            <button
              key={dir.slug}
              type="button"
              className="tl-direction-card"
              style={{ "--dir-hue": hue } as React.CSSProperties}
              onClick={() => onOpen(dir.slug)}
            >
              <span className="tl-direction-card__icon">
                <FolderOpen size={28} strokeWidth={1.5} />
              </span>
              <span className="tl-direction-card__title">{dir.title}</span>
            </button>
          );
        })}
        <button type="button" className="tl-direction-card tl-direction-card--add" onClick={onCreate}>
          <Plus size={32} strokeWidth={1.5} />
          <span>Новое направление</span>
        </button>
      </div>
    </section>
  );
}

function DirectionView({
  direction,
  tree,
  currentPath,
  pathParts,
  catalog,
  newFolder,
  uploadDocType,
  busy,
  maxFileMb,
  fileInputRef,
  onNavigate,
  onNewFolderChange,
  onUploadDocTypeChange,
  onCreateFolder,
  onUpload,
  onDeleteFolder,
  onDeleteFile,
  onDocTypeChange,
  indexJob,
  indexRunning,
  onReindexFolder,
  onReindexFile,
}: {
  direction: Direction;
  tree: LibraryTree;
  currentPath: string;
  pathParts: string[];
  catalog: Record<string, { doc_type: DocumentType }>;
  newFolder: string;
  uploadDocType: DocumentType | "";
  busy: boolean;
  maxFileMb: number;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (path: string) => void;
  onNewFolderChange: (v: string) => void;
  onUploadDocTypeChange: (v: DocumentType | "") => void;
  onCreateFolder: () => void;
  onUpload: (files: FileList | File[]) => void;
  onDeleteFolder: (path: string, name: string) => void;
  onDeleteFile: (path: string) => void;
  onDocTypeChange: (path: string, docType: DocumentType) => void;
  indexJob: IndexJob | null;
  indexRunning: boolean;
  onReindexFolder: () => void;
  onReindexFile: (path: string) => void;
}): React.ReactElement {
  const hue = directionHue(direction.slug);
  const isEmpty = tree.folders.length === 0 && tree.files.length === 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <div className="tl-workspace" style={{ "--dir-hue": hue } as React.CSSProperties}>
      <aside className="tl-sidebar">
        <div className="tl-sidebar__direction">
          <h2>{direction.title}</h2>
        </div>
        <nav className="tl-sidebar__nav">
          <button
            type="button"
            className={`tl-nav-item${currentPath === "" ? " tl-nav-item--active" : ""}`}
            onClick={() => onNavigate("")}
          >
            <FolderOpen size={16} />
            Корень направления
          </button>
          {tree.folders.map((folder) => (
            <button
              key={folder.path}
              type="button"
              className={`tl-nav-item${currentPath === folder.path ? " tl-nav-item--active" : ""}`}
              onClick={() => onNavigate(folder.path)}
            >
              <ChevronRight size={14} />
              {folder.name}
            </button>
          ))}
        </nav>
        <div className="tl-sidebar__newfolder">
          <input
            placeholder="Подвид / папка"
            value={newFolder}
            onChange={(e) => onNewFolderChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreateFolder();
            }}
          />
          <button type="button" className="tl-btn tl-btn--ghost" disabled={busy} onClick={onCreateFolder}>
            <FolderPlus size={14} />
          </button>
        </div>
      </aside>

      <section className="tl-content">
        <div className="tl-content__toolbar">
          <nav className="tl-breadcrumb">
            <button type="button" onClick={() => onNavigate("")}>
              {direction.title}
            </button>
            {pathParts.map((part, idx) => {
              const path = pathParts.slice(0, idx + 1).join("/");
              return (
                <span key={path} className="tl-breadcrumb__segment">
                  <ChevronRight size={14} />
                  <button type="button" onClick={() => onNavigate(path)}>
                    {part}
                  </button>
                </span>
              );
            })}
          </nav>

          <div className="tl-content__actions">
            <select
              className="tl-select"
              value={uploadDocType}
              disabled={busy}
              onChange={(e) => onUploadDocTypeChange(e.target.value as DocumentType | "")}
            >
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value || "auto"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.jpeg,.jpg,.png,.md,.txt"
              hidden
              onChange={(e) => {
                if (e.target.files) onUpload(e.target.files);
              }}
            />
            <button
              type="button"
              className="tl-btn tl-btn--primary"
              disabled={busy || indexRunning}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              {busy ? "Загрузка…" : indexRunning ? "Индексация…" : "Загрузить"}
            </button>
            <div className="tl-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="tl-icon-btn"
                title="Дополнительно"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen ? (
                <div className="tl-menu">
                  <button
                    type="button"
                    className="tl-menu__item"
                    disabled={indexRunning}
                    onClick={() => {
                      setMenuOpen(false);
                      onReindexFolder();
                    }}
                  >
                    <RefreshCw size={15} />
                    Переиндексировать папку
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <IndexProgressPanel job={indexJob} />

        {isEmpty ? (
          <div className="tl-empty">
            <p>Папка пуста</p>
            <p className="tl-empty__hint">
              Создайте подвид (например <strong>tkp</strong>, <strong>zakonodatelstvo</strong>) или загрузите PDF.
              Лимит файла — {maxFileMb} MB.
            </p>
          </div>
        ) : (
          <div className="tl-doc-list">
            {tree.folders.map((folder) => (
              <article key={folder.path} className="tl-doc-row tl-doc-row--folder">
                <button type="button" className="tl-doc-row__main" onClick={() => onNavigate(folder.path)}>
                  <FolderOpen size={20} />
                  <span>{folder.name}</span>
                </button>
                <button
                  type="button"
                  className="tl-icon-btn tl-icon-btn--danger"
                  title="Удалить папку"
                  onClick={() => void onDeleteFolder(folder.path, folder.name)}
                >
                  <Trash2 size={15} />
                </button>
              </article>
            ))}
            {tree.files.map((file) => {
              const docType = catalog[file.path]?.doc_type ?? "other";
              return (
                <article key={file.path} className="tl-doc-row">
                  <a className="tl-doc-row__main" href={fileUrl(direction.slug, file.path)} target="_blank" rel="noreferrer">
                    <span className="tl-doc-row__name">{file.name}</span>
                    <span className="tl-doc-row__meta">
                      {formatBytes(file.size)} · {formatDate(file.modified_at)}
                    </span>
                  </a>
                  <select
                    className="tl-select tl-select--compact"
                    value={docType}
                    onChange={(e) => void onDocTypeChange(file.path, e.target.value as DocumentType)}
                  >
                    {DOC_TYPE_OPTIONS.filter((o) => o.value).map((o) => (
                      <option key={o.value} value={o.value}>
                        {DOC_TYPE_LABELS[o.value as DocumentType]}
                      </option>
                    ))}
                  </select>
                  {file.text_index_status === "ready" ? (
                    <span className="tl-pill tl-pill--ok">ИИ</span>
                  ) : file.text_index_status === "partial" ? (
                    <span className="tl-pill tl-pill--warn" title={file.text_index_note ?? ""}>
                      ИИ~
                    </span>
                  ) : (
                    <span className="tl-pill tl-pill--muted" title="Текст ещё не извлечён">
                      —
                    </span>
                  )}
                  {file.text_index_status !== "ready" ? (
                    <button
                      type="button"
                      className="tl-icon-btn"
                      title="Переиндексировать файл (OCR)"
                      disabled={indexRunning}
                      onClick={() => onReindexFile(file.path)}
                    >
                      <RefreshCw size={15} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="tl-icon-btn tl-icon-btn--danger"
                    title="Удалить"
                    onClick={() => void onDeleteFile(file.path)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="tl-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="tl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="tl-modal__header">
          <h3>{title}</h3>
          <button type="button" className="tl-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="tl-modal__body">{children}</div>
      </div>
    </div>
  );
}
