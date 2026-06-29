import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IndexProgressPanel } from "./components/IndexProgressPanel";
import { ChatPanel } from "./components/ChatPanel";
import { DocumentSearch } from "./components/DocumentSearch";
import {
  assignDirectionHues,
  createDirection,
  createFolder,
  deleteFile,
  deleteFolder,
  directionHue,
  errorMessage,
  fetchActiveIndexJob,
  fetchDirections,
  fetchHealth,
  fetchIndexJobStatus,
  fetchTree,
  fileUrl,
  formatBytes,
  formatDate,
  startReindexFiles,
  startReindexFolder,
  uploadFiles,
} from "./api";
import type { Direction, DocumentType, IndexJob, LibraryTree } from "./types";
import { DOC_TYPE_OPTIONS } from "./types";
import { ensureUniqueSlug } from "./slugify";
import { buildAppHash, homeAppHash, parseAppHash } from "./appRoute";

type View = "home" | "direction";

export function App(): React.ReactElement {
  const [view, setView] = useState<View>("home");
  const [directions, setDirections] = useState<Direction[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>("");
  const [tree, setTree] = useState<LibraryTree | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [uploadDocType, setUploadDocType] = useState<DocumentType | "">("");
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [maxFileMb, setMaxFileMb] = useState(200);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [indexJob, setIndexJob] = useState<IndexJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipHashSyncRef = useRef(false);

  const activeDirection = directions.find((d) => d.slug === activeSlug);
  const directionHues = useMemo(
    () => assignDirectionHues(directions.map((d) => d.slug)),
    [directions],
  );

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

  const syncRouteToHash = useCallback((nextView: View, slug: string, path: string): void => {
    const target = nextView === "home" ? homeAppHash() : buildAppHash(slug, path);
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
  }, []);

  const applyRoute = useCallback((route: ReturnType<typeof parseAppHash>): void => {
    if (route.view === "home") {
      setView("home");
      setTree(null);
      setCurrentPath("");
      setChatOpen(false);
      setError(null);
      return;
    }
    setActiveSlug(route.slug);
    setCurrentPath(route.path);
    setView("direction");
    setChatOpen(false);
    setError(null);
  }, []);

  const goHome = useCallback((): void => {
    applyRoute({ view: "home" });
    syncRouteToHash("home", "", "");
  }, [applyRoute, syncRouteToHash]);

  const openDirection = useCallback(
    (slug: string, path = ""): void => {
      setActiveSlug(slug);
      setCurrentPath(path);
      setView("direction");
      setChatOpen(false);
      setError(null);
      syncRouteToHash("direction", slug, path);
    },
    [syncRouteToHash],
  );

  const navigateFolder = useCallback(
    (path: string): void => {
      setCurrentPath(path);
      if (activeSlug) syncRouteToHash("direction", activeSlug, path);
    },
    [activeSlug, syncRouteToHash],
  );

  useEffect(() => {
    void (async () => {
      try {
        const health = await fetchHealth();
        if (health.max_file_mb) setMaxFileMb(health.max_file_mb);
        setLlmConfigured(Boolean(health.llm_configured));
        await reloadDirections();
      } catch {
        setError(errorMessage("library_unavailable"));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadDirections]);

  useEffect(() => {
    if (loading) return;
    const route = parseAppHash();
    if (route.view === "direction") {
      const exists = directions.some((d) => d.slug === route.slug);
      skipHashSyncRef.current = true;
      if (exists) {
        applyRoute(route);
      } else {
        applyRoute({ view: "home" });
        window.history.replaceState(null, "", homeAppHash());
      }
    }
  }, [loading, directions, applyRoute]);

  useEffect(() => {
    const onPopState = (): void => {
      skipHashSyncRef.current = true;
      applyRoute(parseAppHash());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyRoute]);

  useEffect(() => {
    if (skipHashSyncRef.current) {
      skipHashSyncRef.current = false;
      return;
    }
    if (view === "home") {
      if (window.location.hash && window.location.hash !== homeAppHash()) {
        window.history.replaceState(null, "", homeAppHash());
      }
      return;
    }
    if (!activeSlug) return;
    const target = buildAppHash(activeSlug, currentPath);
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [view, activeSlug, currentPath]);

  useEffect(() => {
    if (view !== "direction" || !activeSlug) return;
    void reloadTree(activeSlug, currentPath).catch(() => setError("Не удалось загрузить папку."));
    void fetchActiveIndexJob(activeSlug, currentPath)
      .then((job) => {
        if (job) setIndexJob(job);
      })
      .catch(() => undefined);
  }, [view, activeSlug, currentPath, reloadTree]);

  useEffect(() => {
    if (!indexJob || (indexJob.status !== "running" && indexJob.status !== "queued") || !activeSlug) return;
    const jobId = indexJob.job_id;
    const timer = window.setInterval(() => {
      void fetchIndexJobStatus(activeSlug, jobId)
        .then((job) => {
          setIndexJob(job);
          if (job.status !== "running") {
            void reloadTree(activeSlug, currentPath).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [indexJob?.job_id, indexJob?.status, activeSlug, currentPath, reloadTree]);

  useEffect(() => {
    if (!indexJob || (indexJob.status !== "done" && indexJob.status !== "failed")) return;
    const timer = window.setTimeout(() => setIndexJob(null), 8000);
    return () => window.clearTimeout(timer);
  }, [indexJob?.job_id, indexJob?.status]);

  const trackIndexJob = useCallback(async (job: IndexJob) => {
    setIndexJob(job);
  }, []);

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
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "error"));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleReindexFolder = async (): Promise<void> => {
    if (!activeSlug) return;
    const ok = window.confirm(
      "Переиндексировать все файлы в этой папке и подпапках?\n\n" +
        "Это может занять много времени. Для одного документа нажмите ↻ у файла или загрузите файл — он проиндексируется отдельно.",
    );
    if (!ok) return;
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
        <button type="button" className="tl-header__brand" onClick={goHome} title="На главную — все направления">
          <div className="tl-header__logo">
            <BookOpen size={22} strokeWidth={1.75} />
          </div>
          <div>
            <p className="tl-header__kicker">Technical Library</p>
            <h1 className="tl-header__title">Нормативная библиотека</h1>
          </div>
        </button>
        <div className="tl-header__actions">
          {view === "direction" ? (
            <button type="button" className="tl-btn tl-btn--ghost" onClick={goHome}>
              <ArrowLeft size={16} />
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
            directionHues={directionHues}
            onOpen={openDirection}
            onCreate={() => setShowCreate(true)}
          />
        ) : activeDirection && tree ? (
          <DirectionView
            direction={activeDirection}
            directionHue={directionHues[activeDirection.slug] ?? directionHue(activeDirection.slug)}
            tree={tree}
            currentPath={currentPath}
            pathParts={pathParts}
            newFolder={newFolder}
            uploadDocType={uploadDocType}
            busy={busy}
            maxFileMb={maxFileMb}
            fileInputRef={fileInputRef}
            onNavigate={navigateFolder}
            onGoHome={goHome}
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
              } catch (e) {
                setError(errorMessage(e instanceof Error ? e.message : "error"));
              } finally {
                setBusy(false);
              }
            }}
            indexJob={indexJob}
            onReindexFolder={() => void handleReindexFolder()}
            onReindexFile={(path) => void handleReindexFile(path)}
            llmConfigured={llmConfigured}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((v) => !v)}
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

    </div>
  );
}

function HomeView({
  directions,
  directionHues,
  onOpen,
  onCreate,
}: {
  directions: Direction[];
  directionHues: Record<string, number>;
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
          const hue = directionHues[dir.slug] ?? directionHue(dir.slug);
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
  directionHue: dirHue,
  tree,
  currentPath,
  pathParts,
  newFolder,
  uploadDocType,
  busy,
  maxFileMb,
  fileInputRef,
  onNavigate,
  onGoHome,
  onNewFolderChange,
  onUploadDocTypeChange,
  onCreateFolder,
  onUpload,
  onDeleteFolder,
  onDeleteFile,
  indexJob,
  onReindexFolder,
  onReindexFile,
  llmConfigured,
  chatOpen,
  onToggleChat,
}: {
  direction: Direction;
  directionHue: number;
  tree: LibraryTree;
  currentPath: string;
  pathParts: string[];
  newFolder: string;
  uploadDocType: DocumentType | "";
  busy: boolean;
  maxFileMb: number;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (path: string) => void;
  onGoHome: () => void;
  onNewFolderChange: (v: string) => void;
  onUploadDocTypeChange: (v: DocumentType | "") => void;
  onCreateFolder: () => void;
  onUpload: (files: FileList | File[]) => void;
  onDeleteFolder: (path: string, name: string) => void;
  onDeleteFile: (path: string) => void;
  indexJob: IndexJob | null;
  onReindexFolder: () => void;
  onReindexFile: (path: string) => void;
  llmConfigured: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
}): React.ReactElement {
  const folderIndexRunning =
    (indexJob?.status === "running" || indexJob?.status === "queued") &&
    indexJob.scope_path === currentPath;

  const isFileIndexing = (filePath: string): boolean =>
    (indexJob?.status === "running" || indexJob?.status === "queued") &&
    (indexJob.scope_path === filePath || indexJob.current_file === filePath);
  const hue = dirHue;
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
          <button type="button" className="tl-nav-item tl-nav-item--back" onClick={onGoHome}>
            <ArrowLeft size={16} />
            Все направления
          </button>
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
            <button type="button" className="tl-breadcrumb__home" onClick={onGoHome} title="Все направления">
              Направления
            </button>
            <span className="tl-breadcrumb__segment">
              <ChevronRight size={14} />
              <button type="button" onClick={() => onNavigate("")}>
                {direction.title}
              </button>
            </span>
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
            <button
              type="button"
              className={`tl-btn tl-btn--ghost${chatOpen ? " tl-btn--active" : ""}`}
              onClick={onToggleChat}
              title="Спросить по документам"
            >
              <MessageSquare size={16} />
              Чат
            </button>
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
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              {busy ? "Загрузка…" : "Загрузить"}
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
                    disabled={folderIndexRunning}
                    onClick={() => {
                      setMenuOpen(false);
                      onReindexFolder();
                    }}
                  >
                    <RefreshCw size={15} />
                    Переиндексировать папку
                  </button>
                  <p className="tl-menu__hint">
                    Индексирует все файлы в папке и подпапках. Для одного документа — ↻ у файла.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <DocumentSearch slug={direction.slug} scopePath={currentPath} />

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
            {tree.files.map((file) => (
                <article key={file.path} className="tl-doc-row">
                  <a className="tl-doc-row__main" href={fileUrl(direction.slug, file.path)} target="_blank" rel="noreferrer">
                    <span className="tl-doc-row__title">
                      <span className="tl-doc-row__name">{file.name}</span>
                      {file.text_index_status === "ready" ? (
                        <span className="tl-pill tl-pill--ok" title="Текст извлечён — доступен поиск и вопросы ИИ">
                          ИИ
                        </span>
                      ) : file.text_index_status === "partial" ? (
                        <span className="tl-pill tl-pill--warn" title={file.text_index_note ?? ""}>
                          ИИ~
                        </span>
                      ) : (
                        <span className="tl-pill tl-pill--muted" title="Текст ещё не извлечён">
                          —
                        </span>
                      )}
                    </span>
                    <span className="tl-doc-row__meta">
                      {formatBytes(file.size)} · {formatDate(file.modified_at)}
                    </span>
                  </a>
                  <button
                    type="button"
                    className="tl-icon-btn"
                    title={
                      file.text_index_status === "ready"
                        ? "Переиндексировать заново (OCR)"
                        : "Переиндексировать файл (OCR)"
                    }
                    disabled={isFileIndexing(file.path)}
                    onClick={() => onReindexFile(file.path)}
                  >
                    <RefreshCw size={15} />
                  </button>
                  <button
                    type="button"
                    className="tl-icon-btn tl-icon-btn--danger"
                    title="Удалить"
                    onClick={() => void onDeleteFile(file.path)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
            ))}
          </div>
        )}
      </section>

      {chatOpen ? (
        <>
          <button
            type="button"
            className="tl-chat-backdrop"
            aria-label="Закрыть чат"
            onClick={onToggleChat}
          />
          <ChatPanel
            key={`${direction.slug}:${currentPath}`}
            slug={direction.slug}
            scopePath={currentPath}
            directionTitle={direction.title}
            llmConfigured={llmConfigured}
            onClose={onToggleChat}
          />
        </>
      ) : null}
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
