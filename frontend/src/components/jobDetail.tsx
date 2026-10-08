import { useEffect, useState } from "react";
import { getJobLog } from "../api";
import { describeJob, formatBytes, formatDuration, formatResolution } from "../format";
import type { Job } from "../types";
import CompareSlider from "./compareSlider";
import { CloseIcon, DownloadIcon, LogIcon } from "./icons";

interface Props {
  job: Job;
  onClose: () => void;
}

export default function JobDetail({ job, onClose }: Props) {
  const [log, setLog] = useState<string | null>(null);
  const [tab, setTab] = useState<"compare" | "output" | "original">(job.status === "completed" ? "compare" : "original");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = job.status === "completed";
  const compareBefore = job.kind === "image" ? job.urls.input : job.urls.compareInput;
  const compareAfter = job.kind === "image" ? job.urls.output : job.urls.compareOutput;
  const canCompare = done && compareBefore && compareAfter && job.options.processor !== "rife";

  const loadLog = async () => {
    try {
      setLog((await getJobLog(job.id)).log || "(empty)");
    } catch (e) {
      setLog((e as Error).message);
    }
  };

  const rows: [string, string][] = [
    ["Pipeline", describeJob(job)],
    ["Input", `${formatResolution(job.inputMeta)} · ${job.inputMeta?.codec ?? "?"} · ${formatBytes(job.inputMeta?.size)}${job.inputMeta?.fps ? ` · ${job.inputMeta.fps} fps` : ""}`],
  ];
  if (job.outputMeta) {
    rows.push(["Output", `${formatResolution(job.outputMeta)} · ${job.outputMeta.codec ?? "?"} · ${formatBytes(job.outputMeta.size)}${job.outputMeta.fps ? ` · ${job.outputMeta.fps} fps` : ""}`]);
  }
  if (job.kind === "video") rows.push(["Encoder", `${job.options.codec} · ${job.options.quality} · ${job.options.container}`]);
  if (job.startedAt && job.finishedAt) rows.push(["Processing time", formatDuration(job.finishedAt - job.startedAt)]);
  if (job.device != null) rows.push(["Vulkan device", `#${job.device}`]);

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={job.originalName}>
        <header className="modalHeader">
          <div>
            <h2 title={job.originalName}>{job.originalName}</h2>
            <span className={`badge ${job.status}`}>{job.status}</span>
          </div>
          <div className="modalActions">
            {done && job.urls.download && <a className="primary small" href={job.urls.download} download><DownloadIcon /> Download</a>}
            <button className="iconButton" onClick={onClose} title="Close"><CloseIcon /></button>
          </div>
        </header>

        <div className="tabs">
          {canCompare && <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>Compare</button>}
          {done && <button className={tab === "output" ? "active" : ""} onClick={() => setTab("output")}>Result</button>}
          <button className={tab === "original" ? "active" : ""} onClick={() => setTab("original")}>Original</button>
        </div>

        <div className="viewer">
          {tab === "compare" && canCompare && <CompareSlider before={compareBefore!} after={compareAfter!} />}
          {tab === "output" && done && job.urls.output && (
            job.kind === "image"
              ? <img src={job.urls.output} alt="Result" />
              : <video src={job.urls.output} controls preload="metadata" />
          )}
          {tab === "original" && (
            job.kind === "image"
              ? <img src={job.urls.input} alt="Original" />
              : <video src={job.urls.input} controls preload="metadata" />
          )}
        </div>
        {tab === "compare" && <p className="muted small center">Drag the handle to compare. {job.kind === "video" ? "This is a single frame taken from the same timestamp in both videos." : ""}</p>}

        <dl className="detailGrid">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {job.error && <div className="alert error">{job.error}</div>}

        <div className="logSection">
          {log === null ? (
            <button className="ghost small" onClick={loadLog}><LogIcon /> Show engine log</button>
          ) : (
            <pre className="log mono">{log}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
