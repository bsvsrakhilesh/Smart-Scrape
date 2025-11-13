// src/pages/LandingPage.tsx
"use client";

import React, { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  motion,
  useScroll,
  useTransform,
  type MotionProps,
  type Transition,
} from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Play,
} from "lucide-react";
import { CircularTestimonials } from "../components/ui/circular-testimonials";

/* ========= Motion presets ========= */
const EASE: Transition["ease"] = [0.16, 1, 0.3, 1];
const fadeUp = (delay = 0): MotionProps => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
  viewport: { once: true, amount: 0.45 },
});
const staggerContainer = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

/* ========= Small UI utils ========= */
const MagneticButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement>
> = ({ className = "", children, ...rest }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left - r.width / 2;
    const my = e.clientY - r.top - r.height / 2;
    el.style.setProperty("--tx", `${mx * 0.12}px`);
    el.style.setProperty("--ty", `${my * 0.12}px`);
  }, []);
  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tx", "0px");
    el.style.setProperty("--ty", "0px");
  }, []);
  return (
    <button
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`magnetic ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

/* ========= Air-quality primitives ========= */
function ParticleField({ aqi = 70 }: { aqi?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number|null>(null);
  const particlesRef = useRef<
    { x: number; y: number; vx: number; vy: number; r: number; o: number }[]
  >([]);

  React.useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let w = (canvas.width = canvas.offsetWidth);
    let h = (canvas.height = canvas.offsetHeight);

    const onResize = () => {
      w = (canvas.width = canvas.offsetWidth);
      h = (canvas.height = canvas.offsetHeight);
    };
    const mobile = matchMedia("(pointer: coarse)").matches;
    window.addEventListener("resize", onResize);

    const base = mobile ? 40 : 90;
    const count = Math.min(
      base + Math.floor((aqi / 300) * base),
      mobile ? 80 : 160
    );
    particlesRef.current = Array.from({ length: count }, () => {
      const r = 0.6 + Math.random() * 1.8 + (aqi / 500) * 1.2;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r,
        o: 0.05 + Math.random() * 0.15 + (aqi / 500) * 0.05,
      };
    });

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "rgba(99,102,241,0.08)");
      g.addColorStop(1, "rgba(147,51,234,0.08)");
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
        ctx.beginPath();
        ctx.fillStyle = g;
        (ctx as any).globalAlpha = p.o;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      (ctx as any).globalAlpha = 1;
      raf.current = requestAnimationFrame(tick);
    };

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) tick();
    return () => {
      cancelAnimationFrame(raf.current!);
      window.removeEventListener("resize", onResize);
    };
  }, [aqi]);

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

function AqiGauge({ aqi = 118 }: { aqi?: number }) {
  const bands = [
    { upTo: 50, color: "#22c55e", label: "Good" },
    { upTo: 100, color: "#84cc16", label: "Satisfactory" },
    { upTo: 200, color: "#f59e0b", label: "Moderate" },
    { upTo: 300, color: "#ef4444", label: "Poor" },
    { upTo: 400, color: "#a855f7", label: "Very Poor" },
    { upTo: 500, color: "#6b21a8", label: "Severe" },
  ];
  const color = bands.find((b) => aqi <= b.upTo)?.color ?? "#6b21a8";
  const label = bands.find((b) => aqi <= b.upTo)?.label ?? "Severe";
  const angle = Math.min(180, Math.max(0, (aqi / 500) * 180));
  return (
    <div className="flex items-center gap-4">
      <svg width="160" height="100" viewBox="0 0 160 100" className="overflow-visible">
        <path d="M10 90 A70 70 0 0 1 150 90" fill="none" stroke="rgba(2,6,23,0.08)" strokeWidth="14" />
        <motion.path
          d="M10 90 A70 70 0 0 1 150 90"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          style={{ pathLength: aqi / 500 }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: aqi / 500 }}
          transition={{ duration: 1, ease: EASE }}
        />
        <circle cx="80" cy="90" r="3" fill="#0f172a" />
        <motion.line
          x1="80"
          y1="90"
          x2="80"
          y2="24"
          stroke="#0f172a"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ originX: 80, originY: 90 }}
          initial={{ rotate: 0 }}
          animate={{ rotate: angle }}
          transition={{ duration: 1, ease: EASE }}
        />
      </svg>
      <div>
        <div className="text-3xl font-bold leading-none">{aqi}</div>
        <div className="text-sm text-slate-600">{label}</div>
      </div>
    </div>
  );
}

function WindFlow({ className = "" }: { className?: string }) {
  const id = React.useId();
  return (
    <svg className={className} viewBox="0 0 600 200" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(99,102,241,0.25)" />
          <stop offset="100%" stopColor="rgba(147,51,234,0.25)" />
        </linearGradient>
      </defs>
      {[0, 40, 80, 120, 160].map((y, i) => (
        <motion.path
          key={y}
          d={`M -50 ${y + 30} C 150 ${y - 20}, 300 ${y + 80}, 650 ${y + 20}`}
          fill="none"
          stroke={`url(#${id}-g)`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="14 10"
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -48 }}
          transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </svg>
  );
}

