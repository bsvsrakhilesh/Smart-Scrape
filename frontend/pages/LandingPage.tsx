// frontend/pages/LandingPage.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionProps,
  type Transition,
} from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Command,
  FileText,
  FolderOpen,
  Link as LinkIcon,
  Sparkles,
  Star,
  Wand2,
} from "lucide-react";

/* ========================
   Motion presets
   ======================== */
const EASE: Transition["ease"] = [0.16, 1, 0.3, 1];
const fadeUp = (delay = 0): MotionProps => ({
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
  viewport: { once: true, amount: 0.35 },
});

/* ========================
   Tiny UX utilities
   ======================== */
const MagneticButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className = "",
  children,
  ...rest
}) => {
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

function useActiveStep(sectionRef: React.RefObject<HTMLDivElement | null>, steps: number) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  // Smooth the progress so we don't flicker on fast scroll
  const p = useSpring(scrollYProgress, {
    stiffness: reduce ? 999 : 180,
    damping: reduce ? 60 : 30,
    mass: 0.5,
  });

  const [active, setActive] = useState(0);
  useEffect(() => {
    const unsub = p.on("change", (v) => {
      const clamped = Math.max(0, Math.min(0.999, v));
      const idx = Math.floor(clamped * steps);
      setActive(idx);
    });
    return () => unsub();
  }, [p, steps]);

  return { active, progress: p };
}

/* ========================
   Top navigation
   ======================== */
