import React, { useState } from 'react';
import { motion, type Transition, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Page } from '../../types';
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
const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.95 };

/* --------------------------------- STYLES ---------------------------------- */
// stronger glass + depth on hover; accessible focus ring retained
const railTap =
  'group relative size-11 grid place-items-center rounded-xl border border-transparent bg-background/70 ' +
  'shadow-sm hover:shadow-lg hover:-translate-y-[2px] hover:bg-background/90 ' +
  'transition-all duration-200 ease-out hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60';

const listTap =
  'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-foreground/80 ' +
  'transition-all duration-200 ease-out hover-lift hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-primary/60';

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

/* --------------------------------- COMPONENT ---------------------------------- */
const Sidebar: React.FC<SidebarProps> = ({ isOpen, currentPage, setCurrentPage, useParentWidth }) => {
  // Fixed widths; sidebar itself animates width (no overlay)
  const COLLAPSED = 72;
  const EXPANDED = 250;

  const nav = NAV; // allow future memoization if NAV becomes dynamic

  const [hoverKey, setHoverKey] = useState<Page | null>(null);
  const reduce = useReducedMotion();

  // Small helper classes for active state + a reusable glass panel token
  const glassPanel =
    'bg-background/80 backdrop-blur-2xl border border-white/10 dark:border-white/5 shadow-[0_18px_45px_rgba(15,23,42,0.30)]';

  const activeRail =
    'border-brand-primary/40 bg-gradient-to-br from-brand-primary/20 via-brand-secondary/20 to-brand-primary/10 shadow-[0_14px_38px_rgba(15,23,42,0.35)]';

  const activeList =
    'text-foreground border border-brand-primary/35 bg-gradient-to-r from-brand-primary/18 via-brand-secondary/15 to-brand-primary/8 shadow-[0_14px_40px_rgba(15,23,42,0.30)]';

  return (
    <aside className="h-full z-40 p-[1px] rounded-2xl bg-[linear-gradient(145deg,rgba(148,163,184,0.36),rgba(226,232,240,0.14),rgba(148,163,184,0.30))] overflow-x-hidden" aria-label="Primary sidebar">
      <motion.nav
        role="navigation"
        aria-orientation="vertical"
        className={`h-full flex flex-col gap-3 px-3 py-3 data-[sidebar-collapsed=true]:items-center rounded-2xl ${glassPanel}`}
        initial={false}
        animate={{ width: isOpen ? EXPANDED : COLLAPSED }}
        transition={reduce ? { duration: 0 } : SPRING}
        style={
          useParentWidth
            ? ({
                // allow horizontal overflow for tooltips when collapsed, hide vertical scrollbar
                overflowX: 'hidden',
                overflowY: isOpen ? 'auto' : 'hidden',
                ['--sidebar-expanded' as any]: `${EXPANDED}px`,
                ['--sidebar-collapsed' as any]: `${COLLAPSED}px`,
              } as React.CSSProperties)
            : ({
                width: isOpen ? EXPANDED : COLLAPSED,
                // allow horizontal overflow for tooltips when collapsed, hide vertical scrollbar
                overflowX: 'hidden' ,
                overflowY: isOpen ? 'auto' : 'hidden',
                ['--sidebar-expanded' as any]: `${EXPANDED}px`,
                ['--sidebar-collapsed' as any]: `${COLLAPSED}px`,
              } as React.CSSProperties)
        }
      >
      {/* NAV ONLY */}
      <div className="relative flex-1 overflow-hidden w-full">
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
                <motion.li key={key} variants={itemVariants} className="w-auto self-center">
                  <motion.button
                    type="button"
                    title={!isOpen ? label : undefined}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className={[railTap, active ? activeRail : '', 'mx-auto'].join(' ')}
                    onClick={() => setCurrentPage(key)}
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
                      'grid place-items-center size-9 rounded-lg transition-all',
                      active
                        ? 'ring-1 ring-brand-primary/40 bg-white/60 dark:bg-white/10 shadow-sm scale-105'
                        : 'ring-0 bg-white/5 dark:bg-white/5 group-hover:ring-1 group-hover:ring-white/15',
                    ].join(' ')}
                  >
                  <Icon aria-hidden className={active ? 'w-5 h-5 text-foreground' : 'w-5 h-5 text-foreground/70'} />
                  </span>

                  {/* Tooltip visible only in collapsed state; absolutely positioned to avoid layout shifts */}
                  <AnimatePresence>
                    {hoverKey === key && (
                      <motion.span
                        className="absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-xl bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg ring-1 ring-black/5 pointer-events-none"
                        initial={reduce ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
                        animate={reduce ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, x: -6 }}
                        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
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
                      <span
                        className={[
                          'shrink-0 grid place-items-center size-9 rounded-lg transition-all',
                          active
                            ? 'ring-1 ring-brand-primary/40 bg-white/60 dark:bg-white/10 shadow-sm scale-105'
                            : 'ring-0 bg-white/5 dark:bg-white/5 group-hover:ring-1 group-hover:ring-white/15',
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
