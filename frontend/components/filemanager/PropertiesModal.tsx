import React, { useRef } from "react";
import { useDialogA11y } from "../common/useDialogA11y";

import { FileItem } from "../../lib/types";
import { formatBytes } from "../../utils/fileHelpers";

type PropertiesModalProps = {
  file: FileItem | null;
  isOpen: boolean;
  onClose: () => void;
};

const PropertiesModal: React.FC<PropertiesModalProps> = ({
  file,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !file) return null;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useDialogA11y({
    isOpen,
    onClose,
    dialogRef: dialogRef as any,
    initialFocusRef: closeBtnRef as any,
    closeOnEsc: true,
    closeOnOutsideClick: true,
  });

  const basic = [
    { label: "Name", value: file.title },
    { label: "Type", value: file.mimeType || "Unknown" },
    { label: "Size", value: file.size ? formatBytes(file.size) : "Unknown" },
    {
      label: "Date Modified",
      value: file.uploadDate
        ? new Date(file.uploadDate).toLocaleString()
        : "Unknown",
    },
    { label: "Visibility", value: file.visibility || "Private" },
    { label: "Tags", value: Array.isArray(file.tags) ? file.tags : [] },
  ];

  const provenance = [
    { label: "Capture type", value: file.captureType || "—" },
    { label: "Source URL", value: file.sourceUrl || "—" },
    { label: "URL ID", value: file.urlId != null ? String(file.urlId) : "—" },
    { label: "SHA-256", value: file.sha256 || "—" },
    { label: "Content hash", value: file.contentHash || "—" },
    { label: "Tagger version", value: file.taggerVersion || "—" },
    {
      label: "Capture method",
      value: file.captureMeta?.method ? String(file.captureMeta.method) : "—",
    },
    {
      label: "Captured URL",
      value: file.captureMeta?.capturedUrl
        ? String(file.captureMeta.capturedUrl)
        : "—",
    },
    {
      label: "Bytes captured",
      value:
        typeof file.captureMeta?.bytes === "number"
          ? formatBytes(file.captureMeta.bytes)
          : "—",
    },
  ];

  const advancedProvenance = [
    {
      label: "Document ID",
      value: file.document?.id ?? file.documentRevision?.documentId ?? "—",
    },
    { label: "Document kind", value: file.document?.kind ?? "—" },
    { label: "Revision ID", value: file.documentRevision?.id ?? "—" },
    {
      label: "Revision ordinal",
      value:
        typeof file.documentRevision?.ordinal === "number"
          ? String(file.documentRevision.ordinal)
          : "—",
    },
    {
      label: "Revision created",
      value: file.documentRevision?.createdAt
        ? new Date(file.documentRevision.createdAt).toLocaleString()
        : "—",
    },
    { label: "Capture event ID", value: file.captureEvent?.id ?? "—" },
    {
      label: "Capture event time",
      value: file.captureEvent?.createdAt
        ? new Date(file.captureEvent.createdAt).toLocaleString()
        : "—",
    },
    { label: "Request ID", value: file.captureEvent?.requestId ?? "—" },
    {
      label: "Actor",
      value: file.captureEvent?.actorName ?? file.captureEvent?.actorId ?? "—",
    },
    {
      label: "Pipeline",
      value: file.captureEvent?.pipelineConfig
        ? `${file.captureEvent.pipelineConfig.name} @ ${file.captureEvent.pipelineConfig.version}`
        : "—",
    },
    {
      label: "Pipeline configHash",
      value: file.captureEvent?.pipelineConfig?.configHash ?? "—",
    },
    {
      label: "Pipeline codeSha",
      value: file.captureEvent?.pipelineConfig?.codeSha ?? "—",
    },
  ];
  const copy = async (txt: string) => {
    try {
      if (!txt || txt === "—") return;
      await navigator.clipboard.writeText(txt);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto">
      {/* Top padding prevents "clipped" look on short screens */}
      <div className="min-h-full flex items-start justify-center p-4 pt-14 pb-10">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="properties-title"
          className="w-full max-w-2xl rounded-2xl bg-surface shadow-2xl overflow-hidden max-h-[85vh]"
        >
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 id="properties-title" className="text-lg font-semibold">
              Properties
            </h3>

            <button
              ref={closeBtnRef}
              className="btn-ghost text-sm px-3"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          {/* Scrollable body */}
          <div className="p-5 space-y-6 overflow-y-auto max-h-[75vh]">
            {/* Basic */}
            <div className="space-y-3">
              <div className="text-sm font-semibold">Basic</div>

              {basic.map(({ label, value }) => (
                <div
                  key={label}
                  className="grid grid-cols-[140px_1fr] gap-3 items-start"
                >
                  <span className="text-muted">{label}:</span>

                  {/* Tags as chips */}
                  {label === "Tags" && Array.isArray(value) ? (
                    value.length ? (
                      <div className="flex flex-wrap gap-2">
                        {value.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-xs break-words"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-foreground break-words">None</span>
                    )
                  ) : (
                    <span className="text-foreground break-words whitespace-pre-wrap">
                      {String(value ?? "—")}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Provenance */}
            <div className="space-y-3 pt-4 border-t border-border">
              <div className="text-sm font-semibold">Provenance</div>

              {provenance.map(({ label, value }) => {
                const v = String(value ?? "—");
                const isUrl = label === "Source URL" && v && v !== "—";
                const canCopy =
                  v &&
                  v !== "—" &&
                  (label === "SHA-256" ||
                    label === "Content hash" ||
                    label === "Source URL" ||
                    label === "Captured URL");

                return (
                  <div
                    key={label}
                    className="grid grid-cols-[140px_1fr_auto] gap-3 items-start"
                  >
                    <span className="text-muted">{label}:</span>

                    <span className="text-foreground break-words whitespace-pre-wrap">
                      {isUrl ? (
                        <a
                          className="underline underline-offset-2"
                          href={v}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {v}
                        </a>
                      ) : (
                        v
                      )}
                    </span>

                    {canCopy ? (
                      <button
                        className="btn-ghost text-xs px-2 h-7 self-start"
                        onClick={() => copy(v)}
                        title="Copy"
                      >
                        Copy
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}

              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted">
                  Provenance (advanced)
                </summary>

                <div className="mt-3 space-y-2">
                  {advancedProvenance.map(({ label, value }) => {
                    const v = String(value ?? "—");
                    const canCopy =
                      v &&
                      v !== "—" &&
                      (label.includes("ID") ||
                        label.includes("hash") ||
                        label.includes("Request"));

                    return (
                      <div
                        key={label}
                        className="grid grid-cols-[140px_1fr_auto] gap-3 items-start"
                      >
                        <span className="text-muted">{label}:</span>
                        <span className="text-foreground break-words whitespace-pre-wrap font-mono text-xs">
                          {v}
                        </span>

                        {canCopy ? (
                          <button
                            className="btn-ghost text-xs px-2 h-7 self-start"
                            onClick={() => copy(v)}
                            title="Copy"
                          >
                            Copy
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>

              {file.tagsMetaRaw ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-muted">
                    Raw metadata
                  </summary>
                  <pre className="mt-2 p-3 rounded-xl bg-black/5 dark:bg-white/5 text-xs overflow-auto max-h-64">
                    {JSON.stringify(file.tagsMetaRaw, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertiesModal;
