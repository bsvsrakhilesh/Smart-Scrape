import React, { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useDialogA11y } from "../common/useDialogA11y";

import { FileItem } from "../../lib/types";
import { formatBytes } from "../../utils/fileHelpers";

import StructuredTags from "../common/StructuredTags";
import { canRetryAiTag, getAiTagUiSummary } from "../../lib/aiTagUi";

type PropertiesModalProps = {
  file: FileItem | null;
  isOpen: boolean;
  onClose: () => void;
  onRefreshMetadata: (fileId: string) => Promise<void>;
  onRetryAiTag?: (file: FileItem) => Promise<void> | void;
};

const sectionClass =
  "rounded-3xl border border-[hsl(var(--border))] bg-white/70 p-5 shadow-sm backdrop-blur-sm dark:bg-white/[0.04]";

const labelClass =
  "text-xs font-semibold uppercase tracking-[0.14em] text-muted";
const strongValueClass = "break-words text-sm text-foreground";
const monoValueClass = "break-words font-mono text-xs text-foreground";

function displayText(value: unknown, fallback = "—") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function formatDateTime(value?: string | null, fallback = "—") {
  if (!value) return fallback;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return fallback;
  return time.toLocaleString();
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "success" | "progress" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
      : tone === "progress"
        ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {label}
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-black/[0.025] px-4 py-3 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        <span className="text-foreground/70">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 break-words text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  copyValue,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyValue?: string | null;
  href?: string | null;
}) {
  const textNode =
    href && value !== "—" ? (
      <a
        className="inline-flex items-start gap-2 underline decoration-current/30 underline-offset-4"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        <span className={mono ? monoValueClass : strongValueClass}>
          {value}
        </span>
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
      </a>
    ) : (
      <span className={mono ? monoValueClass : strongValueClass}>{value}</span>
    );

  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-start">
      <div className={labelClass}>{label}</div>
      <div className="min-w-0">{textNode}</div>
      {copyValue && copyValue !== "—" ? (
        <CopyButton value={copyValue} />
      ) : (
        <span />
      )}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="btn-ghost h-8 self-start px-3 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {}
      }}
      title="Copy"
    >
      <Copy className="mr-1.5 h-3.5 w-3.5" />
      Copy
    </button>
  );
}

