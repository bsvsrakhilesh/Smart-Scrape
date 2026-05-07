// frontend/App.tsx
import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import AppShell from "./layouts/AppShell";
import Sidebar from "./components/common/Sidebar";
import RouteSurfaceSkeleton from "./components/common/RouteSurfaceSkeleton";

import { Page } from "./lib/types";
import { ToastProvider } from "./components/providers/Toast";
import { ConfirmProvider } from "./components/providers/Confirm";
import { hydrateCollectionsFromBackend } from "./utils/collections";

const DESKTOP_SIDEBAR_STORAGE_KEY = "sidebar.desktop.expanded";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

type WorkspacePage = Exclude<Page, "notebook">;

const loadUrlCollectorPage = () => import("./pages/UrlCollectorPage");
const loadSavedUrlsPage = () => import("./pages/SavedUrlsPage");
const loadFileManagerPage = () => import("./pages/FileManagerPage");
const loadGovernanceWorkspacePage = () =>
  import("./pages/GovernanceWorkspacePage");

const UrlCollectorPage = lazy(loadUrlCollectorPage);
const SavedUrlsPage = lazy(loadSavedUrlsPage);
const FileManagerPage = lazy(loadFileManagerPage);
const GovernanceWorkspacePage = lazy(loadGovernanceWorkspacePage);

const WORKSPACE_PAGE_LOADERS: Record<WorkspacePage, () => Promise<unknown>> = {
  "url-collector": loadUrlCollectorPage,
  "saved-urls": loadSavedUrlsPage,
  "file-manager": loadFileManagerPage,
  "governance-workspace": loadGovernanceWorkspacePage,
};

const WORKSPACE_PAGE_COMPONENTS: Record<WorkspacePage, React.ReactNode> = {
  "url-collector": <UrlCollectorPage />,
  "saved-urls": <SavedUrlsPage />,
  "file-manager": <FileManagerPage />,
  "governance-workspace": <GovernanceWorkspacePage />,
};

const App: React.FC = () => {
  const navigate = useNavigate();

  const { page: routePage } = useParams<{ page?: string }>();

  const workspacePages = useMemo<WorkspacePage[]>(
    () => [
      "url-collector",
      "saved-urls",
      "file-manager",
      "governance-workspace",
    ],
    [],
  );

  const currentWorkspacePage: WorkspacePage = workspacePages.includes(
    routePage as WorkspacePage,
  )
    ? (routePage as WorkspacePage)
    : "url-collector";
  const currentPage: Page = currentWorkspacePage;

  const setCurrentPage = (page: Page) => {
    navigate(`/app/${page}`);
  };

  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  });

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [warmPages, setWarmPages] = useState<Set<WorkspacePage>>(
    () => new Set([currentWorkspacePage]),
  );
  const [paintReadyPages, setPaintReadyPages] = useState<Set<WorkspacePage>>(
    () => new Set(),
  );

  const isSidebarOpen = isDesktopViewport
    ? desktopSidebarOpen
    : mobileSidebarOpen;

  const toggleSidebar = () => {
    if (isDesktopViewport) {
      setDesktopSidebarOpen((v) => !v);
    } else {
      setMobileSidebarOpen((v) => !v);
    }
  };

  // Persist desktop sidebar preference only
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        DESKTOP_SIDEBAR_STORAGE_KEY,
        String(desktopSidebarOpen),
      );
    }
  }, [desktopSidebarOpen]);

  // Track desktop/mobile breakpoint and keep mobile drawer transient
  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);

    const applyViewport = (matches: boolean) => {
      setIsDesktopViewport(matches);
      if (matches) {
        setMobileSidebarOpen(false);
      }
    };

    applyViewport(media.matches);

    const onChange = (e: MediaQueryListEvent) => applyViewport(e.matches);

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  // Keyboard toggle for sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (typing) return;
      if (e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktopViewport]);

  // Hydrate category/collection state from backend once per app load
  useEffect(() => {
    hydrateCollectionsFromBackend();
  }, []);

  useEffect(() => {
    setWarmPages((prev) => {
      if (prev.has(currentWorkspacePage)) return prev;
      const next = new Set(prev);
      next.add(currentWorkspacePage);
      return next;
    });
  }, [currentWorkspacePage]);

  // Warm the other workspace chunks after the active route has had a chance to
  // paint. Returning users get instant navigation without bloating first paint.
  useEffect(() => {
    let cancelled = false;

    const preload = () => {
      for (const page of workspacePages) {
        if (page !== currentWorkspacePage) {
          void WORKSPACE_PAGE_LOADERS[page]().catch(() => undefined);
        }
      }
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(
        () => {
          if (!cancelled) preload();
        },
        { timeout: 2500 },
      );

      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) preload();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentWorkspacePage, workspacePages]);

  // Lightweight first-render polish for cold workspace surfaces only.
  // Once a page has painted, keep its DOM mounted so going back feels instant.
  useEffect(() => {
    if (paintReadyPages.has(currentWorkspacePage)) return;

    let raf1 = 0;
    let raf2 = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setPaintReadyPages((prev) => {
          if (prev.has(currentWorkspacePage)) return prev;
          const next = new Set(prev);
          next.add(currentWorkspacePage);
          return next;
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [currentWorkspacePage, paintReadyPages]);

  const isWorkspacePage = workspacePages.includes(currentWorkspacePage);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell
          sidebar={
            <Sidebar
              isOpen={isSidebarOpen}
              currentPage={currentPage}
              setCurrentPage={(page) => {
                setCurrentPage(page);
                if (!isDesktopViewport) {
                  setMobileSidebarOpen(false);
                }
              }}
              useParentWidth
            />
          }
          sidebarOpen={isSidebarOpen}
          onToggleSidebar={toggleSidebar}
          // Home from /app should go to Landing page
          onNavigateHome={() => navigate("/")}
          hideAmbient={isWorkspacePage}
          variant="workspace"
        >
          {workspacePages.map((page) => {
            if (!warmPages.has(page)) return null;

            const active = page === currentWorkspacePage;
            const ready = paintReadyPages.has(page);

            return (
              <section
                key={page}
                aria-hidden={!active}
                className={active ? "block" : "hidden"}
              >
                {ready ? (
                  <Suspense fallback={<RouteSurfaceSkeleton variant="workspace" />}>
                    {WORKSPACE_PAGE_COMPONENTS[page]}
                  </Suspense>
                ) : (
                  <RouteSurfaceSkeleton variant="workspace" />
                )}
              </section>
            );
          })}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
};

export default App;
