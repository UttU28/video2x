import { describeJob, formatAgo, formatBytes, formatDuration, formatResolution } from "../format";
import type { Job } from "../types";
import { DownloadIcon, EyeIcon, FilmIcon, ImageIcon, RetryIcon, StopIcon, TrashIcon } from "./icons";

interface Props {
  job: Job;
  onOpen: (job: Job) => void;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  onDelete: (job: Job) => void;
}

const statusLabels: Record<Job["status"], string> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function JobCard({ job, onOpen, onCancel, onRetry, onDelete }: Props) {
  const active = job.status === "queued" || job.status === "processing";
  const thumb = job.urls.thumbOutput ?? job.urls.thumbInput ?? (job.status === "completed" && job.kind === "image" ? job.urls.output : null);
  const outRes = job.outputMeta
    ? formatResolution(job.outputMeta)
    : job.inputMeta && job.options.processor !== "rife"
      ? `${job.inputMeta.width * job.options.scale}×${job.inputMeta.height * job.options.scale}`
      : formatResolution(job.inputMeta);

  return (
    <article className={`jobCard status-${job.status}`}>
      <button className="jobThumb" onClick={() => onOpen(job)} title="Open details">
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <div className="thumbPlaceholder">{job.kind === "image" ? <ImageIcon /> : <FilmIcon />}</div>}
        <span className="kindBadge">{job.kind === "image" ? <ImageIcon width={13} height={13} /> : <FilmIcon width={13} height={13} />}</span>
      </button>

      <div className="jobBody">
        <div className="jobTitleRow">
          <h3 title={job.originalName}>{job.originalName}</h3>
          <span className={`badge ${job.status}`}>{statusLabels[job.status]}</span>
        </div>
        <div className="jobMeta">
          <span>{describeJob(job)}</span>
          <span className="resolution">{formatResolution(job.inputMeta)} → <b>{outRes}</b></span>
          {job.inputMeta?.duration ? <span>{formatDuration(job.inputMeta.duration)}</span> : null}
        </div>

        {job.status === "processing" && (
          <div className="jobProgress">
            <div className="progressBar live"><div style={{ width: `${job.progress}%` }} /></div>
            <div className="progressStats mono">
              <span>{job.progress.toFixed(1)}%</span>
              <span>{job.framesDone}/{job.framesTotal || "?"} frames</span>
              <span>{job.fps.toFixed(1)} fps</span>
              <span>ETA {formatDuration(job.etaSeconds)}</span>
            </div>
          </div>
        )}
        {job.status === "queued" && <div className="muted small">Waiting for GPU · position {job.queuePosition ?? "?"}</div>}
        {job.status === "failed" && <div className="errorText" title={job.error ?? ""}>{job.error}</div>}
        {job.status === "completed" && (
          <div className="muted small">
            {formatBytes(job.outputMeta?.size)} · took {formatDuration((job.finishedAt ?? 0) - (job.startedAt ?? 0))} · {formatAgo(job.finishedAt ?? job.createdAt)}
          </div>
        )}
      </div>

      <div className="jobActions">
        {job.status === "completed" && job.urls.download && (
          <a className="primary small" href={job.urls.download} download><DownloadIcon /> Download</a>
        )}
        <button className="iconButton" title="Details" onClick={() => onOpen(job)}><EyeIcon /></button>
        {active && <button className="iconButton" title="Cancel" onClick={() => onCancel(job)}><StopIcon /></button>}
        {(job.status === "failed" || job.status === "cancelled") && (
          <button className="iconButton" title="Retry" onClick={() => onRetry(job)}><RetryIcon /></button>
        )}
        <button className="iconButton danger" title="Delete" onClick={() => onDelete(job)}><TrashIcon /></button>
      </div>
    </article>
  );
}