const PropertiesModal: React.FC<PropertiesModalProps> = ({
  file,
  isOpen,
  onClose,
  onRefreshMetadata,
  onRetryAiTag,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRetryingTag, setIsRetryingTag] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDialogA11y({
    isOpen,
    onClose,
    dialogRef,
    initialFocusRef: closeBtnRef,
    closeOnEsc: true,
    closeOnOutsideClick: true,
  });

  if (!isOpen || !file || typeof document === "undefined") return null;

  const fileLabel =
    displayText(file.title) ||
    displayText((file as any).fileName) ||
    displayText((file as any).name) ||
    "Untitled file";

  const aiSummary = getAiTagUiSummary(file);
  const canRetryAiTagNow = canRetryAiTag(file);

  const taggingLabel = aiSummary.label;
  const taggingTone =
    aiSummary.tone === "success"
      ? "success"
      : aiSummary.tone === "progress"
        ? "progress"
        : aiSummary.tone === "danger"
          ? "danger"
          : "neutral";

  const basicRows = [
    { label: "Name", value: fileLabel },
    { label: "Type", value: displayText(file.mimeType, "Unknown") },
    {
      label: "Description",
      value: displayText(file.description, "—"),
    },
    {
      label: "Visibility",
      value:
        file.visibility === "public"
          ? "Public"
          : file.visibility === "private"
            ? "Private"
            : "—",
    },
    {
      label: "Tags",
      value:
        Array.isArray(file.tags) && file.tags.length
          ? file.tags.join(", ")
          : "None",
    },
  ];

  const provenanceRows = [
    { label: "Capture type", value: displayText(file.captureType, "—") },
    {
      label: "Source URL",
      value: displayText(file.sourceUrl, "—"),
      href: file.sourceUrl || null,
      copyValue: file.sourceUrl || null,
    },
    {
      label: "Published",
      value: formatDateTime(file.sourcePublishedAt, "—"),
    },
    {
      label: "Authors",
      value:
        Array.isArray(file.sourceAuthors) && file.sourceAuthors.length
          ? file.sourceAuthors.join(", ")
          : "—",
    },
    {
      label: "URL ID",
      value: file.urlId != null ? String(file.urlId) : "—",
      mono: true,
      copyValue: file.urlId != null ? String(file.urlId) : null,
    },
    {
      label: "SHA-256",
      value: displayText(file.sha256, "—"),
      mono: true,
      copyValue: file.sha256 || null,
    },
    {
      label: "Normalized content SHA-256",
      value: displayText(file.contentHash, "—"),
      mono: true,
      copyValue: file.contentHash || null,
    },
    {
      label: "Tagger version",
      value: displayText(file.taggerVersion, "—"),
      mono: true,
      copyValue: file.taggerVersion || null,
    },
    {
      label: "Capture method",
      value: displayText(file.captureMeta?.method, "—"),
    },
    {
      label: "Captured URL",
      value: displayText(file.captureMeta?.capturedUrl, "—"),
      href: file.captureMeta?.capturedUrl || null,
      copyValue: file.captureMeta?.capturedUrl || null,
    },
    {
      label: "Bytes captured",
      value:
        typeof file.captureMeta?.bytes === "number"
          ? formatBytes(file.captureMeta.bytes)
          : "—",
    },
  ];

  const advancedRows = [
    {
      label: "Document ID",
      value: displayText(
        file.document?.id ?? file.documentRevision?.documentId,
        "—",
      ),
      mono: true,
    },
    {
      label: "Document kind",
      value: displayText(file.document?.kind, "—"),
    },
    {
      label: "Revision ID",
      value: displayText(file.documentRevision?.id, "—"),
      mono: true,
    },
    {
      label: "Revision ordinal",
      value:
        typeof file.documentRevision?.ordinal === "number"
          ? String(file.documentRevision.ordinal)
          : "—",
      mono: true,
    },
    {
      label: "Revision created",
      value: formatDateTime(file.documentRevision?.createdAt, "—"),
    },
    {
      label: "Capture event ID",
      value: displayText(file.captureEvent?.id, "—"),
      mono: true,
    },
    {
      label: "Capture event time",
      value: formatDateTime(file.captureEvent?.createdAt, "—"),
    },
    {
      label: "Request ID",
      value: displayText(file.captureEvent?.requestId, "—"),
      mono: true,
    },
    {
      label: "Actor",
      value: displayText(
        file.captureEvent?.actorName ?? file.captureEvent?.actorId,
        "—",
      ),
    },
    {
      label: "Pipeline",
      value: file.captureEvent?.pipelineConfig
        ? `${file.captureEvent.pipelineConfig.name} @ ${file.captureEvent.pipelineConfig.version}`
        : "—",
    },
    {
      label: "Pipeline configHash",
      value: displayText(file.captureEvent?.pipelineConfig?.configHash, "—"),
      mono: true,
    },
    {
      label: "Pipeline codeSha",
      value: displayText(file.captureEvent?.pipelineConfig?.codeSha, "—"),
      mono: true,
    },
  ];

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[130] bg-slate-950/60 backdrop-blur-[3px]"
      />

      <div className="fixed inset-0 z-[131] flex items-center justify-center p-4 md:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-[0_28px_90px_rgba(15,23,42,0.35)]"
        >
          <div className="border-b border-[hsl(var(--border))] bg-[color-mix(in_oklab,hsl(var(--surface))_92%,transparent)] px-6 py-5 backdrop-blur-md">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                  File details
                </div>
                <h3
                  id={titleId}
                  className="mt-1 text-2xl font-semibold tracking-tight text-foreground"
                >
                  Properties
                </h3>
                <p
                  id={descriptionId}
                  className="mt-2 max-w-3xl truncate text-sm text-muted"
                  title={fileLabel}
                >
                  {fileLabel}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
                <button
                  type="button"
                  className="btn px-4 text-sm"
                  disabled={isRefreshing}
                  onClick={async () => {
                    try {
                      setIsRefreshing(true);
                      await onRefreshMetadata(String(file.id));
                    } finally {
                      setIsRefreshing(false);
                    }
                  }}
                  title="Re-extract published date and author(s)"
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                  />
                  {isRefreshing ? "Refreshing…" : "Refresh metadata"}
                </button>

                <button
                  ref={closeBtnRef}
                  type="button"
                  className="btn-ghost inline-flex items-center gap-2 px-3 text-sm"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                  Close
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="space-y-6">
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Type"
                  value={displayText(file.mimeType, "Unknown")}
                />
                <SummaryCard
                  icon={<Hash className="h-3.5 w-3.5" />}
                  label="Size"
                  value={
                    typeof file.size === "number"
                      ? formatBytes(file.size)
                      : "Unknown"
                  }
                />
                <SummaryCard
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                  label="Modified"
                  value={formatDateTime(file.uploadDate, "Unknown")}
                />
                <SummaryCard
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  label="Visibility"
                  value={
                    file.visibility === "public"
                      ? "Public"
                      : file.visibility === "private"
                        ? "Private"
                        : "—"
                  }
                />
              </section>

              <section className={sectionClass}>
                <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-base font-semibold text-foreground">
                      Basic information
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      Core file details and user-facing metadata
                    </div>
                  </div>

                  <StatusBadge label={taggingLabel} tone={taggingTone} />
                </div>

                <div className="mt-2 divide-y divide-[hsl(var(--border))]">
                  {basicRows.map((row) => (
                    <InfoRow
                      key={row.label}
                      label={row.label}
                      value={row.value}
                    />
                  ))}
                </div>

                {Array.isArray(file.tags) && file.tags.length > 0 ? (
                  <div className="mt-5 rounded-2xl border border-[hsl(var(--border))] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
                    <div className={labelClass}>Tag chips</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {file.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-[hsl(var(--border))] bg-white/80 px-2.5 py-1 text-xs text-foreground dark:bg-white/[0.04]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={sectionClass}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                      <Bot className="h-4 w-4" />
                      AI tagging
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      Background extraction status for evidence labels and
                      structured metadata
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canRetryAiTagNow && onRetryAiTag ? (
                      <button
                        type="button"
                        className="btn-ghost h-8 px-3 text-xs"
                        disabled={isRetryingTag}
                        onClick={async () => {
                          try {
                            setIsRetryingTag(true);
                            await onRetryAiTag(file);
                          } finally {
                            setIsRetryingTag(false);
                          }
                        }}
                        title="Retry AI extraction for this file"
                      >
                        {isRetryingTag ? "Retrying…" : "Retry AI extraction"}
                      </button>
                    ) : null}

                    <StatusBadge label={taggingLabel} tone={taggingTone} />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className={labelClass}>Status</div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {taggingLabel}
                        </div>
                      </div>
                      <div>
                        <div className={labelClass}>Job ID</div>
                        <div className="mt-1 break-words font-mono text-xs text-foreground">
                          {displayText(file.taggingJobId, "—")}
                        </div>
                      </div>
                      <div>
                        <div className={labelClass}>Stage</div>
                        <div className="mt-1 text-sm text-foreground">
                          {displayText((file as any).aiTagJobStage, "—")}
                        </div>
                      </div>
                      <div>
                        <div className={labelClass}>Attempt</div>
                        <div className="mt-1 text-sm text-foreground">
                          {(file as any).aiTagJobAttempt != null
                            ? String((file as any).aiTagJobAttempt)
                            : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-muted">
                        <span>Progress</span>
                        <span>
                          {(file as any).aiTagJobProgress != null
                            ? `${Math.round((file as any).aiTagJobProgress)}%`
                            : "—"}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all"
                          style={{
                            width:
                              typeof (file as any).aiTagJobProgress === "number"
                                ? `${Math.max(
                                    0,
                                    Math.min(
                                      100,
                                      (file as any).aiTagJobProgress,
                                    ),
                                  )}%`
                                : "0%",
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-white/80 p-3 text-sm text-foreground dark:bg-white/[0.03]">
                      {(file as any).aiTagJobMessage ||
                        aiSummary.detail ||
                        "No active AI runtime details"}
                    </div>

                    {(file as any).aiTagJobCached ? (
                      <div className="mt-3 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                        Cached result
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
                    <div className={labelClass}>Last error</div>
                    <div className="mt-2 break-words whitespace-pre-wrap text-sm text-foreground">
                      {displayText(file.taggingError, "—")}
                    </div>
                  </div>
                </div>
              </section>

              <section className={sectionClass}>
                <div className="text-base font-semibold text-foreground">
                  Structured tags
                </div>
                <div className="mt-1 text-sm text-muted">
                  Extracted structured signals from the tagger pipeline
                </div>

                <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
                  <StructuredTags
                    structured={
                      (file as any)?.tagsMetaRaw?.tagger?.structured ??
                      (file as any)?.tagsMetaRaw?.aiTagger?.structured ??
                      null
                    }
                    tagDetails={
                      (file as any)?.tagsMetaRaw?.tagger?.aiTagObjects ??
                      (file as any)?.tagsMetaRaw?.aiTagger?.tagObjects ??
                      null
                    }
                  />
                </div>
              </section>

              <section className={sectionClass}>
                <div className="text-base font-semibold text-foreground">
                  Provenance
                </div>
                <div className="mt-1 text-sm text-muted">
                  Source, capture, hashing, and publication lineage
                </div>

                <div className="mt-3 divide-y divide-[hsl(var(--border))]">
                  {provenanceRows.map((row) => (
                    <InfoRow
                      key={row.label}
                      label={row.label}
                      value={row.value}
                      mono={Boolean((row as any).mono)}
                      copyValue={(row as any).copyValue ?? null}
                      href={(row as any).href ?? null}
                    />
                  ))}
                </div>

                <details className="mt-5 rounded-2xl border border-[hsl(var(--border))] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
                  <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                    <span className="inline-flex items-center gap-2">
                      Advanced provenance
                    </span>
                  </summary>

                  <div className="mt-4 divide-y divide-[hsl(var(--border))]">
                    {advancedRows.map((row) => (
                      <InfoRow
                        key={row.label}
                        label={row.label}
                        value={row.value}
                        mono={Boolean((row as any).mono)}
                        copyValue={row.value !== "—" ? row.value : null}
                      />
                    ))}
                  </div>
                </details>

                {file.tagsMetaRaw ? (
                  <details className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
                    <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                      Raw metadata
                    </summary>
                    <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-[hsl(var(--border))] bg-slate-950/95 p-4 text-xs text-slate-100">
                      {JSON.stringify(file.tagsMetaRaw, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default PropertiesModal;
