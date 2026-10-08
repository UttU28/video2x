import type { Job, MediaMeta } from "./types";

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp > 1 ? 1 : 0)} ${units[exp]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

export function formatResolution(meta: MediaMeta | null | undefined): string {
  return meta?.width ? `${meta.width}×${meta.height}` : "—";
}

export function formatAgo(epochSeconds: number): string {
  const diff = Date.now() / 1000 - epochSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

export function describeJob(job: Job): string {
  const o = job.options;
  switch (o.processor) {
    case "realesrgan":
      return `Real-ESRGAN · ${o.realesrganModel} · ${o.scale}×`;
    case "realcugan":
      return `Real-CUGAN · ${o.realcuganModel.replace("models-", "")} · ${o.scale}× · noise ${o.noise}`;
    case "libplacebo":
      return `Anime4K · ${o.libplaceboShader} · ${o.scale}×`;
    case "rife":
      return `RIFE · ${o.rifeModel} · ${o.frameRateMul}× fps`;
    default:
      return o.processor;
  }
}
