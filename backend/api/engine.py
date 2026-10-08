"""Wrapper around the video2x C++ CLI (backend/engine)."""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import config
from .catalog import JobOptions, codecs, qualityLevels

progressPattern = re.compile(
    r"frame=(\d+)/(\d+) \(([\d.]+)%\); fps=([\d.]+); elapsed=[\d:]+; remaining=(\d+):(\d+):(\d+)"
)
ansiPattern = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

cachedDevices: list[dict[str, Any]] | None = None


def engineEnv() -> dict[str, str]:
    env = dict(os.environ)
    libPath = str(config.video2xLibDir)
    env["LD_LIBRARY_PATH"] = libPath + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    return env


def engineAvailable() -> bool:
    return config.video2xBin.is_file() and os.access(config.video2xBin, os.X_OK)


async def runEngineQuick(*args: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        str(config.video2xBin), *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        stdin=asyncio.subprocess.DEVNULL, cwd=str(config.video2xDataDir), env=engineEnv(),
    )
    out, _ = await asyncio.wait_for(proc.communicate(), 30)
    return out.decode(errors="replace")


async def engineVersion() -> str | None:
    if not engineAvailable():
        return None
    out = await runEngineQuick("--version")
    match = re.search(r"version\s+(\S+)", out)
    return match.group(1) if match else out.strip() or None


async def listDevices() -> list[dict[str, Any]]:
    """Parse `video2x --list-devices` into [{index, name, type}]."""
    global cachedDevices
    if cachedDevices is not None:
        return cachedDevices
    if not engineAvailable():
        return []
    out = await runEngineQuick("--list-devices")
    devices: list[dict[str, Any]] = []
    for line in out.splitlines():
        header = re.match(r"^(\d+)\.\s+(.+)$", line)
        if header:
            devices.append({"index": int(header.group(1)), "name": header.group(2).strip(), "type": ""})
        elif devices and line.strip().startswith("Type:"):
            devices[-1]["type"] = line.split(":", 1)[1].strip()
    cachedDevices = devices
    return devices


async def pickDevice() -> int:
    if config.vulkanDevice:
        return int(config.vulkanDevice)
    devices = await listDevices()
    for device in devices:
        if device["type"] == "Discrete GPU":
            return device["index"]
    return devices[0]["index"] if devices else 0


def buildCommand(
    opts: JobOptions, inputPath: Path, outputPath: Path, inputMeta: dict[str, Any], isImage: bool, device: int
) -> list[str]:
    cmd = [
        str(config.video2xBin), "-i", str(inputPath), "-o", str(outputPath),
        "-p", opts.processor, "-d", str(device), "--log-level", "info",
    ]

    if opts.processor == "realesrgan":
        cmd += ["-s", str(opts.scale), "--realesrgan-model", opts.realesrganModel]
        if opts.realesrganModel == "realesr-generalv3" and opts.denoise:
            cmd += ["-n", "1"]
    elif opts.processor == "realcugan":
        cmd += ["-s", str(opts.scale), "-n", str(opts.noise), "--realcugan-model", opts.realcuganModel]
    elif opts.processor == "libplacebo":
        # libplacebo takes an absolute output size; keep it even for yuv420p encoders.
        width = (inputMeta["width"] * opts.scale) // 2 * 2
        height = (inputMeta["height"] * opts.scale) // 2 * 2
        cmd += ["-w", str(width), "-h", str(height), "--libplacebo-shader", opts.libplaceboShader]
    elif opts.processor == "rife":
        cmd += ["-m", str(opts.frameRateMul), "--rife-model", opts.rifeModel, "-t", str(opts.sceneThresh)]
        if opts.rifeUhd:
            cmd.append("--rife-uhd")

    if isImage:
        # Engine always writes lossless PNG; jobRunner converts to jpg/webp afterwards.
        cmd += ["-c", "png", "--pix-fmt", "rgb24", "--no-copy-audio-streams", "--no-copy-subtitle-streams"]
        return cmd

    cmd += ["-c", opts.codec, "--pix-fmt", "yuv420p"]
    crf, cq = qualityLevels[opts.quality]
    if codecs[opts.codec]["kind"] == "nvenc":
        cmd += ["-e", "rc=vbr", "-e", f"cq={cq}", "-e", "preset=p5"]
    else:
        cmd += ["-e", f"crf={crf}", "-e", "preset=medium"]
    if not opts.copyAudio or not inputMeta.get("audioCodec"):
        cmd.append("--no-copy-audio-streams")
    if outputPath.suffix == ".mp4":
        cmd.append("--no-copy-subtitle-streams")
    return cmd


async def runEngine(
    cmd: list[str], logPath: Path, onProgress: ProgressCallback, registerProcess: Callable[[asyncio.subprocess.Process], None]
) -> int:
    """Run video2x, stream log lines to logPath and progress updates to onProgress."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        stdin=asyncio.subprocess.DEVNULL, cwd=str(config.video2xDataDir), env=engineEnv(),
    )
    registerProcess(proc)
    assert proc.stdout is not None
    buffer = ""
    with logPath.open("a", encoding="utf-8") as log:
        log.write("$ " + " ".join(cmd) + "\n")
        while True:
            chunk = await proc.stdout.read(4096)
            if not chunk:
                break
            buffer += chunk.decode(errors="replace")
            parts = re.split(r"[\r\n]", buffer)
            buffer = parts.pop()
            for part in parts:
                line = ansiPattern.sub("", part).strip()
                if not line:
                    continue
                match = progressPattern.search(line)
                if match:
                    done, total, pct, fps, hh, mm, ss = match.groups()
                    await onProgress({
                        "framesDone": int(done),
                        "framesTotal": int(total),
                        "progress": min(float(pct), 100.0),
                        "fps": float(fps),
                        "etaSeconds": int(hh) * 3600 + int(mm) * 60 + int(ss),
                    })
                else:
                    log.write(line + "\n")
                    log.flush()
    return await proc.wait()
