"""ffprobe/ffmpeg helpers: metadata, thumbnails, comparison frames, image conversion."""

from __future__ import annotations

import asyncio
import json
from fractions import Fraction
from pathlib import Path
from typing import Any

imageExtensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
videoExtensions = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".flv", ".wmv", ".mpg", ".mpeg", ".ts", ".gif"}
# Audio codecs that can be stream-copied into an .mp4 container.
mp4AudioCodecs = {"aac", "mp3", "ac3", "eac3", "alac", "opus", "flac"}


async def runCommand(*args: str, timeout: float = 120) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return -1, "", "timeout"
    return proc.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace")


def parseRate(rate: str | None) -> float | None:
    try:
        value = float(Fraction(rate)) if rate else 0.0
    except (ValueError, ZeroDivisionError):
        return None
    return round(value, 3) if value > 0 else None


async def probeMedia(path: Path) -> dict[str, Any]:
    """Return a compact metadata dict, or raise ValueError when there is no video stream."""
    code, out, err = await runCommand(
        "ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)
    )
    if code != 0:
        # ffprobe's message includes the server-side path — keep it out of the API response.
        reason = err.strip().splitlines()[-1].replace(str(path), "").strip(" :") if err.strip() else ""
        raise ValueError(f"Not a readable video or image file ({reason[:120] or 'unknown format'})")
    data = json.loads(out or "{}")
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise ValueError("No video/image stream found in file")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = data.get("format", {})
    duration = fmt.get("duration") or video.get("duration")
    return {
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "codec": video.get("codec_name"),
        "fps": parseRate(video.get("avg_frame_rate")) or parseRate(video.get("r_frame_rate")),
        "duration": round(float(duration), 3) if duration not in (None, "N/A") else None,
        "frames": int(video["nb_frames"]) if str(video.get("nb_frames", "")).isdigit() else None,
        "audioCodec": audio.get("codec_name") if audio else None,
        "hasSubtitles": any(s.get("codec_type") == "subtitle" for s in streams),
        "size": path.stat().st_size,
        "format": fmt.get("format_name"),
    }


async def extractFrame(src: Path, dest: Path, atSeconds: float = 0, maxWidth: int | None = None) -> bool:
    """Grab one frame as JPEG (optionally downscaled) for thumbnails / before-after compare."""
    args = ["ffmpeg", "-y", "-v", "error"]
    if atSeconds > 0:
        args += ["-ss", f"{atSeconds:.3f}"]
    args += ["-i", str(src), "-frames:v", "1"]
    if maxWidth:
        args += ["-vf", f"scale='min({maxWidth},iw)':-2"]
    args += ["-q:v", "3", str(dest)]
    code, _, _ = await runCommand(*args)
    return code == 0 and dest.exists()


async def convertImage(src: Path, dest: Path) -> None:
    args = ["ffmpeg", "-y", "-v", "error", "-i", str(src)]
    if dest.suffix == ".jpg":
        args += ["-q:v", "2"]
    elif dest.suffix == ".webp":
        args += ["-quality", "92"]
    code, _, err = await runCommand(*args, str(dest))
    if code != 0:
        raise RuntimeError(f"Image conversion failed: {err.strip()[:300]}")


async def finalizeMp4(path: Path) -> None:
    """Stream-copy remux: moov atom up front (fast web playback) and the hvc1 tag
    Safari/iOS need for HEVC (the engine writes codec_tag 0 -> hev1)."""
    meta = await probeMedia(path)
    tmp = path.with_name(f"remux{path.suffix}")
    args = ["ffmpeg", "-y", "-v", "error", "-i", str(path), "-map", "0", "-c", "copy", "-movflags", "+faststart"]
    if meta.get("codec") == "hevc":
        args += ["-tag:v", "hvc1"]
    code, _, err = await runCommand(*args, str(tmp), timeout=600)
    if code != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Final remux failed: {err.strip()[:300]}")
    tmp.replace(path)


def isImageFile(name: str) -> bool:
    return Path(name).suffix.lower() in imageExtensions


def isSupportedFile(name: str) -> bool:
    suffix = Path(name).suffix.lower()
    return suffix in imageExtensions or suffix in videoExtensions
