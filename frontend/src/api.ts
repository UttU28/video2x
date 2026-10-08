import type { Catalog, Job, JobOptions, SystemInfo } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getCatalog = () => request<Catalog>("/api/catalog");
export const getSystem = () => request<SystemInfo>("/api/system");
export const listJobs = () => request<Job[]>("/api/jobs");
export const cancelJob = (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" });
export const retryJob = (id: string) => request<Job>(`/api/jobs/${id}/retry`, { method: "POST" });
export const deleteJob = (id: string) => request<void>(`/api/jobs/${id}`, { method: "DELETE" });
export const getJobLog = (id: string) => request<{ log: string }>(`/api/jobs/${id}/log`);

/** Streams the raw file as the request body (XHR so we get upload progress). */
export function uploadJob(
  file: File,
  options: JobOptions,
  onProgress: (fraction: number) => void,
): { promise: Promise<Job>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const params = new URLSearchParams({ fileName: file.name, options: JSON.stringify(options) });
  const promise = new Promise<Job>((resolve, reject) => {
    xhr.open("POST", `/api/jobs?${params}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { detail?: unknown } | Job | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Job);
      else {
        const detail = (body as { detail?: unknown } | null)?.detail;
        reject(new Error(typeof detail === "string" ? detail : `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
