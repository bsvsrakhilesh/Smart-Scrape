// frontend/pages/LandingPage.tsx
import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Database,
  FolderOpen,
  Network,
  Search,
} from "lucide-react";

const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Collector", href: "/app/url-collector" },
  { label: "Library", href: "/app/saved-urls" },
  { label: "Pages", href: "#pages" },
  { label: "Notebook", href: "/notebook" },
  { label: "Reach Us", href: "mailto:hello@smartscrape.local" },
];

const PAGE_DIRECTORY = [
  {
    title: "URL Collector",
    eyebrow: "Source intake",
    route: "/app/url-collector",
    icon: <Search className="h-5 w-5" />,
    description:
      "Search, inspect, dedupe, and save high-signal web sources into the archive without losing momentum.",
    highlights: ["Focused source sweeps", "Candidate review", "Batch saving"],
  },
  {
    title: "Saved URLs",
    eyebrow: "Source registry",
    route: "/app/saved-urls",
    icon: <Database className="h-5 w-5" />,
    description:
      "Review preserved sources with tags, collections, snapshots, status, and searchable evidence metadata.",
    highlights: ["AI tagging", "Collections", "Review state"],
  },
  {
    title: "File Manager",
    eyebrow: "Evidence library",
    route: "/app/file-manager",
    icon: <FolderOpen className="h-5 w-5" />,
    description:
      "Keep PDFs, uploads, datasets, and reference files organized beside the web material they support.",
    highlights: ["Folders", "Document previews", "Metadata"],
  },
  {
    title: "Governance Workspace",
    eyebrow: "Relationship map",
    route: "/app/governance-workspace",
    icon: <Network className="h-5 w-5" />,
    description:
      "Trace agencies, issues, timelines, and evidence relationships so complex governance questions stay readable.",
    highlights: ["Agency landscape", "Issue matrix", "Evidence links"],
  },
  {
    title: "Notebook",
    eyebrow: "Synthesis studio",
    route: "/notebook",
    icon: <BookOpen className="h-5 w-5" />,
    description:
      "Turn selected sources into working notes, grounded summaries, briefs, and reusable research drafts.",
    highlights: ["Source attachments", "Grounded notes", "Reusable briefs"],
  },
];

function useSeamlessVideoLoop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<number>(0);
  const resetTimeoutRef = useRef<number>(0);
  const isRestartingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const setOpacity = (value: number) => {
      video.style.opacity = String(Math.min(Math.max(value, 0), 1));
    };

    const playVideo = () => {
      void video.play().catch(() => undefined);
    };

    const monitor = () => {
      const { currentTime, duration } = video;

      if (Number.isFinite(duration) && duration > 0 && !isRestartingRef.current) {
        const startOpacity = Math.min(currentTime / 0.5, 1);
        const endOpacity = Math.min((duration - currentTime) / 0.5, 1);
        setOpacity(Math.min(startOpacity, endOpacity));
      }

      frameRef.current = window.requestAnimationFrame(monitor);
    };

    const handleEnded = () => {
      isRestartingRef.current = true;
      setOpacity(0);

      resetTimeoutRef.current = window.setTimeout(() => {
        video.currentTime = 0;
        isRestartingRef.current = false;
        playVideo();
      }, 100);
    };

    video.addEventListener("ended", handleEnded);
    video.loop = false;
    setOpacity(0);
    playVideo();
    frameRef.current = window.requestAnimationFrame(monitor);

    return () => {
      video.removeEventListener("ended", handleEnded);
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(resetTimeoutRef.current);
    };
  }, []);

  return videoRef;
}

