"""Processor/model catalog exposed to the UI and used to validate job options."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# scale -> allowed noise levels, per Real-CUGAN model folder (see engine/models/realcugan)
realcuganModels: dict[str, dict[int, list[int]]] = {
    "models-se": {2: [-1, 0, 1, 2, 3], 3: [-1, 0, 3], 4: [-1, 0, 3]},
    "models-pro": {2: [-1, 0, 3], 3: [-1, 0, 3]},
    "models-nose": {2: [0]},
}

realesrganModels: dict[str, dict[str, Any]] = {
    "realesr-animevideov3": {"scales": [2, 3, 4], "label": "AnimeVideo v3 (fast, anime)"},
    "realesrgan-plus-anime": {"scales": [4], "label": "x4plus Anime (anime stills)"},
    "realesrgan-plus": {"scales": [4], "label": "x4plus (real-world photos/film)"},
    "realesr-generalv3": {"scales": [4], "label": "General v3 (real-world, fast)", "denoise": True},
}

libplaceboShaders = [
    "anime4k-v4-a", "anime4k-v4-a+a", "anime4k-v4-b", "anime4k-v4-b+b",
    "anime4k-v4-c", "anime4k-v4-c+a", "anime4k-v4.1-gan",
]

rifeModels = [
    "rife-v4.26", "rife-v4.25", "rife-v4.25-lite", "rife-v4.6", "rife-v4",
    "rife-v3.1", "rife-v3.0", "rife-v2.4", "rife-v2.3", "rife-v2",
    "rife-anime", "rife-UHD", "rife-HD", "rife",
]

# GPU (NVENC) first: encoding runs on the RTX 4070 alongside the Vulkan upscaler at no speed cost.
codecs: dict[str, dict[str, Any]] = {
    "hevc_nvenc": {"label": "H.265 / HEVC · GPU (NVENC) — recommended", "kind": "nvenc"},
    "h264_nvenc": {"label": "H.264 · GPU (NVENC) — plays everywhere", "kind": "nvenc"},
    "av1_nvenc": {"label": "AV1 · GPU (NVENC) — newest, efficient", "kind": "nvenc"},
    "libx265": {"label": "H.265 / HEVC · CPU (x265) — smallest files, slower", "kind": "crf"},
    "libx264": {"label": "H.264 · CPU (x264) — slower", "kind": "crf"},
}

# quality preset -> (crf for x264/x265, cq for nvenc)
qualityLevels = {"high": (16, 19), "balanced": (20, 24), "small": (26, 30)}

imageFormats = {"png": "PNG (lossless)", "jpg": "JPEG", "webp": "WebP"}

processors = {
    "realesrgan": {"label": "Real-ESRGAN", "mode": "upscale"},
    "realcugan": {"label": "Real-CUGAN", "mode": "upscale"},
    "libplacebo": {"label": "Anime4K (libplacebo)", "mode": "upscale"},
    "rife": {"label": "RIFE frame interpolation", "mode": "interpolate"},
}


class JobOptions(BaseModel):
    processor: str = "realesrgan"
    scale: int = Field(2, ge=1, le=4)
    noise: int = Field(-1, ge=-1, le=3)
    realesrganModel: str = "realesr-animevideov3"
    realcuganModel: str = "models-se"
    libplaceboShader: str = "anime4k-v4-a+a"
    rifeModel: str = "rife-v4.26"
    frameRateMul: int = Field(2, ge=2, le=8)
    sceneThresh: float = Field(10.0, ge=0, le=100)
    rifeUhd: bool = False
    denoise: bool = False
    codec: str = "hevc_nvenc"
    quality: str = "balanced"
    container: str = "mp4"
    imageFormat: str = "png"
    copyAudio: bool = True


def validateOptions(opts: JobOptions, isImage: bool) -> None:
    """Raise ValueError with a user-facing message when options are inconsistent."""
    if opts.processor not in processors:
        raise ValueError(f"Unknown processor '{opts.processor}'")
    if isImage and opts.processor == "rife":
        raise ValueError("Frame interpolation (RIFE) only works on videos")

    if opts.processor == "realesrgan":
        model = realesrganModels.get(opts.realesrganModel)
        if not model:
            raise ValueError(f"Unknown Real-ESRGAN model '{opts.realesrganModel}'")
        if opts.scale not in model["scales"]:
            raise ValueError(f"{opts.realesrganModel} supports scale {model['scales']}")
    elif opts.processor == "realcugan":
        scales = realcuganModels.get(opts.realcuganModel)
        if not scales:
            raise ValueError(f"Unknown Real-CUGAN model '{opts.realcuganModel}'")
        if opts.scale not in scales:
            raise ValueError(f"{opts.realcuganModel} supports scale {sorted(scales)}")
        if opts.noise not in scales[opts.scale]:
            raise ValueError(
                f"{opts.realcuganModel} {opts.scale}x supports noise levels {scales[opts.scale]}"
            )
    elif opts.processor == "libplacebo":
        if opts.libplaceboShader not in libplaceboShaders:
            raise ValueError(f"Unknown shader '{opts.libplaceboShader}'")
        if opts.scale < 2:
            raise ValueError("Scale must be at least 2")
    elif opts.processor == "rife":
        if opts.rifeModel not in rifeModels:
            raise ValueError(f"Unknown RIFE model '{opts.rifeModel}'")

    if isImage:
        if opts.imageFormat not in imageFormats:
            raise ValueError(f"Unknown image format '{opts.imageFormat}'")
    else:
        if opts.codec not in codecs:
            raise ValueError(f"Unknown codec '{opts.codec}'")
        if opts.quality not in qualityLevels:
            raise ValueError(f"Unknown quality '{opts.quality}'")
        if opts.container not in ("mp4", "mkv"):
            raise ValueError("Container must be mp4 or mkv")


def getCatalog() -> dict[str, Any]:
    return {
        "processors": processors,
        "realesrgan": realesrganModels,
        "realcugan": {k: {str(s): n for s, n in v.items()} for k, v in realcuganModels.items()},
        "libplacebo": libplaceboShaders,
        "rife": rifeModels,
        "codecs": codecs,
        "qualities": list(qualityLevels),
        "imageFormats": imageFormats,
        "defaults": JobOptions().model_dump(),
    }