function Co2Wave({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 80" className={className} aria-hidden>
      <defs>
        <linearGradient id="co2g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(99,102,241,0.6)" />
          <stop offset="100%" stopColor="rgba(147,51,234,0.6)" />
        </linearGradient>
      </defs>
      <motion.path
        d="M 0 40 C 60 10, 120 70, 180 40 S 300 10, 360 40  480 70, 540 40  600 10, 660 40"
        fill="none"
        stroke="url(#co2g)"
        strokeWidth="3"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: EASE }}
      />
    </svg>
  );
}

/* ========= HERO ========= */
function Hero({ currentAqi = 118 }: { currentAqi?: number }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const blur = useTransform(scrollYProgress, [0, 1], ["blur(40px)", "blur(80px)"]);
  const onMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <section ref={ref} className="relative overflow-hidden spotlight">
      <div className="bg-landing-gradient breathe" onMouseMove={onMouseMove}>
        <div className="relative">
          <motion.div
            style={{ y, filter: blur }}
            className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl"
          />
          <ParticleField aqi={currentAqi} />
          <div className="relative z-10 mx-auto max-w-7xl px-6 py-24 md:py-32">
            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="text-center"
            >
              <motion.span
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm text-white/90 ring-1 ring-white/20"
                {...fadeUp(0)}
              >
                <Sparkles className="h-4 w-4" />
                Built for clean data decisions
              </motion.span>

              <motion.h1
                className="mt-5 text-4xl font-extrabold tracking-tight text-white md:text-6xl"
                {...fadeUp(0.1)}
              >
                Clean Air. Clear Insights.
              </motion.h1>

              <motion.p
                className="mx-auto mt-5 max-w-2xl text-white/85 md:text-lg"
                {...fadeUp(0.2)}
              >
                From raw archives to policy-ready briefs—collect, analyze, chat with, and publish your evidence in one place.
              </motion.p>

              <motion.div
                className="mt-8 flex items-center justify-center gap-3"
                {...fadeUp(0.3)}
              >
                <MagneticButton
                  onClick={() => navigate("/signup")}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Get Started <ArrowRight className="h-4 w-4" />
                </MagneticButton>
                <MagneticButton
                  onClick={() => navigate("/app")}
                  className="btn-ghost inline-flex items-center gap-2"
                >
                  <Play className="h-4 w-4" /> Open App
                </MagneticButton>
              </motion.div>

              {/* AQI strip */}
              <motion.div
                className="mt-10 flex flex-wrap items-center justify-center gap-4"
                {...fadeUp(0.35)}
              >
                <AqiGauge aqi={currentAqi} />
                <span className="chip chip-mod">PM2.5: 78 µg/m³</span>
                <span className="chip chip-good">CO₂: 620 ppm</span>
                <span className="chip chip-mod">RH: 58%</span>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}


