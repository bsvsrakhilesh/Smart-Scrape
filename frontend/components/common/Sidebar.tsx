import React, { useState } from 'react';
import { motion, type Transition, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Page } from '../../types';

// Existing icons (unchanged)
import UrlIcon from '../icons/UrlIcon';
import BookmarkIcon from '../icons/BookmarkIcon';
import FolderIcon from '../icons/FolderIcon';
import BookIcon from '../icons/BookIcon';

interface SidebarProps {
  isOpen: boolean;
  currentPage: Page;
  setCurrentPage: (page: Page) => void;
  useParentWidth?: boolean;
}

/* --------------------------------- NAV DATA -------------------------------- */
const NAV: Array<{ key: Page; label: string; Icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }> = [
  { key: 'url-collector', label: 'URL Collector', Icon: UrlIcon },
  { key: 'saved-urls',    label: 'Saved URLs',    Icon: BookmarkIcon },
  { key: 'file-manager',  label: 'File Manager',  Icon: FolderIcon },
  { key: 'notebook',      label: 'Notebook',      Icon: BookIcon },
];

/* --------------------------------- MOTION ---------------------------------- */
// Softer spring and smaller durations for snappy, refined feel
const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.95 };

/* --------------------------------- STYLES ---------------------------------- */
// stronger glass + depth on hover; accessible focus ring retained
const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-primary/60 focus-visible:border-transparent';
const railTap =
  'group size-11 grid place-items-center rounded-xl transition-[background,transform,box-shadow] duration-200 ' +
  'hover:bg-foreground/8 dark:hover:bg-white/10 ' +
  focusRing +
  ' relative border-transparent';
const listTap =
  'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-[background,transform,box-shadow,color] duration-200 ' +
  'hover:bg-foreground/6/60 dark:hover:bg-white/6 ' +
  focusRing +
  ' backdrop-blur-xs border-transparent';

/* --------------------------------- CONTAINER / ITEM VARIANTS ----------------- */
// Use explicit hidden/visible states so collapsed (icon-only) still shows icons.
const containerVariants = {
  hidden: { transition: { when: 'afterChildren' } },
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, x: -8, transition: { duration: 0.16, ease: 'easeOut' } },
  visible: { opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } },
} as const;

const tooltipVariants = {
  hidden: { opacity: 0, x: -6 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.14, ease: 'easeOut' } },
} as const;