function LandingNav() {
  const navigate = useNavigate();

  const items = [
    { label: "Features", href: "#features" },
    { label: "Workflow", href: "#workflow" },
    { label: "Keyboard", href: "#keyboard" },
    { label: "Start", href: "#start" },
  ];

  return (
    <div className="fixed inset-x-0 top-0 z-50">
      <div className="landing-topbar">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="h-16 flex items-center justify-between gap-3">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="group flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-white/40 transition"
              aria-label="Smart Scrape Home"
              title="Smart Scrape"
            >
              <span className="relative inline-flex">
                <img
                  src="/assets/logo.png"
                  alt="Smart Scrape"
                  className="h-8 w-8 rounded-xl shadow-sm ring-1 ring-black/5"
                />
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-0 ring-emerald-300/60 opacity-0 group-hover:opacity-100 group-hover:ring-2 transition" />
              </span>
              <span className="hidden sm:inline text-sm font-semibold tracking-wide text-slate-900">
                Smart Scrape
                <span className="block h-[2px] w-0 bg-gradient-to-r from-emerald-500/80 to-sky-500/80 rounded-full mt-[2px] group-hover:w-full transition-all duration-200 ease-out" />
              </span>
            </button>

            <nav className="hidden md:flex items-center gap-1 text-sm">
              {items.map((it) => (
                <a
                  key={it.href}
                  href={it.href}
                  className="px-3 py-2 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-white/40 transition"
                >
                  {it.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <a
                href="/app#url-collector"
                className="hidden sm:inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white/40 transition"
              >
                <Sparkles className="h-4 w-4" />
                Open workspace
              </a>
              <MagneticButton
                onClick={() => navigate("/app")}
                className="landing-primary-btn inline-flex items-center gap-2"
              >
                Open App <ArrowRight className="h-4 w-4" />
              </MagneticButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================
   Hero
   ======================== */
function Hero() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const blur = useTransform(scrollYProgress, [0, 1], ["blur(42px)", "blur(82px)"]);

  const onMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <section ref={ref} className="relative overflow-hidden spotlight" onMouseMove={onMouseMove}>
      <div className="landing-hero-bg">
        {/* mesh + glow */}
        <motion.div
          aria-hidden
          style={{ y, filter: blur }}
          className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/20 blur-3xl"
        />
        <div aria-hidden className="landing-noise" />

        <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-14 md:pt-28 md:pb-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
            <div>
              <motion.div
                className="inline-flex items-center gap-2 rounded-full bg-white/35 px-3 py-1 text-sm text-slate-800 ring-1 ring-white/50"
                {...fadeUp(0)}
              >
                <Wand2 className="h-4 w-4" />
                Research workflow, cleaned up.
              </motion.div>

              <motion.h1
                className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 md:text-6xl"
                {...fadeUp(0.08)}
              >
                Turn links & files into a
                <span className="block landing-gradient-text">structured knowledge workspace</span>
              </motion.h1>

              <motion.p className="mt-5 max-w-xl text-slate-700 md:text-lg" {...fadeUp(0.16)}>
                Smart Scrape gives you four tightly-connected pages: collect sources, auto-tag & organize them,
                manage files, and synthesize everything into notebooks — fast, searchable, and keyboard-first.
              </motion.p>

              <motion.div className="mt-8 flex flex-wrap items-center gap-3" {...fadeUp(0.24)}>
                <MagneticButton
                  onClick={() => navigate("/app")}
                  className="landing-primary-btn inline-flex items-center gap-2"
                >
                  Open App <ArrowRight className="h-4 w-4" />
                </MagneticButton>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-800 bg-white/40 ring-1 ring-white/60 hover:bg-white/55 transition"
                >
                  See what’s inside
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-white/70">↘</span>
                </a>
              </motion.div>

              <motion.div className="mt-8 flex flex-wrap gap-2" {...fadeUp(0.3)} aria-label="Highlights">
                <span className="landing-pill"><Command className="h-4 w-4" /> Cmd/Ctrl + K</span>
                <span className="landing-pill"><Sparkles className="h-4 w-4" /> AI tags</span>
                <span className="landing-pill"><Star className="h-4 w-4" /> Favorites + collections</span>
                <span className="landing-pill"><FileText className="h-4 w-4" /> PDFs + text capture</span>
              </motion.div>
            </div>

            {/* Right: app preview collage */}
            <motion.div
              className="relative"
              initial={reduce ? undefined : { opacity: 0, y: 10 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.15 }}
            >
              <div className="landing-preview-wrap">
                <div className="landing-preview-top">
                  <div className="flex items-center gap-2">
                    <span className="dot bg-rose-400" />
                    <span className="dot bg-amber-400" />
                    <span className="dot bg-emerald-400" />
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600">
                    <span className="px-2 py-1 rounded-md bg-white/60 ring-1 ring-black/5">/app</span>
                    <span className="px-2 py-1 rounded-md bg-white/60 ring-1 ring-black/5">#url-collector</span>
                  </div>
                </div>

                <div className="landing-preview-body">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-5">
                      <div className="landing-mini-card">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                          <LinkIcon className="h-4 w-4" /> URL Collector
                        </div>
                        <div className="mt-2 landing-skeleton h-8" />
                        <div className="mt-2 landing-skeleton h-8" />
                        <div className="mt-3 landing-skeleton h-6 w-2/3" />
                      </div>
                      <div className="mt-3 landing-mini-card">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                            <Sparkles className="h-4 w-4" /> Saved URLs
                          </div>
                          <span className="text-[11px] text-slate-500">Tagged</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="landing-chip">policy</div>
                          <div className="landing-chip">health</div>
                          <div className="landing-chip">method</div>
                          <div className="landing-chip">dataset</div>
                        </div>
                        <div className="mt-3 landing-skeleton h-16" />
                      </div>
                    </div>

                    <div className="col-span-7">
                      <div className="landing-mini-card h-full">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                            <BookOpen className="h-4 w-4" /> Notebook
                          </div>
                          <span className="text-[11px] text-slate-500">Live sources</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="landing-line w-11/12" />
                          <div className="landing-line w-9/12" />
                          <div className="landing-line w-10/12" />
                          <div className="landing-line w-7/12" />
                        </div>
                        <div className="mt-4 landing-skeleton h-28" />
                        <div className="mt-3 flex gap-2">
                          <div className="landing-pill-mini">Summary</div>
                          <div className="landing-pill-mini">Outline</div>
                          <div className="landing-pill-mini">Export</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========================
   Features = your pages
   ======================== */
type Feature = {
  key: "url-collector" | "saved-urls" | "file-manager" | "notebook";
  title: string;
  icon: React.ReactNode;
  description: string;
  bullets: string[];
};

const FEATURES: Feature[] = [
  {
    key: "url-collector",
    title: "URL Collector",
    icon: <LinkIcon className="h-5 w-5" />,
    description:
      "Search, collect, dedupe, and batch-save sources — built for fast literature sweeps and competitive research.",
    bullets: [
      "Site + keyword search, paginated fetch, and quick selection",
      "Bulk save with safety rails (rate limits, aborts, restore state)",
      "Export-ready list: clean titles, domains, and tags",
    ],
  },
  {
    key: "saved-urls",
    title: "Saved URLs",
    icon: <Sparkles className="h-5 w-5" />,
    description:
      "Auto-tagging, smart filtering, and bulk actions — your sources stay tidy as the list grows.",
    bullets: [
      "AI tags + retry flow, favorites, and collections",
      "Capture text/PDF snapshots for offline reading",
      "Bulk move/copy/cut, dedupe, and quick search",
    ],
  },
  {
    key: "file-manager",
    title: "File Manager",
    icon: <FolderOpen className="h-5 w-5" />,
    description:
      "Upload, preview, and organize files with a clean explorer-style UX and lightning-fast scanability.",
    bullets: [
      "Folders, versions, visibility, and metadata",
      "Previews + search-ready structure",
      "Built for PDFs, datasets, and research assets",
    ],
  },
  {
    key: "notebook",
    title: "Notebook",
    icon: <BookOpen className="h-5 w-5" />,
    description:
      "Synthesize sources into briefs, outlines, and deliverables — with attached URLs/files as live context.",
    bullets: [
      "Attach sources to every notebook (URLs + files)",
      "AI-assisted outline/summary blocks and structured notes",
      "A single place to produce policy-ready writing from your own archive",
    ],
  },
];

function FeatureGrid() {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-6 py-20 md:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <motion.h2 className="text-3xl font-bold tracking-tight md:text-4xl" {...fadeUp(0)}>
          Everything on your landing page is already in your app.
        </motion.h2>
        <motion.p className="mt-3 text-slate-600" {...fadeUp(0.08)}>
          Four pages, one workflow — designed to feel like a premium research tool, not a dashboard.
        </motion.p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        {FEATURES.map((f, i) => (
          <motion.a
            key={f.key}
            href={`/app#${f.key}`}
            className="landing-card group"
            {...fadeUp(0.06 + i * 0.05)}
          >
            <div className="landing-card-top">
              <div className="landing-icon">{f.icon}</div>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-slate-900 truncate">{f.title}</h3>
                  <span className="landing-card-cta">
                    Open <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{f.description}</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {f.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-gradient-to-br from-emerald-500 to-sky-500" />
                  <span className="flex-1">{b}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 landing-card-footer">
              <span className="landing-tag">/app</span>
              <span className="landing-tag">#{f.key}</span>
              <span className="landing-tag landing-tag-soft">Keyboard-first</span>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}

/* ========================
   Workflow: scrollytelling product tour
   ======================== */

type TourStep = {
  title: string;
  subtitle: string;
  pageHash: Feature["key"];
  icon: React.ReactNode;
};

const TOUR: TourStep[] = [
  {
    title: "Collect",
    subtitle: "Search broadly, then narrow quickly. Save only what matters.",
    pageHash: "url-collector",
    icon: <LinkIcon className="h-4 w-4" />,
  },
  {
    title: "Enrich",
    subtitle: "Auto-tags + collections turn a messy list into an indexable library.",
    pageHash: "saved-urls",
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    title: "Organize",
    subtitle: "Treat PDFs & datasets like first-class citizens — preview, folder, and version.",
    pageHash: "file-manager",
    icon: <FolderOpen className="h-4 w-4" />,
  },
  {
    title: "Synthesize",
    subtitle: "Attach sources to notebooks and generate structured outputs without losing context.",
    pageHash: "notebook",
    icon: <BookOpen className="h-4 w-4" />,
  },
];

function AppPreview({ step }: { step: number }) {
  const s = TOUR[step];

  const content = useMemo(() => {
    if (s.pageHash === "url-collector") {
      return (
        <div className="space-y-3">
          <div className="landing-frame-bar">
            <div className="landing-frame-pill">site:example.com</div>
            <div className="landing-frame-pill">"emissions policy"</div>
            <div className="landing-frame-pill landing-frame-pill--cta">Search</div>
          </div>

          <div className="landing-table">
            <div className="landing-table-head">
              <span>Title</span>
              <span>Domain</span>
              <span>Action</span>
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="landing-table-row">
                <div className="landing-table-cell">
                  <div className="landing-line w-[92%]" />
                </div>
                <div className="landing-table-cell">
                  <div className="landing-line w-[70%]" />
                </div>
                <div className="landing-table-cell">
                  <div className="landing-mini-btn">Save</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (s.pageHash === "saved-urls") {
      return (
        <div className="space-y-3">
          <div className="landing-frame-bar">
            <div className="landing-frame-pill">Favorites</div>
            <div className="landing-frame-pill">collection: Methods</div>
            <div className="landing-frame-pill">tag: dataset</div>
            <div className="landing-frame-pill landing-frame-pill--cta">Filter</div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="landing-url-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="landing-line w-[86%]" />
                    <div className="mt-2 landing-line w-[72%]" />
                  </div>
                  <div className="landing-mini-btn">⋯</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="landing-chip">policy</span>
                  <span className="landing-chip">health</span>
                  <span className="landing-chip">method</span>
                  <span className="landing-chip">dataset</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (s.pageHash === "file-manager") {
      return (
        <div className="space-y-3">
          <div className="landing-frame-bar">
            <div className="landing-frame-pill">/Research</div>
            <div className="landing-frame-pill">Delhi-2025</div>
            <div className="landing-frame-pill landing-frame-pill--cta">Upload</div>
          </div>

          <div className="landing-table">
            <div className="landing-table-head">
              <span>Name</span>
              <span>Type</span>
              <span>Size</span>
            </div>
            {["report.pdf", "dataset.csv", "notes.txt", "slides.pptx", "raw.zip"].map((name, i) => (
              <div key={name} className="landing-table-row">
                <div className="landing-table-cell flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-white/70 ring-1 ring-black/5 grid place-items-center text-[11px] font-semibold">
                    {name.split(".").pop()?.toUpperCase().slice(0, 3)}
                  </span>
                  <span className="text-sm font-medium text-slate-800 truncate">{name}</span>
                </div>
                <div className="landing-table-cell text-sm text-slate-600">{name.split(".").pop()}</div>
                <div className="landing-table-cell text-sm text-slate-600">{(i + 2) * 1.4} MB</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="landing-frame-bar">
          <div className="landing-frame-pill">Notebook</div>
          <div className="landing-frame-pill">+ Add sources</div>
          <div className="landing-frame-pill landing-frame-pill--cta">Generate</div>
        </div>

        <div className="landing-url-card">
          <div className="text-xs font-semibold text-slate-700">Outline</div>
          <div className="mt-2 space-y-2">
            <div className="landing-line w-[85%]" />
            <div className="landing-line w-[78%]" />
            <div className="landing-line w-[62%]" />
          </div>
        </div>

        <div className="landing-url-card">
          <div className="text-xs font-semibold text-slate-700">Draft</div>
          <div className="mt-2 space-y-2">
            <div className="landing-line w-[92%]" />
            <div className="landing-line w-[88%]" />
            <div className="landing-line w-[70%]" />
            <div className="landing-line w-[58%]" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="landing-chip">Citations</span>
            <span className="landing-chip">Sources attached</span>
          </div>
        </div>
      </div>
    );
  }, [s.pageHash]);

  return (
    <div className="landing-frame">
      <div className="landing-frame-top">
        <div className="flex items-center gap-2">
          <span className="dot bg-rose-400" />
          <span className="dot bg-amber-400" />
          <span className="dot bg-emerald-400" />
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="px-2 py-1 rounded-md bg-white/70 ring-1 ring-black/5">/app</span>
          <span className="px-2 py-1 rounded-md bg-white/70 ring-1 ring-black/5">#{s.pageHash}</span>
        </div>
      </div>

      <div className="landing-frame-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={s.pageHash}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function WorkflowTour() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { active, progress } = useActiveStep(sectionRef, TOUR.length);
  const barScale = useTransform(progress, [0, 1], [0, 1]);

  return (
    <section id="workflow" ref={sectionRef} className="relative mx-auto max-w-7xl px-6 py-20 md:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <motion.h2 className="text-3xl font-bold tracking-tight md:text-4xl" {...fadeUp(0)}>
          One workflow. Four pages.
        </motion.h2>
        <motion.p className="mt-3 text-slate-600" {...fadeUp(0.08)}>
          Scroll this section — the preview updates to show exactly how each page contributes.
        </motion.p>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        {/* Left: steps */}
        <div className="relative">
          <div className="progress-rail" />
          <motion.div className="progress-bar" style={{ scaleY: barScale }} />

          <div className="space-y-4">
            {TOUR.map((s, idx) => {
              const isActive = idx === active;
              return (
                <a
                  key={s.pageHash}
                  href={`/app#${s.pageHash}`}
                  className={
                    "landing-step group " +
                    (isActive ? "landing-step--active" : "landing-step--idle")
                  }
                >
                  <div className={"landing-step-badge " + (isActive ? "landing-step-badge--active" : "")}>
                    {s.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-base font-semibold text-slate-900">{s.title}</div>
                      <span className="text-xs text-slate-500 group-hover:text-slate-700 transition">
                        #{s.pageHash}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{s.subtitle}</div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* Right: sticky preview */}
        <div className="lg:sticky lg:top-24 h-fit">
          <AppPreview step={active} />
        </div>
      </div>
    </section>
  );
}

/* ========================
   Keyboard-first proof
   ======================== */
function KeyboardSection() {
  const navigate = useNavigate();
  return (
    <section id="keyboard" className="relative mx-auto max-w-7xl px-6 py-20 md:py-24">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr] items-center">
        <div>
          <motion.h2 className="text-3xl font-bold tracking-tight md:text-4xl" {...fadeUp(0)}>
            Built for speed (not clicks).
          </motion.h2>
          <motion.p className="mt-3 text-slate-600" {...fadeUp(0.08)}>
            The UI is designed to reward power-users: command palette, state restore, bulk actions, and clean
            information hierarchy.
          </motion.p>

          <motion.div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2" {...fadeUp(0.16)}>
            <div className="landing-kbd-card">
              <div className="landing-kbd-title">
                <Command className="h-4 w-4" /> Command palette
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Press <span className="landing-kbd">Ctrl</span> + <span className="landing-kbd">K</span> to jump anywhere.
              </div>
            </div>
            <div className="landing-kbd-card">
              <div className="landing-kbd-title">
                <Sparkles className="h-4 w-4" /> AI tagging
              </div>
              <div className="mt-2 text-sm text-slate-600">Tag jobs + retries so your library stays organized.</div>
            </div>
            <div className="landing-kbd-card">
              <div className="landing-kbd-title">
                <Star className="h-4 w-4" /> Bulk actions
              </div>
              <div className="mt-2 text-sm text-slate-600">Move/copy/cut, favorites, collections — at scale.</div>
            </div>
            <div className="landing-kbd-card">
              <div className="landing-kbd-title">
                <FileText className="h-4 w-4" /> Capture & preview
              </div>
              <div className="mt-2 text-sm text-slate-600">Save PDFs/text snapshots for reliable referencing.</div>
            </div>
          </motion.div>

          <motion.div className="mt-7" {...fadeUp(0.22)}>
            <MagneticButton
              className="landing-primary-btn inline-flex items-center gap-2"
              onClick={() => navigate("/app")}
            >
              Try it now <ArrowRight className="h-4 w-4" />
            </MagneticButton>
          </motion.div>
        </div>

        <motion.div className="landing-command-mock" {...fadeUp(0.12)}>
          <div className="landing-command-top">
            <div className="text-sm font-semibold text-slate-900">Command Palette</div>
            <div className="text-xs text-slate-500">Ctrl + K</div>
          </div>
          <div className="landing-command-input">
            <span className="text-slate-500">Search pages…</span>
            <span className="ml-auto text-xs text-slate-500">Enter</span>
          </div>
          <div className="mt-3 space-y-2">
            {FEATURES.map((f) => (
              <a key={f.key} href={`/app#${f.key}`} className="landing-command-item">
                <span className="landing-command-icon">{f.icon}</span>
                <span className="flex-1 text-sm font-medium text-slate-800">{f.title}</span>
                <span className="text-xs text-slate-500">#{f.key}</span>
              </a>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ========================
   Bottom CTA
   ======================== */
function BottomCTA() {
  const navigate = useNavigate();
  return (
    <section id="start" className="relative overflow-hidden">
      <div className="landing-cta-bg">
        <div aria-hidden className="landing-noise" />
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20 text-center">
          <motion.h3 className="text-2xl font-bold text-white md:text-3xl" {...fadeUp(0)}>
            Ready to make your research workflow look (and feel) premium?
          </motion.h3>
          <motion.p className="mt-2 text-white/90" {...fadeUp(0.08)}>
            Open the workspace and start collecting sources in seconds.
          </motion.p>
          <motion.div className="mt-6" {...fadeUp(0.14)}>
            <MagneticButton
              className="landing-primary-btn landing-primary-btn--onDark inline-flex items-center gap-2"
              onClick={() => navigate("/app")}
            >
              Open App <ArrowRight className="h-4 w-4" />
            </MagneticButton>
          </motion.div>
          <div className="mt-6 text-xs text-white/75">
            Deep links:{" "}
            <a className="underline underline-offset-4 hover:text-white" href="/app#url-collector">
              URL Collector
            </a>
            {" · "}
            <a className="underline underline-offset-4 hover:text-white" href="/app#saved-urls">
              Saved URLs
            </a>
            {" · "}
            <a className="underline underline-offset-4 hover:text-white" href="/app#file-manager">
              File Manager
            </a>
            {" · "}
            <a className="underline underline-offset-4 hover:text-white" href="/app#notebook">
              Notebook
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========================
   Page
   ======================== */
export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white antialiased">
      <LandingNav />
      <div className="h-16" />
      <Hero />
      <FeatureGrid />
      <WorkflowTour />
      <KeyboardSection />
      <BottomCTA />
      <footer className="py-10 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="flex items-center gap-2">
              <img src="/assets/logo.png" alt="Smart Scrape" className="h-6 w-6 rounded-lg ring-1 ring-black/5" />
              <span className="font-semibold text-slate-700">Smart Scrape</span>
            </div>
            <div>© {new Date().getFullYear()} — built with care.</div>
          </div>
        </div>
      </footer>
    </main>
  );
}
