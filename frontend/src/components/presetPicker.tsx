import { matchPreset, presetFits, presets } from "../presets";
import type { Catalog, JobOptions } from "../types";

interface Props {
  catalog: Catalog;
  options: JobOptions;
  isImage: boolean | null; // null = no file chosen yet
  onApply: (patch: Partial<JobOptions>) => void;
  showDetails: boolean; // "Uses: …" breakdown, only with advanced settings open
}

const engineNames: Record<string, string> = {
  realesrgan: "Real-ESRGAN",
  realcugan: "Real-CUGAN",
  libplacebo: "Anime4K",
  rife: "Interpolate frames (RIFE)",
};
const noiseNames: Record<number, string> = { [-1]: "Conservative", 0: "None", 1: "Light", 2: "Medium", 3: "Strong" };
const qualityNames: Record<string, string> = { high: "High", balanced: "Balanced", small: "Small file" };

/** "Uses: Engine … · Model … · Scale …" in the exact names the settings form shows. */
function describeSettings(catalog: Catalog, o: JobOptions, isImage: boolean | null): [string, string][] {
  const parts: [string, string][] = [["Engine", engineNames[o.processor] ?? o.processor]];
  if (o.processor === "realesrgan") {
    parts.push(["Model", catalog.realesrgan[o.realesrganModel]?.label.split(" (")[0] ?? o.realesrganModel]);
    if (o.realesrganModel === "realesr-generalv3") parts.push(["Denoise", o.denoise ? "On" : "Off"]);
  } else if (o.processor === "realcugan") {
    parts.push(["Model", o.realcuganModel.replace("models-", "").toUpperCase()], ["Denoise", noiseNames[o.noise] ?? String(o.noise)]);
  } else if (o.processor === "libplacebo") {
    parts.push(["Model", o.libplaceboShader]);
  } else {
    parts.push(["Model", o.rifeModel], ["Frame rate", `${o.frameRateMul}×`]);
  }
  if (o.processor !== "rife") parts.push(["Scale", `${o.scale}×`]);
  if (isImage) {
    parts.push(["Output format", o.imageFormat.toUpperCase()]);
  } else {
    parts.push(["Encoder", (catalog.codecs[o.codec]?.label ?? o.codec).split(" — ")[0]], ["Quality", qualityNames[o.quality] ?? o.quality]);
  }
  return parts;
}

export default function PresetPicker({ catalog, options, isImage, onApply, showDetails }: Props) {
  const active = matchPreset(options, isImage);

  return (
    <div className="presetPicker">
      <div className="presetHeader">
        <label>What are you upscaling?</label>
        {!active && <span className="customTag">Custom</span>}
      </div>
      <div className="presetTags" role="radiogroup">
        {presets.map((preset) => {
          const fits = presetFits(preset, isImage);
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active?.id === preset.id}
              className={`presetTag ${active?.id === preset.id ? "active" : ""}`}
              disabled={!fits}
              title={fits ? preset.description : `Only for ${preset.appliesTo === "image" ? "images" : "videos"}`}
              onClick={() => onApply(preset.options)}
            >
              {preset.label}
              {isImage === null && preset.appliesTo !== "both" && (
                <span className="presetKind">{preset.appliesTo}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="presetExplain">
        <p>{active ? active.description : "Your own mix of settings (see Advanced settings). Pick a tag above to go back to a preset."}</p>
        {showDetails && <p className="presetUses">
          <span className="usesLabel">Uses:</span>
          {describeSettings(catalog, options, isImage).map(([name, value]) => (
            <span key={name} className="usesItem"><span className="muted">{name}</span> {value}</span>
          ))}
        </p>}
      </div>
    </div>
  );
}
