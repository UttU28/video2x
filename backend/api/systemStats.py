"""GPU / disk stats for the UI status bar."""

from __future__ import annotations

import shutil
from typing import Any

from . import config
from .mediaTools import runCommand


async def gpuStats() -> list[dict[str, Any]]:
    if not shutil.which("nvidia-smi"):
        return []
    code, out, _ = await runCommand(
        "nvidia-smi",
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
        timeout=10,
    )
    if code != 0:
        return []
    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue

        def num(value: str) -> float | None:
            try:
                return float(value)
            except ValueError:
                return None

        gpus.append({
            "name": parts[0],
            "utilization": num(parts[1]),
            "memoryUsedMb": num(parts[2]),
            "memoryTotalMb": num(parts[3]),
            "temperature": num(parts[4]),
            "powerWatts": num(parts[5]),
        })
    return gpus


def diskStats() -> dict[str, int]:
    usage = shutil.disk_usage(config.storageDir)
    used = sum(f.stat().st_size for f in config.jobsDir.rglob("*") if f.is_file())
    return {"freeBytes": usage.free, "totalBytes": usage.total, "storageUsedBytes": used}
