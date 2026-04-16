import React, { useEffect } from "react";
import "./styles.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import NotebookStandalonePage from "./pages/NotebookStandalonePage";
import NotFoundPage from "./pages/NotFoundPage";
import RouteErrorBoundary from "./components/common/RouteErrorBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerAppNavigate } from "./lib/navigation";
import {
  installGlobalClientErrorHandlers,
  reportClientEvent,
} from "./lib/clientTelemetry";

const queryClient = new QueryClient();

function NavigationRegistrar() {
  const navigate = useNavigate();

  useEffect(() => {
    registerAppNavigate(navigate);
    return () => registerAppNavigate(null);
  }, [navigate]);

  return null;
}

function ClientRuntimeObserver() {
  const location = useLocation();

  useEffect(() => {
    installGlobalClientErrorHandlers();
  }, []);

  useEffect(() => {
    const path = `${location.pathname}${location.search}${location.hash}`;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    let raf1 = 0;
    let raf2 = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const endedAt =
          typeof performance !== "undefined" ? performance.now() : Date.now();

        let navType: string | null = null;
        try {
          const navEntry = performance.getEntriesByType?.("navigation")?.[0] as
            | PerformanceNavigationTiming
            | undefined;
          navType = navEntry?.type ?? null;
        } catch {
          navType = null;
        }

        reportClientEvent("route:view", {
          path,
          pathname: location.pathname,
          search: location.search || "",
          hash: location.hash || "",
          title: typeof document !== "undefined" ? document.title : "",
          paintMs: Math.round(endedAt - startedAt),
          navType,
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [location.pathname, location.search, location.hash]);

  return null;
}

const WORKSPACE_PAGES = new Set([
  "url-collector",
  "saved-urls",
  "file-manager",
  "governance-workspace",
]);

function AppRoute() {
  const { page } = useParams<{ page?: string }>();

  if (!page) {
    return <Navigate to="/app/url-collector" replace />;
  }

  if (!WORKSPACE_PAGES.has(page)) {
    return <NotFoundPage />;
  }

  return <App />;
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NavigationRegistrar />
        <ClientRuntimeObserver />
        <Routes>
          <Route
            path="/"
            element={
              <RouteErrorBoundary area="landing">
                <LandingPage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/app"
            element={<Navigate to="/app/url-collector" replace />}
          />
          <Route
            path="/app/:page"
            element={
              <RouteErrorBoundary area="workspace">
                <AppRoute />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/notebook"
            element={
              <RouteErrorBoundary area="notebook">
                <NotebookStandalonePage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="*"
            element={
              <RouteErrorBoundary area="route">
                <NotFoundPage />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
