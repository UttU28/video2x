import { useRef, useState } from "react";

interface Props {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/** Drag/hover before-after comparison; both images render at the same box size. */
export default function CompareSlider({ before, after, beforeLabel = "Original", afterLabel = "Upscaled" }: Props) {
  const [position, setPosition] = useState(50);
  const boxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const moveTo = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      ref={boxRef}
      className="compare"
      onPointerDown={(e) => { draggingRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); moveTo(e.clientX); }}
      onPointerMove={(e) => draggingRef.current && moveTo(e.clientX)}
      onPointerUp={() => { draggingRef.current = false; }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPosition((p) => Math.max(0, p - 5));
        if (e.key === "ArrowRight") setPosition((p) => Math.min(100, p + 5));
      }}
      tabIndex={0}
      role="slider"
      aria-valuenow={Math.round(position)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Before/after comparison"
    >
      <img src={after} alt={afterLabel} draggable={false} />
      <img src={before} alt={beforeLabel} draggable={false} className="beforeLayer" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />
      <div className="compareHandle" style={{ left: `${position}%` }}><span /></div>
      <span className="compareTag left">{beforeLabel}</span>
      <span className="compareTag right">{afterLabel}</span>
    </div>
  );
}
