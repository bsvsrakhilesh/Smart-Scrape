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
} from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import NotebookStandalonePage from "./pages/NotebookStandalonePage";

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
          <Route path="/app/:page" element={<App />} />
          <Route path="/notebook" element={<NotebookStandalonePage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
