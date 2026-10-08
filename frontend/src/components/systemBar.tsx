import { formatBytes } from "../format";
import type { SystemInfo } from "../types";
import { ChipIcon } from "./icons";

export default function SystemBar({ system }: { system: SystemInfo | null }) {
  const gpu = system?.gpus[0];
  const device = system?.vulkanDevices.find((d) => d.index === system.engine.device);
  const engineOk = system?.engine.available;

  return (
    <header className="topBar">
      <div className="brand">
        <img src="/favicon.svg" alt="" width={34} height={34} />
        <div>
          <h1>Video2X <span className="gradientText">Studio</span></h1>
          <span className="muted small">AI video &amp; image upscaling on GPU</span>
        </div>
      </div>

      <div className="statusChips">
        <div className={`chip ${engineOk ? "ok" : "bad"}`} title={system?.engine.version ? `video2x ${system.engine.version}` : "Engine status"}>
          <span className="dot" />
          {system == null ? "Connecting…" : engineOk ? `Engine ${system.engine.version ?? ""}` : "Engine offline"}
        </div>
        {(gpu || device) && (
          <div className="chip gpuChip" title={device ? `Vulkan device #${device.index}: ${device.name}` : undefined}>
            <ChipIcon width={15} height={15} />
            <span className="gpuName">{(gpu?.name ?? device?.name ?? "").replace("NVIDIA GeForce ", "")}</span>
            {gpu && (
              <span className="mono gpuStats">
                {gpu.utilization ?? 0}% · {((gpu.memoryUsedMb ?? 0) / 1024).toFixed(1)}/{((gpu.memoryTotalMb ?? 0) / 1024).toFixed(0)} GB
                {gpu.temperature != null ? ` · ${gpu.temperature}°C` : ""}
              </span>
            )}
          </div>
        )}
        {system && (
          <div className="chip" title="Free disk space for uploads and results">
            {formatBytes(system.disk.freeBytes)} free
          </div>
        )}
      </div>
    </header>
  );
}