function LandingNav() {
  const navigate = useNavigate();

  const onRoute = useCallback(
    (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (href.startsWith("mailto:") || href.startsWith("#")) return;
      event.preventDefault();
      navigate(href);
    },
    [navigate],
  );

  return (
    <header className="relative z-10">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
        <a
          href="/"
          onClick={onRoute("/")}
          className="flex items-center gap-3 rounded-xl px-1 py-1 text-[#0f172a] transition-colors hover:text-[#000000]"
          aria-label="Smart Scrape home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
            <img
              src="/assets/logo.png"
              alt=""
              className="h-6 w-6 rounded-md"
              aria-hidden="true"
            />
          </span>
          <span className="text-xl font-semibold tracking-tight">Smart Scrape</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary navigation">
          {NAV_ITEMS.map((item, index) => (
            <a
              key={item.label}
              href={item.href}
              onClick={onRoute(item.href)}
              className="text-sm font-medium text-[#6F6F6F] transition-colors duration-200 hover:text-[#000000]"
              style={{ color: index === 0 ? "#000000" : undefined }}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/notebook")}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-[#000000] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-black/20"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Open Notebook</span>
            <span className="sm:hidden">Notebook</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/app/url-collector")}
            className="rounded-full bg-[#000000] px-5 py-2.5 text-sm font-medium text-[#FFFFFF] transition-transform duration-200 hover:scale-[1.03]"
          >
            Open App
          </button>
        </div>
      </div>
    </header>
  );
}

function HeroBackground() {
  const videoRef = useSeamlessVideoLoop();

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-x-0 bottom-0 top-[300px] overflow-hidden">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          src={HERO_VIDEO_URL}
          muted
          playsInline
          preload="auto"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        <div className="absolute inset-0 bg-white/20 backdrop-blur-[1px]" />
      </div>
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();

  return (
    <section
      className="relative z-10 flex flex-col items-center justify-center px-6 pb-40 text-center"
      style={{ paddingTop: "calc(8rem - 75px)" }}
    >
      <p className="animate-fade-rise-delay mb-5 max-w-xl text-sm font-medium uppercase tracking-[0.18em] text-[#6F6F6F]">
        Source intelligence for deep research
      </p>

      <h1
        className="animate-fade-rise max-w-7xl font-display text-5xl font-normal text-[#000000] sm:text-7xl md:text-8xl"
        style={{ lineHeight: 0.95, letterSpacing: "-2.46px" }}
      >
        Turn{" "}
        <em className="font-normal italic text-[#6F6F6F]">scattered sources</em>{" "}
        into{" "}
        <em className="font-normal italic text-[#6F6F6F]">
          grounded intelligence.
        </em>
      </h1>

      <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-[#6F6F6F] sm:text-lg">
        Smart Scrape helps researchers collect web sources, organize files,
        preserve evidence, map governance context, and draft notebooks from the
        archive they trust.
      </p>

      <div className="animate-fade-rise-delay-2 mt-12 flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => navigate("/app/url-collector")}
          className="inline-flex min-w-[184px] items-center justify-center rounded-full bg-[#000000] px-10 py-5 text-base font-medium text-[#FFFFFF] transition-transform duration-200 hover:scale-[1.03]"
        >
          Open App
        </button>
        <button
          type="button"
          onClick={() => navigate("/notebook")}
          className="inline-flex min-w-[184px] items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-10 py-5 text-base font-medium text-[#000000] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-black/20"
        >
          <BookOpen className="h-5 w-5" aria-hidden="true" />
          Open Notebook
        </button>
      </div>
    </section>
  );
}

function PageDirectory() {
  const navigate = useNavigate();

  return (
    <section id="pages" className="relative z-10 bg-[#FFFFFF] px-6 pb-24 pt-4">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#6F6F6F]">
            Connected work surfaces
          </p>
          <h2
            className="mt-4 font-display text-4xl font-normal text-[#000000] sm:text-6xl"
            style={{ lineHeight: 1, letterSpacing: "-1.4px" }}
          >
            Every page has a job in the research flow.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#6F6F6F]">
            Move from source intake to organized evidence, governance review,
            and cited notebook synthesis without losing the trail.
          </p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {PAGE_DIRECTORY.map((page) => (
            <button
              key={page.route}
              type="button"
              onClick={() => navigate(page.route)}
              className="group rounded-[8px] border border-black/10 bg-white p-5 text-left shadow-[0_14px_42px_rgba(0,0,0,0.06)] transition duration-200 hover:-translate-y-1 hover:border-black/20 hover:shadow-[0_22px_64px_rgba(0,0,0,0.10)]"
            >
              <span className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black text-white">
                {page.icon}
              </span>
              <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-[#6F6F6F]">
                {page.eyebrow}
              </span>
              <h3 className="mt-3 font-display text-3xl font-normal leading-none text-[#000000]">
                {page.title}
              </h3>
              <p className="mt-4 min-h-[96px] text-sm leading-6 text-[#6F6F6F]">
                {page.description}
              </p>
              <ul className="mt-5 space-y-2">
                {page.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="flex items-center gap-2 text-sm text-[#000000]"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[#6F6F6F]" />
                    {highlight}
                  </li>
                ))}
              </ul>
              <span className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-[#000000]">
                Open page
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function BottomCTA() {
  const navigate = useNavigate();

  return (
    <section className="relative z-10 bg-[#FFFFFF] px-6 pb-16">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 border-t border-black/10 pt-10 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#6F6F6F]">
            Begin with intake
          </p>
          <h2 className="mt-3 font-display text-4xl font-normal text-[#000000]">
            Start with the first source. Keep the full trail.
          </h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate("/app/url-collector")}
            className="rounded-full bg-[#000000] px-8 py-4 text-sm font-medium text-[#FFFFFF] transition-transform duration-200 hover:scale-[1.03]"
          >
            Open URL Collector
          </button>
          <button
            type="button"
            onClick={() => navigate("/notebook")}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-8 py-4 text-sm font-medium text-[#000000] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-black/20"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Open Notebook
          </button>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  useEffect(() => {
    document.documentElement.classList.add("landing-scroll-root");
    document.body.classList.add("landing-scroll-root");

    return () => {
      document.documentElement.classList.remove("landing-scroll-root");
      document.body.classList.remove("landing-scroll-root");
    };
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-background font-sans antialiased">
      <section className="relative min-h-screen overflow-hidden">
        <HeroBackground />
        <LandingNav />
        <Hero />
      </section>
      <PageDirectory />
      <BottomCTA />
    </main>
  );
}
