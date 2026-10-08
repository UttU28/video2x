import { useEffect, useMemo, useRef, useState } from "react";
import { uploadJob } from "../api";
import { formatBytes } from "../format";
import type { Catalog, Job, JobOptions } from "../types";
import { ClipboardIcon, CloseIcon, FilmIcon, ImageIcon, SparkIcon, UploadIcon } from "./icons";
import OptionsForm, { normalizeOptions } from "./optionsForm";
import PresetPicker from "./presetPicker";

const imageExtensions = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"];
const videoExtensions = ["mp4", "mkv", "mov", "webm", "avi", "m4v", "flv", "wmv", "mpg", "mpeg", "ts", "gif"];
const acceptTypes = "video/*,image/png,image/jpeg,image/webp,image/bmp,image/tiff,.mkv,.ts";
// V2: defaults moved to GPU (NVENC) encoding — ignore options saved before that.
const optionsStorageKey = "video2xOptionsV2";
const advancedStorageKey = "video2xShowAdvanced";
const mimeExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/bmp": "bmp", "image/tiff": "tif",
  "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "video/x-matroska": "mkv", "video/x-msvideo": "avi",
};

function extensionOf(name: string) {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function isImageName(name: string) {
  return imageExtensions.includes(extensionOf(name));
}

function isMediaName(name: string) {
  return isImageName(name) || videoExtensions.includes(extensionOf(name));
}

/** Clipboard files are often unnamed or all called "image.png" — give them a real, typed name. */
function namePastedFile(blob: Blob, originalName = ""): File | null {
  const ext = mimeExtensions[blob.type] ?? extensionOf(originalName);
  if (!ext) return null;
  const keepName = originalName && isMediaName(originalName) && originalName !== "image.png";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return new File([blob], keepName ? originalName : `pasted-${stamp}.${ext}`, { type: blob.type });
}

function loadSavedOptions(defaults: JobOptions): JobOptions {
  try {
    const saved = localStorage.getItem(optionsStorageKey);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

interface Props {
  catalog: Catalog;
  engineReady: boolean;
  onQueued: (job: Job) => void;
}

export default function UploadPanel({ catalog, engineReady, onQueued }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<JobOptions>(() => loadSavedOptions(catalog.defaults));
  const [dragging, setDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(() => {
    try {
      return localStorage.getItem(advancedStorageKey) === "1";
    } catch {
      return false;
    }
  });
  const toggleAdvanced = () => {
    setShowAdvanced((v) => {
      try {
        localStorage.setItem(advancedStorageKey, v ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  };
  const [uploadFraction, setUploadFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isImage = file ? isImageName(file.name) : false;
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    setOptions((o) => normalizeOptions(catalog, o, isImage));
  }, [catalog, isImage]);

  useEffect(() => {
    try {
      localStorage.setItem(optionsStorageKey, JSON.stringify(options));
    } catch {
      /* storage unavailable */
    }
  }, [options]);

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    setError(null);
    if (!isMediaName(f.name)) {
      setError(`"${f.name}" isn't a supported video or image`);
      return;
    }
    if (f.size > catalog.maxUploadMb * 1024 * 1024) {
      setError(`File is larger than the ${catalog.maxUploadMb} MB limit`);
      return;
    }
    setFile(f);
  };

  // Ctrl/⌘+V anywhere on the page: take the first pasted image or video as the input.
  const uploadingRef = useRef(false);
  uploadingRef.current = uploadFraction !== null;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (uploadingRef.current || !e.clipboardData) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input:not([type=file]), textarea, [contenteditable=true]")) return;
      const item = Array.from(e.clipboardData.items).find(
        (i) => i.kind === "file" && (i.type.startsWith("image/") || i.type.startsWith("video/")),
      );
      const blob = item?.getAsFile();
      if (!blob) {
        if (e.clipboardData.types.includes("Files")) setError("Clipboard file isn't an image or video");
        return;
      }
      e.preventDefault();
      const named = namePastedFile(blob, blob.name);
      if (named) pickFile(named);
      else setError(`Unsupported clipboard type: ${blob.type || "unknown"}`);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // Paste button (phones / no keyboard): async Clipboard API, HTTPS only, mostly images.
  const canReadClipboard = typeof navigator !== "undefined" && !!navigator.clipboard?.read;
  const pasteFromButton = async () => {
    setError(null);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/") || t.startsWith("video/"));
        if (!type) continue;
        const named = namePastedFile(await item.getType(type));
        if (named) return pickFile(named);
      }
      setError("No image or video in the clipboard");
    } catch {
      setError("Clipboard access was blocked — use Ctrl+V / ⌘V instead");
    }
  };

  const submit = async () => {
    if (!file) return;
    setError(null);
    setUploadFraction(0);
    const { promise, abort } = uploadJob(file, options, setUploadFraction);
    abortRef.current = abort;
    try {
      const job = await promise;
      onQueued(job);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadFraction(null);
      abortRef.current = null;
    }
  };

  const uploading = uploadFraction !== null;

  return (
    <section className="card uploadPanel">
      <header className="cardHeader">
        <h2><SparkIcon /> New job</h2>
        <span className="muted">Video or image · up to {catalog.maxUploadMb >= 1024 ? `${catalog.maxUploadMb / 1024} GB` : `${catalog.maxUploadMb} MB`}</span>
      </header>

      {!file ? (
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        >
          <div className="dropIcon"><UploadIcon width={28} height={28} /></div>
          <strong>Drop a video or image here</strong>
          <span className="muted">or click to browse · MP4, MKV, MOV, WebM, PNG, JPG, WebP</span>
          <span className="pasteHint">
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd> to paste
            {canReadClipboard && (
              <button
                type="button"
                className="ghost small"
                onClick={(e) => { e.stopPropagation(); pasteFromButton(); }}
              >
                <ClipboardIcon width={15} height={15} /> Paste
              </button>
            )}
          </span>
          <input ref={inputRef} type="file" accept={acceptTypes} hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      ) : (
        <div className="filePreview">
          <div className="previewMedia">
            {isImage ? <img src={previewUrl!} alt="" /> : <video src={previewUrl!} muted controls preload="metadata" />}
          </div>
          <div className="fileInfo">
            <span className="fileKind">{isImage ? <ImageIcon /> : <FilmIcon />}{isImage ? "Image" : "Video"}</span>
            <strong title={file.name}>{file.name}</strong>
            <span className="muted">{formatBytes(file.size)}</span>
          </div>
          {!uploading && (
            <button className="iconButton" onClick={() => setFile(null)} title="Remove file"><CloseIcon /></button>
          )}
        </div>
      )}

      <PresetPicker
        catalog={catalog}
        options={options}
        isImage={file ? isImage : null}
        onApply={(patch) => setOptions((o) => normalizeOptions(catalog, { ...o, ...patch }, isImage))}
        showDetails={showAdvanced}
      />

      <button type="button" className="advancedToggle" aria-expanded={showAdvanced} onClick={toggleAdvanced}>
        <span className={`chevron ${showAdvanced ? "open" : ""}`}>›</span>
        {showAdvanced ? "Hide advanced settings" : "Advanced settings"}
      </button>

      {showAdvanced ? (
        <OptionsForm catalog={catalog} options={options} isImage={isImage} onChange={setOptions} />
      ) : (
        <div className="advancedSpacer" />
      )}

      {error && <div className="alert error">{error}</div>}
      {!engineReady && <div className="alert warn">The upscaling engine isn't available on the server yet.</div>}

      {uploading ? (
        <div className="uploadProgress">
          <div className="progressBar"><div style={{ width: `${(uploadFraction ?? 0) * 100}%` }} /></div>
          <div className="uploadRow">
            <span>{uploadFraction! < 1 ? `Uploading… ${Math.round(uploadFraction! * 100)}%` : "Analyzing file…"}</span>
            <button className="ghost small" onClick={() => abortRef.current?.()}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="primary big" disabled={!file || !engineReady} onClick={submit}>
          <SparkIcon /> {options.processor === "rife" ? "Interpolate" : "Upscale"} {file ? (isImage ? "image" : "video") : ""}
        </button>
      )}
    </section>
  );
}