const HOW_IT_WORKS_TESTIMONIALS = [
  {
    quote:
      "I was impressed by the food! And I could really tell that they use high-quality ingredients. The staff was friendly and attentive. I'll definitely be back for more!",
    name: "Tamar Mendelson",
    designation: "Restaurant Critic",
    src:
      "https://images.unsplash.com/photo-1512316609839-ce289d3eba0a?q=80&w=1368&auto=format&fit=crop",
  },
  {
    quote:
      "This place exceeded all expectations! The atmosphere is inviting, and the staff truly goes above and beyond. I'll keep returning for more exceptional dining experience.",
    name: "Joe Charlescraft",
    designation: "Frequent Visitor",
    src:
      "https://images.unsplash.com/photo-1628749528992-f5702133b686?q=80&w=1368&auto=format&fit=crop",
  },
  {
    quote:
      "Shining Yam is a hidden gem! The impeccable service and overall attention to detail created a memorable experience. I highly recommend it!",
    name: "Martina Edelweist",
    designation: "Satisfied Customer",
    src:
      "https://images.unsplash.com/photo-1524267213992-b76e8577d046?q=80&w=1368&auto=format&fit=crop",
  },
];

function HowItWorksShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);

  return (
    <section
      ref={sectionRef}
      className="relative mx-auto max-w-7xl px-6 py-24 md:py-28"
    >
      <div className="relative mb-10">
        <WindFlow className="pointer-events-none absolute -top-10 left-0 h-24 w-full" />
        <h2 className="relative text-center text-3xl font-bold md:text-4xl">
          Your archive → insights, step by step
        </h2>
        <Co2Wave className="mx-auto mt-3 w-full max-w-xl" />
        <p className="mt-3 text-center text-slate-600">
          A page-aware journey across Archive, Collector, Notebook, AI Chat, and Publish.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-12 md:grid-cols-2">
        {/* RIGHT: Circular testimonials carousel */}
        <div className="relative flex items-center justify-center">
          <CircularTestimonials
            testimonials={HOW_IT_WORKS_TESTIMONIALS}
            autoplay
            colors={{
              name: "#0a0a0a",
              designation: "#454545",
              testimony: "#171717",
              arrowBackground: "#141414",
              arrowForeground: "#f1f1f7",
              arrowHoverBackground: "#00A6FB",
            }}
            fontSizes={{
              name: "28px",
              designation: "20px",
              quote: "20px",
            }}
          />
        </div>
      </div>
    </section>
  );
}

/* ========= Pricing + CTA footer ========= */
function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "Free",
      features: ["Unlimited saved URLs", "Basic tags", "Community support"],
    },
    {
      name: "Pro",
      price: "$12/mo",
      features: ["Advanced filters", "Priority support", "Notebook exports"],
    },
    {
      name: "Team",
      price: "$29/mo",
      features: ["Shared workspaces", "Roles & SSO", "Audit trails"],
    },
  ];
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold md:text-4xl">Simple pricing</h2>
          <p className="mt-3 text-slate-600">
            Start free. Upgrade when you need more collaboration.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((p, i) => (
            <motion.div
              key={p.name}
              className={`rounded-2xl border bg-white p-6 shadow-sm ${
                p.name === "Pro"
                  ? "border-indigo-600 ring-1 ring-indigo-600"
                  : "border-slate-200"
              }`}
              {...fadeUp(i * 0.05)}
            >
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="mt-2 text-3xl font-bold">{p.price}</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-indigo-600" /> {f}
                  </li>
                ))}
              </ul>
              <MagneticButton
                className="btn-primary mt-6 inline-flex w-full items-center justify-center gap-2"
                onClick={() => navigate("/signup")}
              >
                Choose {p.name}
              </MagneticButton>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="bg-landing-gradient">
        <div className="mx-auto max-w-7xl px-6 py-16 text-center text-white">
          <h3 className="text-2xl font-bold">Ready to turn archives into insights?</h3>
          <p className="mt-2 text-white/90">
            Join in under two minutes. No credit card required.
          </p>
          <div className="mt-6">
            <MagneticButton
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => navigate("/signup")}
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </MagneticButton>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========= Page ========= */
export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white antialiased">
      <Hero />
      <HowItWorksShowcase />
      {/* KPIs removed as requested */}
      <Pricing />
    </main>
  );
}
