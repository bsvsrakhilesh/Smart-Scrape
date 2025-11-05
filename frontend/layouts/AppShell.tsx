// frontend/layouts/AppShell.tsx
import React from 'react';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import Header from '../components/common/Header';

type Props = {
  sidebar: React.ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigateHome: () => void;
  children: React.ReactNode;
  /** NEW: turn off animated ambient background + keep shell extra minimal */
  hideAmbient?: boolean;
};

// Gmail-like sizes
const SIDEBAR_W_OPEN = '16rem';       // 256px
const SIDEBAR_W_COLLAPSED = '4.5rem'; // 72px
const HEADER_H = '4rem';              // 64px (base)
const HEADER_H_LG = '72px';           // 72px (lg+)
const SHELL_SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34 };

export default function AppShell({
  sidebar,
  sidebarOpen,
  onToggleSidebar,
  onNavigateHome,
  children,
  hideAmbient = false,
}: Props) {
  const sidebarVar = sidebarOpen ? SIDEBAR_W_OPEN : SIDEBAR_W_COLLAPSED;

  return (
    <div
      className="app-shell min-h-screen w-full bg-background text-foreground selection:bg-accent/30 selection:text-accent-foreground"
      style={{ ['--sidebar-w' as any]: sidebarVar }}
    >
      {/* HEADER: fixed, full width, does NOT move with sidebar */}
      <header className="fixed inset-x-0 top-0 z-50">
        <Header
          onToggleSidebar={onToggleSidebar}
          onNavigateHome={onNavigateHome}
          isSidebarOpen={sidebarOpen}
        />
      </header>

      {/* DESKTOP SIDEBAR */}
      <aside
        className="app-sidebar hidden lg:block fixed left-0 z-40 border-r border-border bg-card"
        style={{ top: HEADER_H_LG, bottom: 0, width: 'var(--sidebar-w)' }}
        aria-label="Primary navigation"
      >
        <div className="h-full overflow-y-auto">{sidebar}</div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="min-h-screen bg-gradient-to-b from-muted/40 to-background" style={{ paddingTop: HEADER_H }}>
      <div className="lg:pl-[var(--sidebar-w)]" style={{ paddingTop: HEADER_H_LG }}>
      <div className="app-content max-w-screen-2xl mx-auto w-full h-full px-4 sm:px-6 lg:px-8">{children}</div>
      </div>
      </main>

      {/* MOBILE SIDEBAR OVERLAY */}
      <AnimatePresence initial={false}>
        {/* eslint-disable-next-line */}
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'tween', duration: 0.18 }}
              onClick={onToggleSidebar}
            />
            <motion.aside
              className="app-sidebar fixed left-0 top-[4rem] z-50 h-[calc(100vh-4rem)] w-[18rem] border-r border-border supports-[backdrop-filter]:backdrop-blur-md bg-card/90 elev-2 lg:hidden"
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={SHELL_SPRING}
            >
              <div className="h-full overflow-y-auto">{sidebar}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Ambient background blobs — hidden for File Manager */}
      {!hideAmbient && (
        <motion.div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <motion.div
            className="absolute -top-24 -left-24 w-[40rem] h-[40rem] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(closest-side, hsl(var(--accent)/.18), transparent 70%)' }}
            animate={{ x: [0, 30, -10, 0], y: [0, -20, 15, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          />
          <motion.div
            className="absolute -bottom-24 -right-24 w-[42rem] h-[42rem] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(closest-side, hsl(var(--info)/.16), transparent 70%)' }}
            animate={{ x: [0, -20, 10, 0], y: [0, 15, -10, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
          />
        </motion.div>
      )}
    </div>
  );
}

