import React, { useCallback, useRef, useState } from "react";
import {
  motion,
  type Transition,
  AnimatePresence,
  useReducedMotion,
} from "framer-motion";
import { Page } from "../../lib/types";
import UrlIcon from "../icons/UrlIcon";
import BookmarkIcon from "../icons/BookmarkIcon";
import FolderIcon from "../icons/FolderIcon";
import BookIcon from "../icons/BookIcon";

interface SidebarProps {
  isOpen: boolean;
  currentPage: Page;
  setCurrentPage: (page: Page) => void;
  useParentWidth?: boolean;
}

/* --------------------------------- NAV DATA -------------------------------- */
const NAV: Array<{
  key: Page;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { key: "url-collector", label: "URL Collector", Icon: UrlIcon },
  { key: "saved-urls", label: "Saved URLs", Icon: BookmarkIcon },
  { key: "file-manager", label: "File Manager", Icon: FolderIcon },
  {
    key: "governance-workspace",
    label: "Governance Workspace",
    Icon: BookIcon as React.ComponentType<React.SVGProps<SVGSVGElement>>,
  },
];

/* --------------------------------- MOTION ---------------------------------- */
// Softer spring and smaller durations for snappy, refined feel
const SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.95,
};

/* --------------------------------- STYLES ---------------------------------- */
// stronger glass + depth on hover; accessible focus ring retained
const railTap =
  "group relative size-12 grid place-items-center rounded-2xl border border-transparent bg-transparent " +
  "transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/55";

const listTap =
  "group sidebar-nav-item relative flex w-full min-w-0 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-foreground/80 " +
  "transition-all duration-200 ease-out hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-primary/55";
/* --------------------------------- CONTAINER / ITEM VARIANTS ----------------- */
// Use explicit hidden/visible states so collapsed (icon-only) still shows icons.
const containerVariants = {
  hidden: { transition: { when: "afterChildren" } },
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.16, ease: "easeOut" },
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease: "easeOut" },
  },
} as const;

