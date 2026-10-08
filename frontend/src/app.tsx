import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import JobCard from "./components/jobCard";
import JobDetail from "./components/jobDetail";
import SystemBar from "./components/systemBar";
import UploadPanel from "./components/uploadPanel";
import type { Catalog, Job, SystemInfo } from "./types";

type Filter = "all" | "active" | "completed" | "failed";

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await api.listJobs());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api.getCatalog().then(setCatalog).catch((e) => setLoadError(e.message));
    refreshJobs();
  }, [refreshJobs]);

  const hasActive = jobs.some((j) => j.status === "queued" || j.status === "processing");

  useEffect(() => {
    const timer = setInterval(refreshJobs, hasActive ? 1500 : 6000);
    return () => clearInterval(timer);
  }, [hasActive, refreshJobs]);

  useEffect(() => {
    const load = () => api.getSystem().then(setSystem).catch(() => setSystem(null));
    load();
    const timer = setInterval(load, hasActive ? 2500 : 10000);
    return () => clearInterval(timer);
  }, [hasActive]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const runAction = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action();
      if (message) setToast(message);
    } catch (e) {
      setToast((e as Error).message);
    }
    refreshJobs();
  };

  const visibleJobs = useMemo(() => jobs.filter((j) => {
    if (filter === "active") return j.status === "queued" || j.status === "processing";
    if (filter === "completed") return j.status === "completed";
    if (filter === "failed") return j.status === "failed" || j.status === "cancelled";
    return true;
  }), [jobs, filter]);

  const openJob = jobs.find((j) => j.id === openJobId) ?? null;
  const counts = {
    all: jobs.length,
    active: jobs.filter((j) => j.status === "queued" || j.status === "processing").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length,
  };

  return (
    <div className="app">
      <SystemBar system={system} />

      {loadError && <div className="alert error banner">Can't reach the server: {loadError}</div>}

      <main className="layout">
        {catalog ? (
          <UploadPanel
            catalog={catalog}
            engineReady={system?.engine.available ?? true}
            onQueued={(job) => { setToast(`Queued ${job.originalName}`); refreshJobs(); }}
          />
        ) : (
          <section className="card uploadPanel skeleton" />
        )}

        <section className="card jobsPanel">
          <header className="cardHeader">
            <h2>Jobs</h2>
            <div className="filterTabs">
              {(["all", "active", "completed", "failed"] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)} <span className="count">{counts[f]}</span>
                </button>
              ))}
            </div>
          </header>

          {visibleJobs.length === 0 ? (
            <div className="emptyState">
              <div className="emptyArt" />
              <strong>{jobs.length ? "Nothing here" : "No jobs yet"}</strong>
              <span className="muted">{jobs.length ? "Try another filter." : "Upload a video or image to start upscaling on the GPU."}</span>
            </div>
          ) : (
            <div className="jobList">
              {visibleJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onOpen={(j) => setOpenJobId(j.id)}
                  onCancel={(j) => runAction(() => api.cancelJob(j.id), "Job cancelled")}
                  onRetry={(j) => runAction(() => api.retryJob(j.id), "Job re-queued")}
                  onDelete={(j) => {
                    if (confirm(`Delete "${j.originalName}" and its output files?`)) {
                      runAction(() => api.deleteJob(j.id), "Job deleted");
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="footer muted small">
        Powered by <a href="https://github.com/k4yt3x/video2x" target="_blank" rel="noreferrer">Video2X</a> · Real-ESRGAN · Real-CUGAN · Anime4K · RIFE
      </footer>

      {openJob && <JobDetail job={openJob} onClose={() => setOpenJobId(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
