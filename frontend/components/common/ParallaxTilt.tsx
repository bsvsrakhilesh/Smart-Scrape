import React, { useRef, useCallback } from "react";

export default function ParallaxTilt({
  children,
  maxTilt = 8,
  className = "",
}: {
  children: React.ReactNode;
  maxTilt?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;  // 0..1
    const py = (e.clientY - r.top) / r.height; // 0..1
    const rx = (py - 0.5) * 2 * maxTilt;       // -max..max
    const ry = (0.5 - px) * 2 * maxTilt;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
  }, [maxTilt]);

  const reset = useCallback(() => {
    const el = ref.current; if (!el) return;
    el.style.transform = `perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)`;
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-transform duration-300 will-change-transform ${className}`}
      onMouseMove={onMove}
      onMouseLeave={reset}
    >
      {children}
    </div>
  );
}
