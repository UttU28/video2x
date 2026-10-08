import type { Catalog, JobOptions } from "../types";

interface Props {
  catalog: Catalog;
  options: JobOptions;
  isImage: boolean;
  onChange: (next: JobOptions) => void;
}

const noiseLabels: Record<number, string> = {
  [-1]: "Conservative",
  0: "None",
  1: "Light",
  2: "Medium",
  3: "Strong",
};

const engineHints: Record<string, string> = {
  realesrgan: "All-rounder AI upscaler: anime, real-life video and photos.",
  realcugan: "Anime specialist with a denoise control. Often the cleanest lines.",
  libplacebo: "Fastest, shader-based (not AI). Softer result, good for previews.",
};
const modelHints: Record<string, string> = {
  "realesr-animevideov3": "Made for animated video. Fast, and the only one here with 2× and 3×.",
  "realesrgan-plus-anime": "Anime stills and drawings, finer detail than AnimeVideo v3.",
  "realesrgan-plus": "Real photos and film. Most detail, but the heaviest.",
  "realesr-generalv3": "Real-life video, faster than x4plus. Turn on Denoise for grainy clips.",
  "models-se": "Standard Real-CUGAN model: works for most anime.",
  "models-pro": "Sharper, crisper lines than SE.",
  "models-nose": "Never removes noise: keeps all original texture.",
};
const shaderHint = "a = for soft or blurry sources · b = slightly blurred · c = already sharp. “+a / +b” = stronger. “gan” = newest.";
const rifeHint = "v4.26 = newest and best · -lite = faster · UHD / HD = for big sources · anime = tuned for animation.";

const noiseHints: Record<number, string> = {
  [-1]: "Safest: keeps detail, cleans only obvious artifacts.",
  0: "No cleanup at all: keeps every bit of original texture.",
  1: "Light cleanup.",
  2: "Medium cleanup for noticeably noisy sources.",
  3: "Strong cleanup: very noisy sources; may smooth fine detail.",
};
const qualityHints: Record<string, string> = {
  high: "Near-lossless and bigger files. For keeping or archiving.",
  balanced: "Looks the same as High to most eyes, much smaller.",
  small: "Smallest files, for sharing in chats or on phones.",
};

const qualityLabels: Record<string, string> = { high: "High", balanced: "Balanced", small: "Small file" };

export function supportedScales(catalog: Catalog, o: JobOptions): number[] {
  if (o.processor === "realesrgan") return catalog.realesrgan[o.realesrganModel]?.scales ?? [];
  if (o.processor === "realcugan") return Object.keys(catalog.realcugan[o.realcuganModel] ?? {}).map(Number);
  if (o.processor === "libplacebo") return [2, 3, 4];
  return [];
}

/** Keep scale/noise inside what the selected model supports. */
export function normalizeOptions(catalog: Catalog, o: JobOptions, isImage: boolean): JobOptions {
  const next = { ...o };
  if (isImage && next.processor === "rife") next.processor = "realesrgan";
  const scales = supportedScales(catalog, next);
  if (scales.length && !scales.includes(next.scale)) next.scale = scales.includes(2) ? 2 : scales[0];
  if (next.processor === "realcugan") {
    const noises = catalog.realcugan[next.realcuganModel]?.[String(next.scale)] ?? [];
    if (!noises.includes(next.noise)) next.noise = noises.includes(-1) ? -1 : noises[0];
  }
  return next;
}

