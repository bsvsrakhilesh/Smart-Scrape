import { useEffect, useRef } from "react";

export default function ParticleField({ aqi = 70 }: { aqi?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number | null>(null);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; r: number; o: number }[]>([]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let w = (canvas.width = canvas.offsetWidth);
    let h = (canvas.height = canvas.offsetHeight);

    const onResize = () => { w = canvas.width = canvas.offsetWidth; h = canvas.height = canvas.offsetHeight; };
    const mobile = matchMedia("(pointer: coarse)").matches;
    window.addEventListener("resize", onResize);

    const base = mobile ? 40 : 90;
    const count = Math.min(base + Math.floor((aqi / 300) * base), mobile ? 80 : 160);
    particlesRef.current = Array.from({ length: count }, () => {
      const r = 0.6 + Math.random() * 1.8 + (aqi / 500) * 1.2;
      return { x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12, r, o: 0.05 + Math.random() * 0.15 + (aqi / 500) * 0.05 };
    });

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "rgba(99,102,241,0.08)");
      g.addColorStop(1, "rgba(147,51,234,0.08)");
      for (const p of particlesRef.current) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
        ctx.beginPath(); ctx.fillStyle = g; (ctx as any).globalAlpha = p.o; ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      (ctx as any).globalAlpha = 1; raf.current = requestAnimationFrame(tick);
    };

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) tick();
    return () => { cancelAnimationFrame(raf.current!); window.removeEventListener("resize", onResize); };
  }, [aqi]);

  return <div className="pointer-events-none absolute inset-0"><canvas ref={ref} className="h-full w-full" /></div>;
}