/* --------------------------------- COMPONENT ---------------------------------- */
const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  currentPage,
  setCurrentPage,
  useParentWidth,
}) => {
  // Fixed widths; sidebar itself animates width (no overlay)
  const COLLAPSED = 72;
  const EXPANDED = 272;

  const nav = NAV; // allow future memoization if NAV becomes dynamic

  const [hoverKey, setHoverKey] = useState<Page | null>(null);
  const reduce = useReducedMotion();
  // Roving focus / keyboard navigation across sidebar items
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const setBtnRef = useCallback(
    (key: Page) => (el: HTMLButtonElement | null) => {
      btnRefs.current[key] = el;
    },
    [],
  );

  const focusKey = useCallback(
    (key: Page) => {
      const el = btnRefs.current[key];
      if (el) el.focus();
      // In collapsed mode we show tooltip on focus; expanded mode ignores tooltip anyway
      setHoverKey(isOpen ? null : key);
    },
    [isOpen],
  );

  const handleNavKeyDown = useCallback(
    (e: React.KeyboardEvent, key: Page) => {
      const idx = nav.findIndex((n) => n.key === key);
      if (idx < 0) return;

      let nextIdx = idx;

      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          nextIdx = (idx + 1) % nav.length;
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          nextIdx = (idx - 1 + nav.length) % nav.length;
          break;
        case "Home":
          e.preventDefault();
          nextIdx = 0;
          break;
        case "End":
          e.preventDefault();
          nextIdx = nav.length - 1;
          break;
        case "Escape":
          // Close tooltip / remove hover affordance when keyboard users want it gone
          setHoverKey(null);
          return;
        default:
          return;
      }

      const nextKey = nav[nextIdx]?.key;
      if (nextKey) focusKey(nextKey);
    },
    [nav, focusKey],
  );

  // Small helper classes for active state + a reusable glass panel token
  const glassPanel =
    "bg-white/95 dark:bg-slate-950/95 border border-border/50 shadow-[0_12px_32px_rgba(15,23,42,0.10)] " +
    "lg:bg-transparent lg:border-0 lg:shadow-none";

  const activeRail =
    "border-brand-primary/25 bg-brand-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]";

  const activeList =
    "text-foreground border border-brand-primary/25 bg-brand-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]";
  return (
    <aside
      className="h-full z-40 overflow-x-hidden bg-transparent"
      aria-label="Primary sidebar"
    >
      <motion.nav
        role="navigation"
        aria-orientation="vertical"
        className={`h-full w-full flex flex-col gap-2 px-3 py-3 data-[sidebar-collapsed=true]:items-center rounded-2xl lg:rounded-none ${glassPanel}`}
        initial={false}
        animate={
          useParentWidth ? undefined : { width: isOpen ? EXPANDED : COLLAPSED }
        }
        transition={useParentWidth || reduce ? { duration: 0 } : SPRING}
        style={
          useParentWidth
            ? ({
                // allow horizontal overflow for tooltips when collapsed
                overflowX: isOpen ? "hidden" : "visible",
                overflowY: isOpen ? "auto" : "hidden",

                ["--sidebar-expanded" as any]: `${EXPANDED}px`,
                ["--sidebar-collapsed" as any]: `${COLLAPSED}px`,
              } as React.CSSProperties)
            : ({
                width: isOpen ? EXPANDED : COLLAPSED,
                // allow horizontal overflow for tooltips when collapsed, hide vertical scrollbar
                // allow horizontal overflow for tooltips when collapsed
                overflowX: isOpen ? "hidden" : "visible",
                overflowY: isOpen ? "auto" : "hidden",
                ["--sidebar-expanded" as any]: `${EXPANDED}px`,
                ["--sidebar-collapsed" as any]: `${COLLAPSED}px`,
              } as React.CSSProperties)
        }
      >
        {/* NAV ONLY */}
        <div
          className={`relative flex-1 w-full ${isOpen ? "overflow-hidden" : "overflow-visible"}`}
        >
          {/* Collapsed (icon-only rail) */}
          {!isOpen && (
            <motion.ul
              role="list"
              className="py-4 flex flex-col items-center gap-3 overflow-visible relative"
              variants={containerVariants}
              initial="visible"
              animate="visible"
            >
              {nav.map(({ key, label, Icon }) => {
                const active = currentPage === key;
                return (
                  <motion.li
                    key={key}
                    variants={itemVariants}
                    className="w-auto self-center"
                  >
                    <motion.button
                      type="button"
                      ref={setBtnRef(key)}
                      title={!isOpen ? label : undefined}
                      aria-label={label}
                      aria-current={active ? "page" : undefined}
                      aria-describedby={
                        !isOpen && hoverKey === key
                          ? `sb-tip-${key}`
                          : undefined
                      }
                      className={[
                        railTap,
                        active ? activeRail : "",
                        "mx-auto",
                      ].join(" ")}
                      onClick={() => setCurrentPage(key)}
                      onKeyDown={(e) => handleNavKeyDown(e, key)}
                      onMouseEnter={() => setHoverKey(key)}
                      onMouseLeave={() => setHoverKey(null)}
                      onFocus={() => setHoverKey(key)}
                      onBlur={() => setHoverKey(null)}
                      whileHover={reduce ? undefined : { y: -4, scale: 1.02 }}
                      whileTap={reduce ? undefined : { scale: 0.985 }}
                      transition={reduce ? { duration: 0 } : SPRING}
                    >
                      <span
                        className={[
                          "grid place-items-center size-9 rounded-lg transition-all",
                          active
                            ? "ring-1 ring-brand-primary/40 bg-white/60 dark:bg-white/10 shadow-sm scale-105"
                            : "ring-0 bg-white/5 dark:bg-white/5 group-hover:ring-1 group-hover:ring-white/15",
                        ].join(" ")}
                      >
                        <Icon
                          aria-hidden
                          className={
                            active
                              ? "w-5 h-5 text-foreground"
                              : "w-5 h-5 text-foreground/70"
                          }
                        />
                      </span>

                      {/* Tooltip visible only in collapsed state; absolutely positioned to avoid layout shifts */}
                      <AnimatePresence>
                        {hoverKey === key && (
                          <motion.span
                            id={`sb-tip-${key}`}
                            role="tooltip"
                            className="absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-xl bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg ring-1 ring-black/5 pointer-events-none"
                            initial={
                              reduce
                                ? { opacity: 1, x: 0 }
                                : { opacity: 0, x: -6 }
                            }
                            animate={
                              reduce
                                ? { opacity: 1, x: 0 }
                                : { opacity: 1, x: 0 }
                            }
                            exit={
                              reduce ? { opacity: 0 } : { opacity: 0, x: -6 }
                            }
                            transition={
                              reduce
                                ? { duration: 0 }
                                : { duration: 0.18, ease: "easeOut" }
                            }
                          >
                            {label}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}

          {/* Expanded (icon + label list) */}
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.ul
                role="list"
                className="px-2 py-2 space-y-1.5"
                initial="hidden"
                animate="visible"
                exit="hidden"
                variants={containerVariants}
              >
                {nav.map(({ key, label, Icon }) => {
                  const active = currentPage === key;
                  return (
                    <motion.li
                      key={key}
                      variants={itemVariants}
                      className="w-full"
                    >
                      <motion.button
                        type="button"
                        ref={setBtnRef(key)}
                        className={[
                          listTap,
                          active ? activeList : "text-foreground/80",
                          "relative min-w-0",
                        ].join(" ")}
                        onClick={() => setCurrentPage(key)}
                        onKeyDown={(e) => handleNavKeyDown(e, key)}
                        aria-current={active ? "page" : undefined}
                        whileHover={
                          reduce
                            ? undefined
                            : {
                                y: -1.5,
                                boxShadow: "0 8px 18px rgba(15,23,42,0.04)",
                              }
                        }
                        whileTap={reduce ? undefined : { scale: 0.985 }}
                        transition={reduce ? { duration: 0 } : SPRING}
                      >
                        <span
                          className={[
                            "shrink-0 grid place-items-center size-9 rounded-lg transition-all",
                            active
                              ? "ring-1 ring-brand-primary/40 bg-white/60 dark:bg-white/10 shadow-sm scale-105"
                              : "ring-0 bg-white/5 dark:bg-white/5 group-hover:ring-1 group-hover:ring-white/15",
                          ].join(" ")}
                        >
                          <Icon
                            aria-hidden
                            className={
                              active
                                ? "w-5 h-5 text-foreground"
                                : "w-5 h-5 text-foreground/70"
                            }
                          />
                        </span>

                        {/* label uses motion for a smooth fade-in and slide */}
                        <motion.span
                          className="min-w-0 flex-1 truncate leading-5"
                          initial={
                            reduce
                              ? { opacity: 1, x: 0 }
                              : { opacity: 0, x: -6 }
                          }
                          animate={
                            reduce ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }
                          }
                          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -6 }}
                          transition={
                            reduce
                              ? { duration: 0 }
                              : { duration: 0.18, ease: "easeOut" }
                          }
                        >
                          {label}
                        </motion.span>
                      </motion.button>
                    </motion.li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </motion.nav>
    </aside>
  );
};

export default Sidebar;