function Segmented<T extends string | number>({
  value, items, onChange, disabled,
}: {
  value: T;
  items: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {items.map((item) => (
        <button
          type="button"
          key={String(item.value)}
          role="radio"
          aria-checked={item.value === value}
          className={item.value === value ? "active" : ""}
          disabled={disabled || item.disabled}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default function OptionsForm({ catalog, options, isImage, onChange }: Props) {
  const set = (patch: Partial<JobOptions>) => onChange(normalizeOptions(catalog, { ...options, ...patch }, isImage));
  const mode = options.processor === "rife" ? "interpolate" : "upscale";
  const scales = supportedScales(catalog, options);
  const cuganNoises = catalog.realcugan[options.realcuganModel]?.[String(options.scale)] ?? [];

  return (
    <div className="optionsForm">
      <div className="field">
        <label>Mode</label>
        <Segmented
          value={mode}
          items={[
            { value: "upscale", label: "Upscale" },
            { value: "interpolate", label: isImage ? "Interpolate (video only)" : "Interpolate frames", disabled: isImage },
          ]}
          onChange={(m) => set({ processor: m === "interpolate" ? "rife" : "realesrgan" })}
        />
      </div>

      {mode === "upscale" && (
        <>
          <div className="field">
            <label>Engine</label>
            <Segmented
              value={options.processor}
              items={[
                { value: "realesrgan", label: "Real-ESRGAN" },
                { value: "realcugan", label: "Real-CUGAN" },
                { value: "libplacebo", label: "Anime4K" },
              ]}
              onChange={(processor) => set({ processor })}
            />
            <span className="fieldHint">{engineHints[options.processor]}</span>
          </div>

          <div className="field">
            <label>Model</label>
            {options.processor === "realesrgan" && (
              <select value={options.realesrganModel} onChange={(e) => set({ realesrganModel: e.target.value })}>
                {Object.entries(catalog.realesrgan).map(([key, m]) => (
                  <option key={key} value={key}>{m.label}</option>
                ))}
              </select>
            )}
            {options.processor === "realcugan" && (
              <select value={options.realcuganModel} onChange={(e) => set({ realcuganModel: e.target.value })}>
                <option value="models-se">SE (general, 2–4×)</option>
                <option value="models-pro">Pro (sharper, 2–3×)</option>
                <option value="models-nose">No-denoise (2×)</option>
              </select>
            )}
            {options.processor === "libplacebo" && (
              <select value={options.libplaceboShader} onChange={(e) => set({ libplaceboShader: e.target.value })}>
                {catalog.libplacebo.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <span className="fieldHint">
              {options.processor === "realesrgan" && modelHints[options.realesrganModel]}
              {options.processor === "realcugan" && modelHints[options.realcuganModel]}
              {options.processor === "libplacebo" && shaderHint}
            </span>
          </div>

          <div className="field">
            <label>Scale</label>
            <Segmented
              value={options.scale}
              items={[2, 3, 4].map((s) => ({ value: s, label: `${s}×`, disabled: !scales.includes(s) }))}
              onChange={(scale) => set({ scale })}
            />
            <span className="fieldHint">How many times bigger: 2× turns 1280×720 into 2560×1440. Greyed out = this model can't do it.</span>
          </div>

          {options.processor === "realcugan" && (
            <div className="field">
              <label>Denoise</label>
              <Segmented
                value={options.noise}
                items={cuganNoises.map((n) => ({ value: n, label: noiseLabels[n] ?? String(n) }))}
                onChange={(noise) => set({ noise })}
              />
              <span className="fieldHint">{noiseHints[options.noise]}</span>
            </div>
          )}

          {options.processor === "realesrgan" && catalog.realesrgan[options.realesrganModel]?.denoise && (
            <label className="toggle">
              <input type="checkbox" checked={options.denoise} onChange={(e) => set({ denoise: e.target.checked })} />
              <span>Denoise (WDN variant)</span>
            </label>
          )}
        </>
      )}

      {mode === "interpolate" && (
        <>
          <div className="field">
            <label>Model</label>
            <select value={options.rifeModel} onChange={(e) => set({ rifeModel: e.target.value })}>
              {catalog.rife.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <span className="fieldHint">{rifeHint}</span>
          </div>
          <div className="field">
            <label>Frame rate</label>
            <Segmented
              value={options.frameRateMul}
              items={[2, 3, 4].map((m) => ({ value: m, label: `${m}×` }))}
              onChange={(frameRateMul) => set({ frameRateMul })}
            />
          </div>
          <div className="field">
            <label>Scene-cut threshold <span className="hint">{options.sceneThresh}%</span></label>
            <input
              type="range" min={0} max={50} step={1} value={options.sceneThresh}
              onChange={(e) => set({ sceneThresh: Number(e.target.value) })}
            />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={options.rifeUhd} onChange={(e) => set({ rifeUhd: e.target.checked })} />
            <span>UHD mode (for 4K sources)</span>
          </label>
        </>
      )}

      <div className="divider" />

      {isImage ? (
        <div className="field">
          <label>Output format</label>
          <Segmented
            value={options.imageFormat}
            items={Object.keys(catalog.imageFormats).map((f) => ({ value: f, label: f.toUpperCase() }))}
            onChange={(imageFormat) => set({ imageFormat })}
          />
        </div>
      ) : (
        <>
          <div className="field">
            <label>Encoder</label>
            <select value={options.codec} onChange={(e) => set({ codec: e.target.value })}>
              {Object.entries(catalog.codecs).map(([key, c]) => (
                <option key={key} value={key}>{c.label}</option>
              ))}
            </select>
            <span className="fieldHint">
              {catalog.codecs[options.codec]?.kind === "nvenc"
                ? "GPU encoding: no slowdown, the RTX 4070 does it alongside the upscale."
                : "CPU encoding: smaller files at the same quality, but slower."}
            </span>
          </div>
          <div className="fieldRow">
            <div className="field">
              <label>Quality</label>
              <Segmented
                value={options.quality}
                items={catalog.qualities.map((q) => ({ value: q, label: qualityLabels[q] ?? q }))}
                onChange={(quality) => set({ quality })}
              />
              <span className="fieldHint">{qualityHints[options.quality]}</span>
            </div>
            <div className="field">
              <label>Container</label>
              <Segmented
                value={options.container}
                items={[{ value: "mp4", label: "MP4" }, { value: "mkv", label: "MKV" }]}
                onChange={(container) => set({ container })}
              />
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={options.copyAudio} onChange={(e) => set({ copyAudio: e.target.checked })} />
            <span>Keep original audio</span>
          </label>
        </>
      )}
    </div>
  );
}
