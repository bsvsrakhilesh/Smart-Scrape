import React, { useEffect } from "react";
import "./styles.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import NotebookStandalonePage from "./pages/NotebookStandalonePage";
import NotFoundPage from "./pages/NotFoundPage";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerAppNavigate } from "./lib/navigation";

const queryClient = new QueryClient();

function NavigationRegistrar() {
  const navigate = useNavigate();

  useEffect(() => {
    registerAppNavigate(navigate);
    return () => registerAppNavigate(null);
  }, [navigate]);

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
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/app"
            element={<Navigate to="/app/url-collector" replace />}
          />
          <Route path="/app/:page" element={<AppRoute />} />
          <Route path="/notebook" element={<NotebookStandalonePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
