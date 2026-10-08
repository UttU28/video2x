"""SQLite-backed job records (backend/storage/jobs.db)."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from . import config

jsonColumns = ("options", "inputMeta", "outputMeta")

schema = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,              -- video | image
    status TEXT NOT NULL,            -- queued | processing | completed | failed | cancelled
    originalName TEXT NOT NULL,
    inputFile TEXT NOT NULL,
    outputFile TEXT,
    downloadName TEXT,
    options TEXT NOT NULL,
    inputMeta TEXT,
    outputMeta TEXT,
    progress REAL DEFAULT 0,
    framesDone INTEGER DEFAULT 0,
    framesTotal INTEGER DEFAULT 0,
    fps REAL DEFAULT 0,
    etaSeconds INTEGER,
    device INTEGER,
    error TEXT,
    createdAt REAL NOT NULL,
    startedAt REAL,
    finishedAt REAL
)
"""

lock = threading.Lock()
conn = sqlite3.connect(config.dbPath, check_same_thread=False, isolation_level=None)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode=WAL")
conn.execute(schema)


def rowToJob(row: sqlite3.Row) -> dict[str, Any]:
    job = dict(row)
    for col in jsonColumns:
        job[col] = json.loads(job[col]) if job[col] else None
    return job


def jobDir(jobId: str) -> Path:
    return config.jobsDir / jobId


def createJob(job: dict[str, Any]) -> None:
    data = {**job, "createdAt": time.time()}
    for col in jsonColumns:
        if col in data and data[col] is not None:
            data[col] = json.dumps(data[col])
    cols = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    with lock:
        conn.execute(f"INSERT INTO jobs ({cols}) VALUES ({marks})", list(data.values()))


def updateJob(jobId: str, **fields: Any) -> None:
    for col in jsonColumns:
        if col in fields and fields[col] is not None:
            fields[col] = json.dumps(fields[col])
    sets = ", ".join(f"{k} = ?" for k in fields)
    with lock:
        conn.execute(f"UPDATE jobs SET {sets} WHERE id = ?", [*fields.values(), jobId])


def getJob(jobId: str) -> dict[str, Any] | None:
    with lock:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (jobId,)).fetchone()
    return rowToJob(row) if row else None


def listJobs() -> list[dict[str, Any]]:
    with lock:
        rows = conn.execute("SELECT * FROM jobs ORDER BY createdAt DESC").fetchall()
    return [rowToJob(r) for r in rows]


def nextQueuedJob() -> dict[str, Any] | None:
    with lock:
        row = conn.execute(
            "SELECT * FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1"
        ).fetchone()
    return rowToJob(row) if row else None


def queuePosition(jobId: str) -> int | None:
    with lock:
        rows = conn.execute(
            "SELECT id FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC"
        ).fetchall()
    ids = [r["id"] for r in rows]
    return ids.index(jobId) + 1 if jobId in ids else None


def deleteJob(jobId: str) -> None:
    with lock:
        conn.execute("DELETE FROM jobs WHERE id = ?", (jobId,))


def requeueInterrupted() -> int:
    """Jobs left 'processing' by a crash/restart go back to the queue."""
    with lock:
        cur = conn.execute(
            "UPDATE jobs SET status = 'queued', progress = 0, framesDone = 0, startedAt = NULL "
            "WHERE status = 'processing'"
        )
    return cur.rowcount


def countByStatus() -> dict[str, int]:
    with lock:
        rows = conn.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").fetchall()
    return {r["status"]: r["n"] for r in rows}
