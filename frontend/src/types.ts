export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface JobOptions {
  processor: string;
  scale: number;
  noise: number;
  realesrganModel: string;
  realcuganModel: string;
  libplaceboShader: string;
  rifeModel: string;
  frameRateMul: number;
  sceneThresh: number;
  rifeUhd: boolean;
  denoise: boolean;
  codec: string;
  quality: string;
  container: string;
  imageFormat: string;
  copyAudio: boolean;
}

export interface MediaMeta {
  width: number;
  height: number;
  codec: string | null;
  fps: number | null;
  duration: number | null;
  frames: number | null;
  audioCodec: string | null;
  size: number;
}

export interface Job {
  id: string;
  kind: "video" | "image";
  status: JobStatus;
  originalName: string;
  downloadName: string | null;
  options: JobOptions;
  inputMeta: MediaMeta | null;
  outputMeta: MediaMeta | null;
  progress: number;
  framesDone: number;
  framesTotal: number;
  fps: number;
  etaSeconds: number | null;
  device: number | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  queuePosition: number | null;
  urls: {
    input: string;
    output: string | null;
    download: string | null;
    thumbInput: string | null;
    thumbOutput: string | null;
    compareInput: string | null;
    compareOutput: string | null;
  };
}

export interface Catalog {
  processors: Record<string, { label: string; mode: "upscale" | "interpolate" }>;
  realesrgan: Record<string, { scales: number[]; label: string; denoise?: boolean }>;
  realcugan: Record<string, Record<string, number[]>>;
  libplacebo: string[];
  rife: string[];
  codecs: Record<string, { label: string; kind: string }>;
  qualities: string[];
  imageFormats: Record<string, string>;
  defaults: JobOptions;
  maxUploadMb: number;
}

export interface GpuStat {
  name: string;
  utilization: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperature: number | null;
  powerWatts: number | null;
}

export interface SystemInfo {
  engine: { available: boolean; version: string | null; device: number };
  vulkanDevices: { index: number; name: string; type: string }[];
  gpus: GpuStat[];
  disk: { freeBytes: number; totalBytes: number; storageUsedBytes: number };
  queue: Partial<Record<JobStatus, number>>;
  currentJobId: string | null;
}
