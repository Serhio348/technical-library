import { formatDuration } from "../api";
import type { IndexJob } from "../types";

export function IndexProgressPanel({ job }: { job: IndexJob | null }): React.ReactElement | null {
  if (!job) return null;

  const running = job.status === "running";

  return (
    <div className="tl-index-panel">
      <div className="tl-index-panel__head">
        <span className="tl-index-panel__title">
          {running ? "Индексация документов" : job.status === "done" ? "Индексация завершена" : "Ошибка индексации"}
        </span>
        <span className={`tl-index-panel__status tl-index-panel__status--${job.status}`}>
          {running ? `${job.percent}%` : job.status === "done" ? "Готово" : "Ошибка"}
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
          {running ? (
            <span className="tl-index-panel__eta">
              Осталось: {formatDuration(job.eta_seconds)} · прошло {formatDuration(job.elapsed_seconds)}
            </span>
          ) : job.status === "done" ? (
            <span className="tl-index-panel__eta">
              {job.updated} файлов · ошибок {job.failed} · {formatDuration(job.elapsed_seconds)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
