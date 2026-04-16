import React from "react";
import { AlertTriangle, BookOpen, Home, RefreshCw } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

type BoundaryArea = "landing" | "workspace" | "notebook" | "route";

type RouteErrorBoundaryProps = {
  children: React.ReactNode;
  area?: BoundaryArea;
};

type RouteErrorBoundaryInnerProps = RouteErrorBoundaryProps & {
  resetKey: string;
  path: string;
};

type RouteErrorBoundaryState = {
  error: Error | null;
};

function RecoveryScreen({
  area,
  path,
  error,
  onRetry,
}: {
  area: BoundaryArea;
  path: string;
  error: Error | null;
  onRetry: () => void;
}) {
  const title =
    area === "notebook"
      ? "Notebook hit an unexpected error"
      : area === "workspace"
        ? "Workspace hit an unexpected error"
        : area === "landing"
          ? "This page hit an unexpected error"
          : "Something went wrong on this route";

  const description =
    area === "notebook"
      ? "Your notebook session is still available, but this view failed to render correctly."
      : area === "workspace"
        ? "One of the app surfaces failed to render. You can retry or return to a stable entry point."
        : "This route failed to render. You can retry or navigate back to a known-good page.";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
        <div className="w-full rounded-3xl border border-white/70 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.10)] backdrop-blur xl:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            Recoverable application error
          </div>

          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
            {title}
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            {description}
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Route
            </div>
            <div className="mt-2 break-all font-mono text-sm text-slate-800">
              {path}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
                Error
              </div>
              <div className="mt-2 break-words font-mono text-sm text-rose-900">
                {error.message || "Unknown render error"}
              </div>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>

            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <Home className="h-4 w-4" />
              Go to Home
            </Link>

            <Link
              to="/app/url-collector"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <Home className="h-4 w-4" />
              Open App
            </Link>

            <Link
              to="/notebook"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <BookOpen className="h-4 w-4" />
              Open Notebook
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

class RouteErrorBoundaryInner extends React.Component<
  RouteErrorBoundaryInnerProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Route render error:", {
      area: this.props.area ?? "route",
      path: this.props.path,
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryInnerProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <RecoveryScreen
          area={this.props.area ?? "route"}
          path={this.props.path}
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

export default function RouteErrorBoundary({
  children,
  area = "route",
}: RouteErrorBoundaryProps) {
  const location = useLocation();
  const path = `${location.pathname}${location.search}${location.hash}`;
  const resetKey = path;

  return (
    <RouteErrorBoundaryInner area={area} path={path} resetKey={resetKey}>
      {children}
    </RouteErrorBoundaryInner>
  );
}
