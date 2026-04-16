import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, BookOpen, Home, SearchX } from "lucide-react";

const NotFoundPage: React.FC = () => {
  const location = useLocation();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
        <div className="w-full rounded-3xl border border-white/70 bg-white/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.10)] backdrop-blur xl:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
            <SearchX className="h-4 w-4" />
            404 · Page not found
          </div>

          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
            This page doesn’t exist in Smart Scrape
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            The link may be outdated, incomplete, or typed incorrectly. Use one
            of the entry points below to get back to a valid workflow.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Requested path
            </div>
            <div className="mt-2 break-all font-mono text-sm text-slate-800">
              {location.pathname}
              {location.search}
              {location.hash}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <Home className="h-4 w-4" />
              Go to Home
            </Link>

            <Link
              to="/app/url-collector"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
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
};

export default NotFoundPage;