/* --------------------------------- COMPONENT ---------------------------------- */
const Sidebar: React.FC<SidebarProps> = ({ isOpen, currentPage, setCurrentPage, useParentWidth }) => {
  // Fixed widths; sidebar itself animates width (no overlay)
  const COLLAPSED = 84;
  const EXPANDED = 280;

  const nav = NAV; // allow future memoization if NAV becomes dynamic

  const [hoverKey, setHoverKey] = useState<Page | null>(null);
  const reduce = useReducedMotion();

  // small helper classes for active state reused
  const activeRail =
  'bg-gradient-to-br from-foreground/8 to-foreground/5 dark:from-white/8 dark:to-white/5 shadow-[0_10px_24px_rgba(2,6,23,0.06)] ring-0 border-transparent';
const activeList =
  'bg-background/60 dark:bg-background/75 text-foreground font-medium shadow-sm ring-0 border-transparent backdrop-blur-sm';

  return (
    <aside className="app-sidebar h-dvh sticky top-0 z-40 overflow-x-hidden" aria-label="Primary sidebar">
      <motion.nav
        role="navigation"
        aria-orientation="vertical"
        className="h-full flex flex-col bg-background/80 dark:bg-background/85 border-r border-border/60 backdrop-blur-sm rounded-none overflow-hidden"
        initial={false}
        animate={{ width: isOpen ? EXPANDED : COLLAPSED }}
        transition={reduce ? { duration: 0 } : SPRING}
        style={
          useParentWidth
            ? ({
                overflowX: 'hidden',
                ['--sidebar-expanded' as any]: `${EXPANDED}px`,
                ['--sidebar-collapsed' as any]: `${COLLAPSED}px`,
              } as React.CSSProperties)
            : ({
                width: isOpen ? EXPANDED : COLLAPSED,
                overflowX: 'hidden',
                ['--sidebar-expanded' as any]: `${EXPANDED}px`,
                ['--sidebar-collapsed' as any]: `${COLLAPSED}px`,
              } as React.CSSProperties)
        }
      >
        {/* NAV ONLY */}
        <div className="relative flex-1 overflow-hidden">
          {/* Collapsed (icon-only rail) */}
          {!isOpen && (
            <motion.ul
              role="list"
              className="py-3 flex flex-col items-center gap-2"
              variants={containerVariants}
              initial="visible"
              animate="visible"
            >
              {nav.map(({ key, label, Icon }) => {
                const active = currentPage === key;
                return (
                  <motion.li key={key} variants={itemVariants} className="w-full">
                    <motion.button
                      type="button"
                      /* remove `title` to avoid native tooltip / unexpected focus outline */
                      aria-label={label}
                      aria-current={active ? 'page' : undefined}
                      className={[railTap, active ? activeRail : ''].join(' ')}
                      onClick={() => setCurrentPage(key)}
                      onMouseEnter={() => setHoverKey(key)}
                      onMouseLeave={() => setHoverKey(null)}
                      onFocus={() => setHoverKey(key)}
                      onBlur={() => setHoverKey(null)}
                      whileHover={reduce ? undefined : { y: -4, scale: 1.02 }}
                      whileTap={reduce ? undefined : { scale: 0.985 }}
                      transition={reduce ? { duration: 0 } : SPRING}
                    >
                      {/* icon container: remove heavy background/border and use subtle elevated pill */}
                      <span
                        className={[

                          'grid place-items-center size-9 rounded-lg transition-transform',
                          'bg-transparent',
                          active ? 'scale-105 shadow-sm bg-foreground/7 dark:bg-white/6 rounded-md' : 'group-hover:bg-foreground/6/10 dark:group-hover:bg-white/8',
                        ].join(' ')}
                      >
                        <Icon aria-hidden className={active ? 'w-5 h-5 text-foreground' : 'w-5 h-5 text-foreground/70'} />
                      </span>

                      {/* Tooltip visible only in collapsed state; uses AnimatePresence + reduced motion handling */}
                      <AnimatePresence>
                        {hoverKey === key && (
                          <motion.span
                            role="tooltip"
                            initial={reduce ? { opacity: 1, x: 0 } : 'hidden'}
                            animate={reduce ? { opacity: 1, x: 0 } : 'visible'}
                            exit={reduce ? { opacity: 0 } : 'hidden'}
                            variants={tooltipVariants}
                            className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 rounded-md bg-background/95 dark:bg-background/90 px-3 py-1 text-xs shadow-lg text-foreground/90 ring-1 ring-border/30"
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
                className="px-2 py-3 space-y-1"
                initial="hidden"
                animate="visible"
                exit="hidden"
                variants={containerVariants}
              >
                {nav.map(({ key, label, Icon }) => {
                  const active = currentPage === key;
                  return (
                    <motion.li key={key} variants={itemVariants}>
                      <motion.button
                        type="button"
                        className={[
                          listTap,
                          active ? activeList : 'text-foreground/80',
                          'hover:translate-y-[-2px] relative overflow-hidden',
                        ].join(' ')}
                        onClick={() => setCurrentPage(key)}
                        aria-current={active ? 'page' : undefined}
                        whileHover={reduce ? undefined : { y: -3, boxShadow: '0 12px 30px rgba(2,6,23,0.06)' }}
                        whileTap={reduce ? undefined : { scale: 0.985 }}
                        transition={reduce ? { duration: 0 } : SPRING}
                      >
                        {/* Active accent bar on left for visual flair (subtle, not boxy) */}
                        <span
                          aria-hidden
                          className={[
                            'absolute left-0 top-2 bottom-2 w-1 rounded-r-md transition-opacity duration-200',
                            active ? 'opacity-100 bg-gradient-to-b from-brand-primary to-brand-secondary' : 'opacity-0',
                          ].join(' ')}
                        />

                        <span
                          className={[
                            'shrink-0 grid place-items-center size-9 rounded-lg transition-all',
                            active ? 'bg-foreground/12 dark:bg-white/12 transform scale-105' : 'bg-foreground/5 dark:bg-white/10',
                          ].join(' ')}
                        >
                          <Icon aria-hidden className={active ? 'w-5 h-5 text-foreground' : 'w-5 h-5 text-foreground/70'} />
                        </span>

                        {/* label uses motion for a smooth fade-in and slide */}
                        <motion.span
                          className="truncate"
                          initial={reduce ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
                          animate={reduce ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -6 }}
                          transition={reduce ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
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
