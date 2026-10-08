"""Single-GPU job queue: runs one video2x job at a time in the background."""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import Any

from . import engine, jobStore, mediaTools
from .catalog import JobOptions

logger = logging.getLogger("video2x.runner")

wakeEvent = asyncio.Event()
runningProcesses: dict[str, asyncio.subprocess.Process] = {}
cancelRequested: set[str] = set()
currentJobId: str | None = None


def notifyNewJob() -> None:
    wakeEvent.set()


async def cancelJob(jobId: str) -> None:
    job = jobStore.getJob(jobId)
    if not job:
        return
    if job["status"] == "queued":
        jobStore.updateJob(jobId, status="cancelled", finishedAt=time.time())
        return
    if job["status"] == "processing":
        cancelRequested.add(jobId)
        proc = runningProcesses.get(jobId)
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 10)
            except asyncio.TimeoutError:
                proc.kill()


def outputPaths(job: dict[str, Any], opts: JobOptions) -> tuple[Path, Path, str]:
    """(engine output, final output, download filename)."""
    folder = jobStore.jobDir(job["id"])
    stem = Path(job["originalName"]).stem[:80] or "output"
    if opts.processor == "rife":
        tag = f"{opts.frameRateMul}xfps"
    else:
        tag = f"{opts.processor}-{opts.scale}x"
    if job["kind"] == "image":
        final = folder / f"output.{opts.imageFormat}"
        return folder / "output.png", final, f"{stem}_{tag}.{opts.imageFormat}"

    container = opts.container
    audioCodec = (job["inputMeta"] or {}).get("audioCodec")
    if container == "mp4" and opts.copyAudio and audioCodec and audioCodec not in mediaTools.mp4AudioCodecs:
        container = "mkv"  # audio can't be stream-copied into mp4
    final = folder / f"output.{container}"
    return final, final, f"{stem}_{tag}.{container}"


async def processJob(job: dict[str, Any]) -> None:
    global currentJobId
    jobId = job["id"]
    currentJobId = jobId
    folder = jobStore.jobDir(jobId)
    opts = JobOptions(**job["options"])
    inputPath = folder / job["inputFile"]
    logPath = folder / "job.log"
    isImage = job["kind"] == "image"
    enginePath, finalPath, downloadName = outputPaths(job, opts)
    device = await engine.pickDevice()

    jobStore.updateJob(
        jobId, status="processing", startedAt=time.time(), progress=0, framesDone=0,
        error=None, device=device, outputFile=None,
    )
    lastWrite = 0.0

    async def onProgress(update: dict[str, Any]) -> None:
        nonlocal lastWrite
        now = time.monotonic()
        if now - lastWrite >= 0.5:
            lastWrite = now
            jobStore.updateJob(jobId, **update)

    def registerProcess(proc: asyncio.subprocess.Process) -> None:
        runningProcesses[jobId] = proc

    try:
        cmd = engine.buildCommand(opts, inputPath, enginePath, job["inputMeta"], isImage, device)
        returnCode = await engine.runEngine(cmd, logPath, onProgress, registerProcess)
        runningProcesses.pop(jobId, None)

        if jobId in cancelRequested:
            cancelRequested.discard(jobId)
            enginePath.unlink(missing_ok=True)
            jobStore.updateJob(jobId, status="cancelled", finishedAt=time.time(), etaSeconds=None)
            return
        if returnCode != 0 or not enginePath.exists() or enginePath.stat().st_size == 0:
            raise RuntimeError(f"video2x exited with code {returnCode}: {tailLog(logPath)}")

        if isImage and finalPath != enginePath:
            await mediaTools.convertImage(enginePath, finalPath)
            enginePath.unlink(missing_ok=True)
        elif finalPath.suffix == ".mp4":
            await mediaTools.finalizeMp4(finalPath)

        outputMeta = await mediaTools.probeMedia(finalPath)
        await makeCompareFrames(job, finalPath, isImage)
        jobStore.updateJob(
            jobId, status="completed", finishedAt=time.time(), progress=100, etaSeconds=0,
            outputFile=finalPath.name, downloadName=downloadName, outputMeta=outputMeta,
        )
        logger.info("Job %s completed -> %s", jobId, finalPath)
    except Exception as exc:  # noqa: BLE001 - surface any failure on the job
        logger.exception("Job %s failed", jobId)
        runningProcesses.pop(jobId, None)
        jobStore.updateJob(jobId, status="failed", finishedAt=time.time(), error=str(exc)[:2000], etaSeconds=None)
    finally:
        currentJobId = None


async def makeCompareFrames(job: dict[str, Any], outputPath: Path, isImage: bool) -> None:
    """Same-timestamp frames from input and output for the before/after slider."""
    folder = jobStore.jobDir(job["id"])
    if isImage:
        return  # the UI compares the full images directly
    duration = (job["inputMeta"] or {}).get("duration") or 0
    at = min(duration * 0.3, max(duration - 0.5, 0)) if duration else 0
    await mediaTools.extractFrame(folder / job["inputFile"], folder / "compareInput.jpg", at)
    await mediaTools.extractFrame(outputPath, folder / "compareOutput.jpg", at)
    await mediaTools.extractFrame(outputPath, folder / "thumbOutput.jpg", at, maxWidth=640)


def tailLog(logPath: Path, lines: int = 6) -> str:
    if not logPath.exists():
        return ""
    content = [l for l in logPath.read_text(errors="replace").splitlines() if not l.startswith("$ ")]
    errors = [l for l in content if "[error]" in l or "[critical]" in l]
    return " | ".join((errors or content)[-lines:])


async def workerLoop() -> None:
    requeued = jobStore.requeueInterrupted()
    if requeued:
        logger.info("Re-queued %d interrupted job(s)", requeued)
    while True:
        job = jobStore.nextQueuedJob()
        if job is None:
            wakeEvent.clear()
            try:
                await asyncio.wait_for(wakeEvent.wait(), 5)
            except asyncio.TimeoutError:
                pass
            continue
        await processJob(job)


def removeJobFiles(jobId: str) -> None:
    shutil.rmtree(jobStore.jobDir(jobId), ignore_errors=True)
