// frontend/layouts/AppShell.tsx
import React from "react";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import Header from "../components/common/Header";

type ShellVariant = "workspace" | "notebook";

type Props = {
  sidebar: React.ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigateHome: () => void;
  children: React.ReactNode;
  hideAmbient?: boolean;
  variant?: ShellVariant;
};

const SIDEBAR_W_OPEN = "250px"; // 250px
const SIDEBAR_W_COLLAPSED = "4.5rem"; // 72px
const SHELL_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
};

export default function AppShell({
  sidebar,
  sidebarOpen,
  onToggleSidebar,
  onNavigateHome,
  children,
  hideAmbient = false,
  variant = "workspace",
}: Props) {
  const sidebarVar = sidebarOpen ? SIDEBAR_W_OPEN : SIDEBAR_W_COLLAPSED;

  const shellClass =
    variant === "notebook"
      ? // Notebook: emerald-tinted canvas, matching its card palette
        "app-shell app-shell--notebook min-h-screen bg-[radial-gradient(circle_at_top,_#ecfdf5,_#e0f2fe_60%,_#f8fafc_95%)]"
      : // Workspace (File Manager, URL Collector, Saved URLs): same airy mint/sky gradient for all
        "app-shell app-shell--workspace min-h-screen bg-[radial-gradient(circle_at_top,_#d2f9e6,_#c9f5ff_45%,_#b7e4ff_85%)]";

  return (
    <div className={shellClass} style={{ ["--sidebar-w" as any]: sidebarVar }}>
      <header className="fixed inset-x-0 top-0 z-50">
        <Header
          onToggleSidebar={onToggleSidebar}
          onNavigateHome={onNavigateHome}
          isSidebarOpen={sidebarOpen}
        />
      </header>

      {/* DESKTOP SIDEBAR */}
      <aside
        className="app-sidebar hidden lg:block fixed left-0 z-40 border-r border-border bg-card/90 supports-[backdrop-filter]:backdrop-blur-md elev-2 transition-[width] duration-200 ease-out will-change-[width]"
        style={{ top: "var(--header-h)", bottom: 0, width: "var(--sidebar-w)" }}
        aria-label="Primary navigation"
      >
        <div className="h-full overflow-y-auto">{sidebar}</div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="min-h-screen pb-8 pt-[var(--header-h)]">
        <div className="app-content app-shell__inner max-w-screen-2xl mx-auto w-full h-full">
          {children}
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
              transition={{ type: "tween", duration: 0.18 }}
              onClick={onToggleSidebar}
            />
            <motion.aside
              className="app-sidebar fixed left-0 top-[var(--header-h)] z-50 h-[calc(100vh-var(--header-h))] w-[18rem] border-r border-border supports-[backdrop-filter]:backdrop-blur-md bg-card/90 elev-2 lg:hidden"
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
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10"
        >
          <motion.div
            className="absolute -top-24 -left-24 w-[40rem] h-[40rem] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, hsl(var(--accent)/.18), transparent 70%)",
            }}
            animate={{ x: [0, 30, -10, 0], y: [0, -20, 15, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute -bottom-24 -right-24 w-[42rem] h-[42rem] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, hsl(var(--info)/.16), transparent 70%)",
            }}
            animate={{ x: [0, -20, 10, 0], y: [0, 15, -10, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>
      )}
    </div>
  );
}
