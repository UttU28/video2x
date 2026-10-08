"""Video2X web API — upload, queue, GPU upscale/interpolate, preview and download.

Run (from backend/):  venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 9281
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import ValidationError

from . import config, engine, jobRunner, jobStore, mediaTools, systemStats
from .catalog import JobOptions, getCatalog, validateOptions

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("video2x.api")

compareFiles = {
    "thumbInput": "thumbInput.jpg",
    "thumbOutput": "thumbOutput.jpg",
    "compareInput": "compareInput.jpg",
    "compareOutput": "compareOutput.jpg",
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    workerTask = asyncio.create_task(jobRunner.workerLoop())
    if engine.engineAvailable():
        devices = await engine.listDevices()
        logger.info("video2x engine ready, Vulkan devices: %s", devices)
    else:
        logger.warning("video2x engine not found at %s — run backend/buildEngine.sh", config.video2xBin)
    yield
    workerTask.cancel()


app = FastAPI(title="Video2X Web", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://video.thatinsaneguy.com", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def publicJob(job: dict[str, Any]) -> dict[str, Any]:
    jobId = job["id"]
    folder = jobStore.jobDir(jobId)
    base = f"/api/jobs/{jobId}"
    urls: dict[str, str | None] = {
        "input": f"{base}/input",
        "output": f"{base}/output" if job.get("outputFile") else None,
        "download": f"{base}/output?download=1" if job.get("outputFile") else None,
    }
    for key, name in compareFiles.items():
        urls[key] = f"{base}/frames/{key}" if (folder / name).exists() else None
    return {
        **{k: v for k, v in job.items() if k not in ("inputFile", "outputFile")},
        "queuePosition": jobStore.queuePosition(jobId) if job["status"] == "queued" else None,
        "urls": urls,
    }


def requireJob(jobId: str) -> dict[str, Any]:
    job = jobStore.getJob(jobId)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "engine": engine.engineAvailable()}


@app.get("/api/catalog")
async def catalogRoute() -> dict[str, Any]:
    return {**getCatalog(), "maxUploadMb": config.maxUploadMb}


@app.get("/api/system")
async def systemRoute() -> dict[str, Any]:
    gpus, devices, version = await asyncio.gather(
        systemStats.gpuStats(), engine.listDevices(), engine.engineVersion()
    )
    return {
        "engine": {"available": engine.engineAvailable(), "version": version, "device": await engine.pickDevice()},
        "vulkanDevices": devices,
        "gpus": gpus,
        "disk": systemStats.diskStats(),
        "queue": jobStore.countByStatus(),
        "currentJobId": jobRunner.currentJobId,
    }


@app.post("/api/jobs", status_code=201)
async def createJob(
    request: Request,
    fileName: str = Query(..., min_length=1, max_length=255),
    options: str = Query("{}"),
) -> dict[str, Any]:
    """Raw-body upload (file bytes as the request body) — streamed straight to disk."""
    if not engine.engineAvailable():
        raise HTTPException(503, "Upscaling engine is not built on the server")
    originalName = Path(unquote(fileName)).name
    if not mediaTools.isSupportedFile(originalName):
        raise HTTPException(415, "Unsupported file type. Upload a video (mp4, mkv, mov, webm…) or image (png, jpg, webp…)")
    isImage = mediaTools.isImageFile(originalName)
    try:
        opts = JobOptions(**json.loads(options))
        validateOptions(opts, isImage)
    except (ValidationError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(422, str(exc)) from exc

    declared = int(request.headers.get("content-length") or 0)
    maxBytes = config.maxUploadMb * 1024 * 1024
    if declared > maxBytes:
        raise HTTPException(413, f"File too large (max {config.maxUploadMb} MB)")

    jobId = uuid.uuid4().hex[:12]
    folder = jobStore.jobDir(jobId)
    folder.mkdir(parents=True)
    inputPath = folder / f"input{Path(originalName).suffix.lower()}"
    written = 0
    try:
        with inputPath.open("wb") as fh:
            async for chunk in request.stream():
                written += len(chunk)
                if written > maxBytes:
                    raise HTTPException(413, f"File too large (max {config.maxUploadMb} MB)")
                fh.write(chunk)
        if written == 0:
            raise HTTPException(400, "Empty upload")
        try:
            inputMeta = await mediaTools.probeMedia(inputPath)
        except ValueError as exc:
            raise HTTPException(415, str(exc)) from exc
        await mediaTools.extractFrame(
            inputPath, folder / "thumbInput.jpg",
            0 if isImage else min((inputMeta.get("duration") or 0) * 0.3, 30), maxWidth=640,
        )
    except BaseException:
        jobRunner.removeJobFiles(jobId)
        raise

    jobStore.createJob({
        "id": jobId,
        "kind": "image" if isImage else "video",
        "status": "queued",
        "originalName": originalName,
        "inputFile": inputPath.name,
        "options": opts.model_dump(),
        "inputMeta": inputMeta,
    })
    jobRunner.notifyNewJob()
    logger.info("Job %s queued: %s (%s, %d bytes)", jobId, originalName, "image" if isImage else "video", written)
    return publicJob(jobStore.getJob(jobId))


@app.get("/api/jobs")
async def listJobsRoute() -> list[dict[str, Any]]:
    return [publicJob(j) for j in jobStore.listJobs()]


@app.get("/api/jobs/{jobId}")
async def getJobRoute(jobId: str) -> dict[str, Any]:
    return publicJob(requireJob(jobId))


@app.get("/api/jobs/{jobId}/log")
async def getJobLog(jobId: str) -> dict[str, str]:
    requireJob(jobId)
    logPath = jobStore.jobDir(jobId) / "job.log"
    text = logPath.read_text(errors="replace") if logPath.exists() else ""
    return {"log": text[-20000:]}


@app.post("/api/jobs/{jobId}/cancel")
async def cancelJobRoute(jobId: str) -> dict[str, Any]:
    job = requireJob(jobId)
    if job["status"] not in ("queued", "processing"):
        raise HTTPException(409, f"Job is already {job['status']}")
    await jobRunner.cancelJob(jobId)
    return publicJob(requireJob(jobId))


@app.post("/api/jobs/{jobId}/retry")
async def retryJobRoute(jobId: str) -> dict[str, Any]:
    job = requireJob(jobId)
    if job["status"] not in ("failed", "cancelled"):
        raise HTTPException(409, "Only failed or cancelled jobs can be retried")
    (jobStore.jobDir(jobId) / "job.log").unlink(missing_ok=True)
    jobStore.updateJob(
        jobId, status="queued", progress=0, framesDone=0, framesTotal=0, fps=0,
        etaSeconds=None, error=None, startedAt=None, finishedAt=None, createdAt=time.time(),
    )
    jobRunner.notifyNewJob()
    return publicJob(requireJob(jobId))


@app.delete("/api/jobs/{jobId}", status_code=204)
async def deleteJobRoute(jobId: str) -> None:
    job = requireJob(jobId)
    if job["status"] in ("queued", "processing"):
        await jobRunner.cancelJob(jobId)
        for _ in range(50):  # let the worker release the files
            if jobRunner.currentJobId != jobId:
                break
            await asyncio.sleep(0.2)
    jobStore.deleteJob(jobId)
    jobRunner.removeJobFiles(jobId)


@app.get("/api/jobs/{jobId}/input")
async def getInput(jobId: str) -> FileResponse:
    job = requireJob(jobId)
    return FileResponse(jobStore.jobDir(jobId) / job["inputFile"], filename=job["originalName"],
                        content_disposition_type="inline")


@app.get("/api/jobs/{jobId}/output")
async def getOutput(jobId: str, download: bool = False) -> FileResponse:
    job = requireJob(jobId)
    if not job.get("outputFile"):
        raise HTTPException(404, "Output not ready")
    path = jobStore.jobDir(jobId) / job["outputFile"]
    if not path.exists():
        raise HTTPException(404, "Output file missing")
    return FileResponse(path, filename=job["downloadName"],
                        content_disposition_type="attachment" if download else "inline")


@app.get("/api/jobs/{jobId}/frames/{kind}")
async def getFrame(jobId: str, kind: str) -> FileResponse:
    requireJob(jobId)
    name = compareFiles.get(kind)
    path = jobStore.jobDir(jobId) / name if name else None
    if not path or not path.exists():
        raise HTTPException(404, "Frame not available")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})
