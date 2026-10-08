/**
 * PM2: Video2X web API (uvicorn) on 127.0.0.1 — nginx terminates TLS for video.thatinsaneguy.com.
 * Port must match the nginx upstream in ../nginxVideo.conf (default 9281, see ~/Desktop/PORTS.md).
 * Started by ../deploy.sh.
 */
const path = require("path");

const backendDir = __dirname;
const port = process.env.VIDEO2X_API_PORT || "9281";

module.exports = {
  apps: [
    {
      name: "video2x",
      cwd: backendDir,
      script: path.join(backendDir, "venv/bin/python"),
      args: ["-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", String(port), "--proxy-headers"],
      instances: 1, // one process: the job queue serialises GPU work
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      kill_timeout: 15000, // let a running video2x job get terminated cleanly
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
