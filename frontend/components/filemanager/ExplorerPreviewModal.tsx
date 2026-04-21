"use client";

import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import type { FileDetail } from "../../lib/types";
import { apiUrl } from "../../lib/api";
import { formatBytes, formatDate } from "../../utils/fileHelpers";

import AITagButton from "../common/AITagButton";
import FavoriteButton from "../common/FavoriteButton";

type Props = {
  file: FileDetail | null | undefined;
  isOpen: boolean;
  onClose(): void;
  onDownload(file: FileDetail): void;
  onToggleFavorite?(file: FileDetail): void;
  onTagUpdate?(id: string, tags: string[]): void;
  autoFocusTags?: boolean;
};

const PdfCanvas = lazy(() => import("../common/PdfCanvas"));

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
      "summary",
    ].join(","),
  );

  return Array.from(nodes).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

function isTypingElement(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return (el as HTMLElement).isContentEditable === true;
}

export default function ExplorerPreviewModal(props: Props) {
  const {
    file,
    isOpen,
    onClose,
    onDownload,
    onToggleFavorite,
    onTagUpdate,
    autoFocusTags = false,
  } = props;

  const f = file ?? null;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Tag focus/scroll refs
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const tagSectionRef = useRef<HTMLDivElement | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [hadError, setHadError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>("");

  // image zoom state
  const [fitMode, setFitMode] = useState<"contain" | "actual">("contain");
  const [zoom, setZoom] = useState<number>(1);

  // PDF pagination
  const [pdfPages, setPdfPages] = useState<number>(0);
  const [pdfPage, setPdfPage] = useState<number>(1);

  const rawMime = useMemo(
    () => (f?.mimeType || "").toLowerCase(),
    [f?.mimeType],
  );
  const mimeBase = useMemo(
    () => rawMime.split(";")[0]?.trim() || "",
    [rawMime],
  );

  const previewUrl = f ? apiUrl(`/api/files/${f.id}/preview`) : "";

  const isImage = mimeBase.startsWith("image/");
  const isPDF = mimeBase === "application/pdf";
  const isText =
    mimeBase.startsWith("text/") ||
    mimeBase === "application/json" ||
    mimeBase.endsWith("+json");

  const uploadedRaw =
    (f ? (f as any).uploadDate : null) ??
    (f ? (f as any).createdAt : null) ??
    null;

  const metaRows: Array<[string, string]> = [
    ["Title", f?.title || ""],
    ["Type", rawMime || "—"],
    ["Size", typeof f?.size === "number" ? formatBytes(f.size) : "—"],
    ["Uploaded", uploadedRaw ? formatDate(String(uploadedRaw)) : "—"],
  ];

  // --------------------------------------------
  // A11y + UX: focus trap, ESC, outside click,
  // scroll lock, restore focus on close
  // --------------------------------------------
  useEffect(() => {
    if (!isOpen || !f) return;

    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    // scroll lock
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // restore focus later
    const prevActive = document.activeElement as HTMLElement | null;

    // ensure dialog focusable
    if (!dialogEl.hasAttribute("tabindex"))
      dialogEl.setAttribute("tabindex", "-1");

    // initial focus
    const t = window.setTimeout(() => {
      (closeBtnRef.current ?? dialogEl).focus?.();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      // ESC closes
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Optional: "F" toggles favorite (only when not typing)
      if (
        (e.key === "f" || e.key === "F") &&
        !isTypingElement(document.activeElement)
      ) {
        if (onToggleFavorite && f) {
          e.preventDefault();
          onToggleFavorite(f);
        }
        return;
      }

      // Focus trap
      if (e.key !== "Tab") return;

      const focusables = getFocusable(dialogEl);
      if (!focusables.length) {
        e.preventDefault();
        dialogEl.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // If focus escaped, pull back in
      if (active && !dialogEl.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (!active || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.body.style.overflow = prevOverflow;

      // restore focus
      window.setTimeout(() => prevActive?.focus?.(), 0);
    };
  }, [isOpen, f, onClose, onToggleFavorite]);

  // Auto focus tags if requested
  useEffect(() => {
    if (!isOpen || !autoFocusTags) return;
    const t = setTimeout(() => {
      tagSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      tagInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [isOpen, autoFocusTags]);

  // ---- Tag editor ----
  const [localTags, setLocalTags] = useState<string[]>(f?.tags || []);
  const [newTagInput, setNewTagInput] = useState<string>("");

  useEffect(() => {
    setLocalTags(f?.tags || []);
  }, [f?.id, f?.tags]);

  const persistTags = async (next: string[]) => {
    if (!f) return;

    onTagUpdate?.(String(f.id), next);

    if (!onTagUpdate) {
      try {
        await fetch(apiUrl(`/api/files/${encodeURIComponent(String(f.id))}`), {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: next }),
        });
      } catch (e) {
        console.error("Failed to update tags", e);
      }
    }
  };

  const addTag = () => {
    const t = newTagInput.trim();
    if (!t || localTags.includes(t)) return;
    const next = [...localTags, t];
    setLocalTags(next);
    setNewTagInput("");
    persistTags(next);
  };

  const removeTag = (t: string) => {
    const next = localTags.filter((x) => x !== t);
    setLocalTags(next);
    persistTags(next);
  };

  // Reset state when file changes
  useEffect(() => {
    setIsLoading(true);
    setHadError(null);
    setFitMode("contain");
    setZoom(1);
    setTextContent("");
    setPdfPages(0);
    setPdfPage(1);
  }, [f?.id]);

  // If unsupported type, stop loading quickly (prevents "stuck spinner")
  useEffect(() => {
    if (!isOpen || !f) return;
    if (!isImage && !isPDF && !isText) {
      setIsLoading(false);
    }
  }, [isOpen, f, isImage, isPDF, isText]);

  // Fetch text content when needed
  useEffect(() => {
    if (!isOpen || !f || !isText || !previewUrl) return;

    const controller = new AbortController();

    setIsLoading(true);
    setHadError(null);

    fetch(previewUrl, {
      credentials: "include",
      headers: {
        Accept: "text/plain, text/*;q=0.9, application/json;q=0.8, */*;q=0.1",
      },
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((txt) => {
        setTextContent(txt);
        setIsLoading(false);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        console.error(e);
        setHadError("text");
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, f, isText, previewUrl]);

  // image style (contain vs actual with zoom)
  const imageStyle: React.CSSProperties =
    fitMode === "contain"
      ? { maxWidth: "100%", maxHeight: "55vh", objectFit: "contain" }
      : {
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
          display: "inline-block",
        };

  const canPaginate = isPDF && !hadError && pdfPages > 1;
  const goPrev = () => {
    setIsLoading(true);
    setPdfPage((p) => Math.max(1, p - 1));
  };
  const goNext = () => {
    setIsLoading(true);
    setPdfPage((p) => Math.min(pdfPages || p, p + 1));
  };

  if (!isOpen || !f) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="flex flex-col w-[min(900px,92vw)] max-h-[92vh] rounded-2xl border border-app surface shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-app flex-shrink-0 gap-2">
            <div className="min-w-0">
              <h2
                id="preview-title"
                className="text-sm font-semibold line-clamp-1"
              >
                {f.title}
              </h2>
              <div className="text-xs text-neutral-500 line-clamp-1">
                {rawMime || "—"}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* PDF pagination in header (compact) */}
              {isPDF && (
                <div className="hidden sm:flex items-center gap-2 mr-1">
                  <button
                    className="px-2 py-1 rounded border border-app text-xs disabled:opacity-50"
                    onClick={goPrev}
                    disabled={!canPaginate || pdfPage <= 1}
                    title="Previous page"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-neutral-600 dark:text-neutral-400 tabular-nums min-w-[84px] text-center">
                    {Math.min(pdfPage, Math.max(1, pdfPages || 1))}/
                    {pdfPages || "—"}
                  </span>
                  <button
                    className="px-2 py-1 rounded border border-app text-xs disabled:opacity-50"
                    onClick={goNext}
                    disabled={!canPaginate || pdfPage >= pdfPages}
                    title="Next page"
                  >
                    Next
                  </button>
                </div>
              )}

              {/* Favorite (uses your shared component) */}
              {onToggleFavorite && (
                <FavoriteButton
                  isOn={!!f.isFavorited}
                  count={
                    typeof f.favoritesCount === "number"
                      ? f.favoritesCount
                      : undefined
                  }
                  size="sm"
                  variant="ghost"
                  onToggle={() => onToggleFavorite(f)}
                />
              )}

              <button
                ref={closeBtnRef}
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-2 hover:bg-[hsl(var(--surface-elev))] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto">
            <div className="p-4">
              {/* Loading */}
              {isLoading && !hadError && (
                <div className="h-[40vh] grid place-items-center">
                  <div className="w-28 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div className="h-full w-1/2 animate-pulse" />
                  </div>
                </div>
              )}

              {/* Error */}
              {hadError && (
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                  Failed to load preview. You can still use “Download”.
                </div>
              )}

              {/* Image */}
              {!hadError && isImage && (
                <div className="w-full">
                  <div className={fitMode === "actual" ? "min-h-[55vh]" : ""}>
                    <img
                      src={previewUrl}
                      alt={f.title}
                      style={imageStyle}
                      className={
                        fitMode === "contain" ? "rounded-xl shadow-sm" : ""
                      }
                      onLoad={() => setIsLoading(false)}
                      onError={() => {
                        setHadError("image");
                        setIsLoading(false);
                      }}
                    />
                  </div>

                  <div className="mt-2 flex gap-2">
                    <button
                      className="px-2 py-1 rounded border border-app text-xs"
                      onClick={() => setFitMode("contain")}
                    >
                      Fit
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-app text-xs"
                      onClick={() => setFitMode("actual")}
                    >
                      Actual
                    </button>
                    {fitMode === "actual" && (
                      <>
                        <button
                          className="px-2 py-1 rounded border border-app text-xs"
                          onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
                        >
                          Zoom Out
                        </button>
                        <span className="text-xs self-center tabular-nums">
                          {(zoom * 100).toFixed(0)}%
                        </span>
                        <button
                          className="px-2 py-1 rounded border border-app text-xs"
                          onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
                        >
                          Zoom In
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* PDF */}
              {!hadError && isPDF && (
                <div className="w-full">
                  <Suspense
                    fallback={
                      <div className="h-[40vh] grid place-items-center">
                        <div className="w-28 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                          <div className="h-full w-1/2 animate-pulse" />
                        </div>
                      </div>
                    }
                  >
                    <PdfCanvas
                      url={previewUrl}
                      page={pdfPage}
                      onReady={(numPages) => {
                        setPdfPages(numPages);
                        setPdfPage((p) =>
                          Math.min(Math.max(1, p), numPages || 1),
                        );
                        setIsLoading(false);
                      }}
                      onRendered={() => setIsLoading(false)}
                      onError={(msg) => {
                        console.error(msg);
                        setHadError("pdf");
                        setIsLoading(false);
                      }}
                    />
                  </Suspense>

                  <div className="mt-2 text-sm text-neutral-500">
                    PDF preview (rendered). Use Download for the original file.
                  </div>

                  {/* PDF pagination (mobile fallback) */}
                  {canPaginate && (
                    <div className="mt-2 flex sm:hidden items-center gap-2">
                      <button
                        className="px-2 py-1 rounded border border-app disabled:opacity-50"
                        onClick={goPrev}
                        disabled={pdfPage <= 1}
                      >
                        Prev
                      </button>
                      <span className="text-sm tabular-nums">
                        Page {Math.min(pdfPage, Math.max(1, pdfPages || 1))} /{" "}
                        {pdfPages || "—"}
                      </span>
                      <button
                        className="px-2 py-1 rounded border border-app disabled:opacity-50"
                        onClick={goNext}
                        disabled={pdfPage >= pdfPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Text */}
              {!hadError && isText && (
                <div className="w-full rounded-xl overflow-auto border border-app bg-white dark:bg-neutral-900 min-h-[55vh]">
                  {!isLoading && (
                    <pre className="p-4 text-sm leading-6 whitespace-pre-wrap break-words font-mono">
                      {textContent}
                    </pre>
                  )}
                </div>
              )}

              {/* Unsupported */}
              {!isLoading && !hadError && !isImage && !isPDF && !isText && (
                <div className="p-4 text-center text-neutral-500">
                  Preview not available for this file type. Use Download to
                  view.
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-app p-4 text-sm grid gap-3 flex-shrink-0">
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4">
              {metaRows.map(([k, v]) => (
                <div key={k}>
                  <div className="text-neutral-500">{k}</div>
                  <div className="font-medium break-words">{v}</div>
                </div>
              ))}
            </div>

            {/* Tags */}
            <div ref={tagSectionRef}>
              <div className="text-neutral-500">Tags</div>

              <div className="flex flex-wrap gap-2 mt-2">
                {localTags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 dark:bg-indigo-900/40 rounded-full"
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      className="text-[10px] opacity-70 hover:opacity-100"
                      onClick={() => removeTag(t)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  ref={tagInputRef}
                  name="preview-add-tag"
                  type="text"
                  placeholder="Add tag"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTag();
                  }}
                  className="input h-8 w-48 rounded-lg shadow-sm focus:ring-2 focus:ring-brand-primary/40"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="text-xs px-2 py-1 border rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  Add
                </button>

                {f && (
                  <AITagButton
                    kind="file"
                    id={String(f.id)}
                    onMerge={(aiTags) => {
                      const merged = Array.from(
                        new Set([...(f.tags || []), ...aiTags]),
                      );
                      setLocalTags(merged);
                      persistTags(merged);
                    }}
                  />
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                className="rounded-xl px-3 py-2 bg-[hsl(var(--accent))] text-white"
                onClick={() => onDownload(f)}
              >
                Download
              </button>
              {onToggleFavorite && (
                <button
                  className="rounded-xl px-3 py-2 border border-app"
                  onClick={() => onToggleFavorite(f)}
                  title="Toggle favorite (F)"
                >
                  {f.isFavorited ? "Unfavorite" : "Favorite"}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
