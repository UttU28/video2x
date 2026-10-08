import type { JobOptions } from "./types";

export interface Preset {
  id: string;
  label: string;
  description: string;
  appliesTo: "video" | "image" | "both";
  options: Partial<JobOptions>;
}

const videoOnlyKeys: (keyof JobOptions)[] = ["codec", "quality", "container", "frameRateMul", "rifeModel"];
const imageOnlyKeys: (keyof JobOptions)[] = ["imageFormat"];

// Plain-language starting points; every value maps to a real option shown in the form below.
export const presets: Preset[] = [
  {
    id: "anime",
    label: "Anime & cartoons",
    description: "Fast with clean lines. A good everyday default for anything animated.",
    appliesTo: "both",
    options: { processor: "realesrgan", realesrganModel: "realesr-animevideov3", scale: 2, codec: "hevc_nvenc", quality: "balanced", imageFormat: "png" },
  },
  {
    id: "animeBest",
    label: "Best anime quality",
    description: "Cleanest result for anime, a bit slower. Good for favourites you'll keep.",
    appliesTo: "both",
    options: { processor: "realcugan", realcuganModel: "models-se", scale: 2, noise: -1, codec: "hevc_nvenc", quality: "high", imageFormat: "png" },
  },
  {
    id: "realLife",
    label: "Real-life video",
    description: "Phone or camera clips, movies, YouTube downloads. Big 4× sharpen, slower.",
    appliesTo: "video",
    options: { processor: "realesrgan", realesrganModel: "realesr-generalv3", scale: 4, denoise: false, codec: "hevc_nvenc", quality: "balanced" },
  },
  {
    id: "oldFootage",
    label: "Old or grainy footage",
    description: "Old home videos, low light, noisy clips. Removes grain while upscaling.",
    appliesTo: "video",
    options: { processor: "realesrgan", realesrganModel: "realesr-generalv3", scale: 4, denoise: true, codec: "hevc_nvenc", quality: "balanced" },
  },
  {
    id: "photo",
    label: "Photos",
    description: "Real-world pictures: people, places, products. Most detail, lossless output.",
    appliesTo: "image",
    options: { processor: "realesrgan", realesrganModel: "realesrgan-plus", scale: 4, imageFormat: "png" },
  },
  {
    id: "art",
    label: "Drawings & art",
    description: "Illustrations, anime stills, wallpapers, logos.",
    appliesTo: "image",
    options: { processor: "realesrgan", realesrganModel: "realesrgan-plus-anime", scale: 4, imageFormat: "png" },
  },
  {
    id: "smooth",
    label: "Smooth motion",
    description: "Doubles the frame rate (e.g. 24 → 48 fps) for smoother playback. Size stays the same.",
    appliesTo: "video",
    options: { processor: "rife", rifeModel: "rife-v4.26", frameRateMul: 2, codec: "hevc_nvenc", quality: "balanced" },
  },
  {
    id: "share",
    label: "Small file to share",
    description: "Plays on any phone, TV or chat app, at a small file size.",
    appliesTo: "both",
    options: { processor: "realesrgan", realesrganModel: "realesr-animevideov3", scale: 2, codec: "h264_nvenc", quality: "small", imageFormat: "jpg" },
  },
  {
    id: "preview",
    label: "Quick preview",
    description: "Fastest option, just to see roughly how an upscale will look.",
    appliesTo: "both",
    options: { processor: "libplacebo", libplaceboShader: "anime4k-v4-a", scale: 2, codec: "h264_nvenc", quality: "small", imageFormat: "jpg" },
  },
];

export function presetFits(preset: Preset, isImage: boolean | null): boolean {
  if (isImage === null) return true;
  return preset.appliesTo === "both" || preset.appliesTo === (isImage ? "image" : "video");
}

/** The preset whose (relevant) values all match the current options, if any. */
export function matchPreset(options: JobOptions, isImage: boolean | null): Preset | null {
  return (
    presets.find((preset) => {
      if (!presetFits(preset, isImage)) return false;
      return Object.entries(preset.options).every(([key, value]) => {
        const k = key as keyof JobOptions;
        if (isImage === true && videoOnlyKeys.includes(k)) return true;
        if (isImage === false && imageOnlyKeys.includes(k)) return true;
        return options[k] === value;
      });
    }) ?? null
  );
}
