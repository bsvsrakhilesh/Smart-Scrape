// frontend/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import AppShell from "./layouts/AppShell";
import Sidebar from "./components/common/Sidebar";

import UrlCollectorPage from "./pages/UrlCollectorPage";
import SavedUrlsPage from "./pages/SavedUrlsPage";
import FileManagerPage from "./pages/FileManagerPage";
import GovernanceWorkspacePage from "./pages/GovernanceWorkspacePage";

import { Page } from "./lib/types";
import { ToastProvider } from "./components/providers/Toast";
import { ConfirmProvider } from "./components/providers/Confirm";
import { hydrateCollectionsFromBackend } from "./utils/collections";

const STORAGE_KEY = "sidebar.expanded";

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

  // Initialize from localStorage (default true)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  });

  // Persist sidebar state
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(isSidebarOpen));
    }
  }, [isSidebarOpen]);

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
        setIsSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hydrate category/collection state from backend once per app load
  useEffect(() => {
    hydrateCollectionsFromBackend();
  }, []);

  const renderPages = () => (
    <>
      <div
        style={{ display: currentPage === "url-collector" ? "block" : "none" }}
      >
        <UrlCollectorPage />
      </div>

      {currentPage === "saved-urls" && <SavedUrlsPage />}
      {currentPage === "file-manager" && <FileManagerPage />}
      {currentPage === "governance-workspace" && <GovernanceWorkspacePage />}
    </>
  );

  const isWorkspacePage = workspacePages.includes(currentPage);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell
          sidebar={
            <Sidebar
              isOpen={isSidebarOpen}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              useParentWidth
            />
          }
          sidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
          // Home from /app should go to Landing page
          onNavigateHome={() => navigate("/")}
          hideAmbient={isWorkspacePage}
          variant="workspace"
        >
          {renderPages()}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
};

export default App;
