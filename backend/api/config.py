"""Runtime configuration (env vars, overridable via backend/.env)."""

from __future__ import annotations

import os
from pathlib import Path

backendDir = Path(__file__).resolve().parent.parent


def loadDotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


loadDotenv(backendDir / ".env")

enginePrefix = Path(os.environ.get("VIDEO2X_PREFIX", backendDir / "engine" / "build" / "install"))
video2xBin = Path(os.environ.get("VIDEO2X_BIN", enginePrefix / "bin" / "video2x"))
# video2x resolves "models/..." relative to its working directory.
video2xDataDir = Path(os.environ.get("VIDEO2X_DATA_DIR", enginePrefix / "share" / "video2x"))
video2xLibDir = Path(os.environ.get("VIDEO2X_LIB_DIR", enginePrefix / "lib"))

storageDir = Path(os.environ.get("STORAGE_DIR", backendDir / "storage"))
jobsDir = storageDir / "jobs"
dbPath = storageDir / "jobs.db"

maxUploadMb = int(os.environ.get("MAX_UPLOAD_MB", "4096"))
# Empty = auto-pick the first discrete Vulkan GPU (the RTX 4070 on this host).
vulkanDevice = os.environ.get("VULKAN_DEVICE", "").strip()

storageDir.mkdir(parents=True, exist_ok=True)
jobsDir.mkdir(parents=True, exist_ok=True)
