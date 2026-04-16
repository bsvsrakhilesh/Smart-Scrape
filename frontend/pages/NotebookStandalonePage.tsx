import { useEffect, useState } from "react";
import NotebookTopNav from "../components/notebook/NotebookTopNav";
import RouteSurfaceSkeleton from "../components/common/RouteSurfaceSkeleton";
import NotebookPage from "./NotebookPage";
import { ToastProvider } from "../components/providers/Toast";
import { ConfirmProvider } from "../components/providers/Confirm";

export default function NotebookStandalonePage() {
  const [isRouteContentReady, setIsRouteContentReady] = useState(false);
  // Always start at the top when opening the Notebook route.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("nb-lock-scroll");
    return () => root.classList.remove("nb-lock-scroll");
  }, []);

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
  }, []);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div
          className="h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top,_#ecfdf5,_#e0f2fe_60%,_#f8fafc_95%)]"
          style={{ ["--sidebar-w" as any]: "0px" }}
        >
          <header className="fixed inset-x-0 top-0 z-50">
            <NotebookTopNav />
          </header>

          {/* Fill the viewport under the fixed header */}
          <main className="h-full pt-[var(--header-h)] overflow-hidden">
            <div className="app-content app-shell__inner max-w-screen-2xl mx-auto w-full h-full">
              {isRouteContentReady ? (
                <NotebookPage />
              ) : (
                <RouteSurfaceSkeleton variant="notebook" />
              )}
            </div>
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
