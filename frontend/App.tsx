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

const UrlCollectorPage = lazy(() => import("./pages/UrlCollectorPage"));
const SavedUrlsPage = lazy(() => import("./pages/SavedUrlsPage"));
const FileManagerPage = lazy(() => import("./pages/FileManagerPage"));
const GovernanceWorkspacePage = lazy(
  () => import("./pages/GovernanceWorkspacePage"),
);

const App: React.FC = () => {
  const navigate = useNavigate();

  const { page: routePage } = useParams<{ page?: string }>();

  const workspacePages = useMemo<Page[]>(
    () => [
      "url-collector",
      "saved-urls",
      "file-manager",
      "governance-workspace",
    ],
    [],
  );

  const currentPage: Page = workspacePages.includes(routePage as Page)
    ? (routePage as Page)
    : "url-collector";

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
  const [isRouteContentReady, setIsRouteContentReady] = useState(false);

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

  // Lightweight first-render polish for heavy workspace surfaces.
  // Two RAFs avoids flashing the skeleton for already-painted layouts while
  // still giving the route a polished loading state on cold entry.
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;

    setIsRouteContentReady(false);

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setIsRouteContentReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [currentPage]);

  const renderPages = () => {
    if (currentPage === "url-collector") return <UrlCollectorPage />;
    if (currentPage === "saved-urls") return <SavedUrlsPage />;
    if (currentPage === "file-manager") return <FileManagerPage />;
    if (currentPage === "governance-workspace") {
      return <GovernanceWorkspacePage />;
    }

    return null;
  };

  const isWorkspacePage = workspacePages.includes(currentPage);

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
          {isRouteContentReady ? (
            <Suspense fallback={<RouteSurfaceSkeleton variant="workspace" />}>
              {renderPages()}
            </Suspense>
          ) : (
            <RouteSurfaceSkeleton variant="workspace" />
          )}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
};

export default App;
