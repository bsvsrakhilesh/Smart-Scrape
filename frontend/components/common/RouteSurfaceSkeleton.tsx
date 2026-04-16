import React from "react";
import { BlockSkeleton, ListSkeleton } from "./Skeleton";

type RouteSurfaceSkeletonProps = {
  variant: "workspace" | "notebook";
};

function ToolbarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="h-10 w-44 animate-pulse rounded-2xl bg-white/70" />
      <div className="h-10 w-32 animate-pulse rounded-2xl bg-white/65" />
      <div className="h-10 w-24 animate-pulse rounded-2xl bg-white/60" />
    </div>
  );
}

function PanelCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[24px] border border-white/70 bg-white/75 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur ${className}`}
    >
      {children}
    </section>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6 px-4 py-5 md:px-6 lg:px-8" aria-busy="true">
      <PanelCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-200/80" />
            <div className="h-4 w-[28rem] max-w-full animate-pulse rounded-lg bg-slate-200/70" />
            <div className="h-4 w-[18rem] max-w-full animate-pulse rounded-lg bg-slate-200/60" />
          </div>
          <ToolbarSkeleton />
        </div>
      </PanelCard>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <PanelCard className="min-h-[420px]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="h-6 w-40 animate-pulse rounded-lg bg-slate-200/80" />
            <div className="h-9 w-28 animate-pulse rounded-xl bg-slate-200/70" />
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="h-11 animate-pulse rounded-2xl bg-slate-100/90" />
            <div className="h-11 animate-pulse rounded-2xl bg-slate-100/90" />
            <div className="h-11 animate-pulse rounded-2xl bg-slate-100/90" />
          </div>
          <ListSkeleton rows={8} />
        </PanelCard>

        <div className="space-y-6">
          <PanelCard>
            <div className="mb-4 h-6 w-36 animate-pulse rounded-lg bg-slate-200/80" />
            <BlockSkeleton />
          </PanelCard>
          <PanelCard>
            <div className="mb-4 h-6 w-32 animate-pulse rounded-lg bg-slate-200/80" />
            <ListSkeleton rows={5} />
          </PanelCard>
        </div>
      </div>
    </div>
  );
}

function NotebookSkeleton() {
  return (
    <div
      className="grid h-full min-h-0 grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.2fr)_minmax(320px,0.85fr)] lg:px-6"
      aria-busy="true"
    >
      <PanelCard className="min-h-[280px] lg:min-h-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="h-6 w-32 animate-pulse rounded-lg bg-slate-200/80" />
          <div className="h-9 w-24 animate-pulse rounded-xl bg-slate-200/70" />
        </div>
        <div className="space-y-3">
          <div className="h-11 animate-pulse rounded-2xl bg-slate-100/90" />
          <BlockSkeleton />
          <BlockSkeleton />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100/80" />
        </div>
      </PanelCard>

      <PanelCard className="min-h-[320px] lg:min-h-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="h-6 w-40 animate-pulse rounded-lg bg-slate-200/80" />
          <div className="h-9 w-32 animate-pulse rounded-xl bg-slate-200/70" />
        </div>
        <div className="space-y-4">
          <div className="ml-auto h-20 w-[72%] animate-pulse rounded-[22px] bg-emerald-100/70" />
          <div className="h-24 w-[82%] animate-pulse rounded-[22px] bg-slate-100/90" />
          <div className="ml-auto h-16 w-[64%] animate-pulse rounded-[22px] bg-emerald-100/65" />
          <div className="h-24 w-[78%] animate-pulse rounded-[22px] bg-slate-100/85" />
          <div className="mt-6 h-12 animate-pulse rounded-2xl bg-slate-100/90" />
        </div>
      </PanelCard>

      <PanelCard className="min-h-[280px] lg:min-h-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="h-6 w-36 animate-pulse rounded-lg bg-slate-200/80" />
          <div className="h-9 w-24 animate-pulse rounded-xl bg-slate-200/70" />
        </div>
        <ListSkeleton rows={7} />
      </PanelCard>
    </div>
  );
}

export default function RouteSurfaceSkeleton({
  variant,
}: RouteSurfaceSkeletonProps) {
  if (variant === "notebook") return <NotebookSkeleton />;
  return <WorkspaceSkeleton />;
}
