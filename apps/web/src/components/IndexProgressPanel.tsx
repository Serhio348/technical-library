import { formatDuration } from "../api";
import type { IndexJob } from "../types";

function indexHintForFile(job: IndexJob): string | null {
  const filePath = job.current_file;
  if (!filePath) return null;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) {
    if (job.ocr_page_total && job.ocr_page) {
      return `OCR: страница ${job.ocr_page} из ${job.ocr_page_total}. При 2+ задачах OCR идёт по очереди — интерфейс не завис, дождитесь завершения.`;
    }
    if (job.percent >= 88) {
      return "OCR большого PDF может занять длительное время — полоска движется по страницам.";
    }
  }
  if (lower.endsWith(".docx") || lower.endsWith(".doc") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return "Word и текстовые файлы индексируются за секунды — OCR не нужен.";
  }
  return null;
}

function IndexProgressItem({ job }: { job: IndexJob }): React.ReactElement {
  const queued = job.status === "queued";
  const running = job.status === "running";

  return (
    <div className="tl-index-panel">
      <div className="tl-index-panel__head">
        <span className="tl-index-panel__title">
          {queued
            ? "Индексация в очереди"
            : running
              ? "Индексация документов"
              : job.status === "done"
                ? "Индексация завершена"
                : "Ошибка индексации"}
        </span>
        <span className={`tl-index-panel__status tl-index-panel__status--${job.status}`}>
          {queued
            ? job.queue_position
              ? `#${job.queue_position}`
              : "Очередь"
            : running
              ? `${job.percent}%`
              : job.status === "done"
                ? "Готово"
                : "Ошибка"}
        </span>
      </div>

      <div className="tl-index-panel__body">
        <div
          className="tl-index-panel__bar"
          role="progressbar"
          aria-valuenow={job.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="tl-index-panel__bar-fill" style={{ width: `${job.percent}%` }} />
        </div>
        <div className="tl-index-panel__meta">
          <span>{job.message}</span>
          {job.current_file && running ? (
            <span className="tl-index-panel__file">{job.current_file.split("/").pop()}</span>
          ) : null}
          {queued ? (
            <span className="tl-index-panel__meta-row">
              <span className="tl-index-panel__hint">
                Одновременно выполняется не более 3 индексаций — задача стартует автоматически.
              </span>
            </span>
          ) : running ? (
            <span className="tl-index-panel__meta-row">
              <span className="tl-index-panel__eta">
                Осталось: {formatDuration(job.eta_seconds)} · прошло {formatDuration(job.elapsed_seconds)}
              </span>
              {(() => {
                const hint = indexHintForFile(job);
                return hint ? <span className="tl-index-panel__hint">{hint}</span> : null;
              })()}
            </span>
          ) : job.status === "done" ? (
            <span className="tl-index-panel__meta-row">
              <span className="tl-index-panel__eta">
                {job.updated} файлов · ошибок {job.failed} · {formatDuration(job.elapsed_seconds)}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function IndexProgressPanel({ jobs }: { jobs: IndexJob[] }): React.ReactElement | null {
  if (jobs.length === 0) return null;

  return (
    <div className="tl-index-panel-stack">
      {jobs.map((job) => (
        <IndexProgressItem key={job.job_id} job={job} />
      ))}
    </div>
  );
}
