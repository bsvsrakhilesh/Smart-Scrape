import React from "react";
import "./styles.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import NotebookStandalonePage from "./pages/NotebookStandalonePage";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
