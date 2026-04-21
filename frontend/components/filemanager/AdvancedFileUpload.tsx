import React, { useRef, useState, useEffect, DragEvent } from "react";
import { FileItem } from "../../lib/types";
import { toFileItem, type BackendStoredFile } from "../../lib/api";
import { formatBytes } from "../../utils/fileHelpers";

// Chunk size for resumable upload (1MB)
const CHUNK_SIZE = 1 * 1024 * 1024;

const FILE_INPUT_ACCEPT =
  ".pdf,.docx,.html,.htm,.txt,.md,.csv,.json,.xml,.png,.jpg,.jpeg,.webp,.gif,.svg";

const FILE_INPUT_HINT =
  "PDF, DOCX, HTML, TXT, MD, CSV, JSON, XML, and common image files";

type UploadStatus =
  | "pending"
  | "uploading"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

interface FileProgress {
  file: File;
  fingerprint: string; // local resume key derived from file metadata
  uploadSessionId: string; // transport/session id for chunk upload
  uploadedChunks: Set<number>;
  totalChunks: number;
  status: UploadStatus;
  error?: string;
}

interface AdvancedFileUploadProps {
  onUploaded: (newFile: FileItem) => void;
  uploadChunkUrl?: string; // backend chunk receiver
  finalizeUrl?: string; // optional finalize endpoint
  compact?: boolean;
  folderId?: string; // optional: associate uploads to folder
}

const STORAGE_KEY = "advanced_file_upload_state";

interface StoredState {
  [fingerprint: string]: {
    uploadSessionId: string;
    uploadedChunks: number[];
    fileName: string;
    size: number;
    lastModified: number;
  };
}

const loadStoredState = (): StoredState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const readErrorMessage = async (resp: Response) => {
  try {
    const data = await resp.json();
    return (
      data?.message ||
      data?.detail ||
      data?.error ||
      `${resp.status} ${resp.statusText || "Request failed"}`
    );
  } catch {
    return `${resp.status} ${resp.statusText || "Request failed"}`;
  }
};

const cancelChunkUploadOnServer = async (
  uploadChunkUrl: string,
  uploadSessionId: string,
) => {
  const base = uploadChunkUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/${encodeURIComponent(uploadSessionId)}`, {
    method: "DELETE",
  });

  if (!resp.ok) {
    const msg = await readErrorMessage(resp);
    throw new Error(msg);
  }
};

const saveStoredState = (state: StoredState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const hashString = async (input: string) => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const createUploadSessionId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const fingerprintFor = async (file: File) => {
  const base = `${file.name}-${file.size}-${file.lastModified}`;
  return await hashString(base);
};

/** Small reusable UI bits (theme-aware) */
const Chip: React.FC<{
  tone?: "default" | "success" | "warn" | "danger";
  children: React.ReactNode;
}> = ({ tone = "default", children }) => {
  const tones: Record<string, string> = {
    default:
      "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    success:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    warn: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
    danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <span className={`badge ${tones[tone]} !text-[11px]`}>{children}</span>
  );
};

const IconUpload = ({ className = "w-5 h-5" }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      d="M19 15v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4H3l9-9 9 9h-2zM5 17v2h14v-2H5z"
      fill="currentColor"
      opacity=".9"
    />
  </svg>
);

const IconPause = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
  </svg>
);
const IconPlay = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path fill="currentColor" d="M8 5v14l11-7z" />
  </svg>
);
const IconX = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path fill="currentColor" d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const IconCheck = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path fill="currentColor" d="M9 16.2l-3.5-3.6L4 14l5 5 11-11-1.5-1.4z" />
  </svg>
);

const AdvancedFileUpload: React.FC<AdvancedFileUploadProps> = ({
  onUploaded,
  uploadChunkUrl = "/api/files/upload/chunk",
  finalizeUrl,
  compact = false,
  folderId,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [fileProgressMap, setFileProgressMap] = useState<
    Record<string, FileProgress>
  >({});
  const [dragOver, setDragOver] = useState(false);
  const [showPanel, setShowPanel] = useState(!compact);
  const [showCompleted, setShowCompleted] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Always read latest status inside async loops (avoid stale closures)
  const progressRef = useRef<Record<string, FileProgress>>({});
  useEffect(() => {
    progressRef.current = fileProgressMap;
  }, [fileProgressMap]);

  // Abort in-flight chunk requests (pause/cancel)
  const abortRef = useRef<Record<string, AbortController | null>>({});

  const abortActive = (fp: string) => {
    try {
      abortRef.current[fp]?.abort();
    } catch {
      // ignore
    }
    abortRef.current[fp] = null;
  };

  // derive groups
  const overallFiles = Object.values(fileProgressMap);
  const uploadingFiles = overallFiles.filter((f) => f.status !== "completed");
  const completedFiles = overallFiles.filter((f) => f.status === "completed");

  // auto-collapse completed after 5s of new completion
  useEffect(() => {
    if (completedFiles.length === 0) return;
    setShowCompleted(true);
    const timer = setTimeout(() => setShowCompleted(false), 5000);
    return () => clearTimeout(timer);
  }, [completedFiles.length]);

  // placeholder for stored state awareness (could prompt resume)
  useEffect(() => {
    loadStoredState(); // you can surface resume UI if desired
  }, []);

  const persistUploadedChunks = (
    fingerprint: string,
    uploadSessionId: string,
    uploadedChunks: Set<number>,
    file: File,
  ) => {
    const existing = loadStoredState();
    existing[fingerprint] = {
      uploadSessionId,
      uploadedChunks: Array.from(uploadedChunks),
      fileName: file.name,
      size: file.size,
      lastModified: file.lastModified,
    };
    saveStoredState(existing);
  };

  const removeProgressEntry = (fingerprint: string) => {
    setFileProgressMap((prev) => {
      const copy = { ...prev };
      delete copy[fingerprint];
      return copy;
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;

    for (const file of Array.from(files)) {
      const fingerprint = await fingerprintFor(file);
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const stored = loadStoredState();
      const existing = stored[fingerprint];
      const uploadSessionId =
        existing?.uploadSessionId || createUploadSessionId();

      setFileProgressMap((prev) => {
        if (prev[fingerprint]) return prev; // already tracking this local resume key
        return {
          ...prev,
          [fingerprint]: {
            file,
            fingerprint,
            uploadSessionId,
            uploadedChunks: new Set<number>(existing?.uploadedChunks || []),
            totalChunks,
            status: "pending",
          },
        };
      });

      startUpload(fingerprint, file);
    }
  };

  const startUpload = async (fingerprint: string, file: File) => {
    // Prevent parallel startUpload calls for same file
    const cur = progressRef.current[fingerprint];
    if (cur?.status === "uploading") return;

    // Abort any prior in-flight fetches for this fingerprint
    abortActive(fingerprint);
    const controller = new AbortController();
    abortRef.current[fingerprint] = controller;

    setFileProgressMap((prev) => ({
      ...prev,
      [fingerprint]: {
        ...(prev[fingerprint] ?? ({} as FileProgress)),
        status: "uploading",
        error: undefined,
      },
    }));

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const stored = loadStoredState();
    const existing = stored[fingerprint];
    const uploadSessionId =
      progressRef.current[fingerprint]?.uploadSessionId ||
      existing?.uploadSessionId ||
      createUploadSessionId();

    const uploadedChunks = new Set<number>(
      existing ? existing.uploadedChunks : [],
    );

    const uploadChunk = async (
      index: number,
    ): Promise<BackendStoredFile | null> => {
      if (uploadedChunks.has(index)) return null;

      const start = index * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const blob = file.slice(start, end);
      const form = new FormData();
      form.append("chunk", blob);
      form.append("uploadSessionId", uploadSessionId);
      form.append("chunkIndex", index.toString());
      form.append("totalChunks", totalChunks.toString());
      form.append("fileName", file.name);
      if (folderId) form.append("folderId", folderId);

      const resp = await fetch(uploadChunkUrl, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const msg = await readErrorMessage(resp);
        throw new Error(`Chunk ${index} failed: ${msg}`);
      }

      uploadedChunks.add(index);
      persistUploadedChunks(fingerprint, uploadSessionId, uploadedChunks, file);

      setFileProgressMap((prev) => ({
        ...prev,
        [fingerprint]: {
          ...(prev[fingerprint] || ({} as FileProgress)),
          fingerprint,
          uploadSessionId,
          uploadedChunks: new Set(uploadedChunks),
          totalChunks,
          status: "uploading",
        },
      }));

      if (resp.status === 200) {
        return (await resp.json()) as BackendStoredFile;
      }

      return null;
    };

    try {
      let autoFinalizedFile: FileItem | null = null;

      for (let i = 0; i < totalChunks; i++) {
        const st = progressRef.current[fingerprint]?.status;
        if (st === "paused" || st === "cancelled") break;

        const maybeFinalized = await uploadChunk(i);
        if (maybeFinalized?.id) {
          autoFinalizedFile = toFileItem(maybeFinalized);
        }
      }

      if (uploadedChunks.size === totalChunks) {
        // If user cancelled right at the end, do not finalize
        if (progressRef.current[fingerprint]?.status === "cancelled") return;

        let finalizedFile: FileItem | null = autoFinalizedFile;

        if (!finalizedFile && finalizeUrl) {
          const finalizeResp = await fetch(finalizeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uploadSessionId,
              fileName: file.name,
              folderId,
            }),
            signal: controller.signal,
          });

          if (!finalizeResp.ok) {
            const msg = await readErrorMessage(finalizeResp);
            throw new Error(msg);
          }

          const finalized = (await finalizeResp.json()) as BackendStoredFile;
          if (finalized?.id) {
            finalizedFile = toFileItem(finalized);
          }
        }

        const cleaned = loadStoredState();
        delete cleaned[fingerprint];
        saveStoredState(cleaned);

        setFileProgressMap((prev) => ({
          ...prev,
          [fingerprint]: {
            ...(prev[fingerprint] || ({} as FileProgress)),
            fingerprint,
            uploadSessionId,
            status: "completed",
          },
        }));

        const optimistic: FileItem = finalizedFile ?? {
          id: uploadSessionId,
          title: file.name,
          description: "",
          uploader: { id: "self", name: "You" },
          uploadDate: new Date().toISOString(),
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          thumbnailUrl: "",
          tags: [],
          downloads: 0,
          favoritesCount: 0,
          isFavorited: false,
          visibility: "private",
        };

        onUploaded(optimistic);
      } else {
        setFileProgressMap((prev) => ({
          ...prev,
          [fingerprint]: {
            ...(prev[fingerprint] || ({} as FileProgress)),
            fingerprint,
            uploadSessionId,
            status: "paused",
          },
        }));
      }
    } catch (err: any) {
      // Abort is expected when pausing/cancelling
      if (err?.name === "AbortError") {
        const st = progressRef.current[fingerprint]?.status;
        setFileProgressMap((prev) => ({
          ...prev,
          [fingerprint]: {
            ...(prev[fingerprint] || ({} as FileProgress)),
            fingerprint,
            uploadSessionId,
            status: st === "cancelled" ? "cancelled" : "paused",
            error: undefined,
          },
        }));
        return;
      }

      setFileProgressMap((prev) => ({
        ...prev,
        [fingerprint]: {
          ...(prev[fingerprint] || ({} as FileProgress)),
          fingerprint,
          uploadSessionId,
          status: "error",
          error: err?.message || "Upload failed",
        },
      }));
    } finally {
      // Don't keep stale controllers around
      const st = progressRef.current[fingerprint]?.status;
      if (st !== "uploading") abortRef.current[fingerprint] = null;
    }
  };

  const pauseUpload = (fingerprint: string) => {
    abortActive(fingerprint);
    setFileProgressMap((prev) => ({
      ...prev,
      [fingerprint]: {
        ...(prev[fingerprint] || ({} as FileProgress)),
        status: "paused",
      },
    }));
  };

  const resumeUpload = (fingerprint: string) => {
    const fp = progressRef.current[fingerprint];
    if (!fp) return;
    if (fp.status === "cancelled" || fp.status === "completed") return;
    startUpload(fingerprint, fp.file);
  };

  const cancelUpload = async (fingerprint: string) => {
    abortActive(fingerprint);

    const uploadSessionId =
      progressRef.current[fingerprint]?.uploadSessionId ||
      loadStoredState()[fingerprint]?.uploadSessionId ||
      "";

    setFileProgressMap((prev) => ({
      ...prev,
      [fingerprint]: {
        ...(prev[fingerprint] || ({} as FileProgress)),
        status: "cancelled",
        error: undefined,
      },
    }));

    try {
      if (uploadSessionId) {
        await cancelChunkUploadOnServer(uploadChunkUrl, uploadSessionId);
      }
    } catch (err) {
      console.warn("Failed to cancel chunk upload on server", err);
    }

    const stored = loadStoredState();
    delete stored[fingerprint];
    saveStoredState(stored);

    setTimeout(() => removeProgressEntry(fingerprint), 250);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // UI groups
  const activeFiles = uploadingFiles;
  const doneFiles = completedFiles;

  /** UI: single file progress row/card */
  const ProgressCard: React.FC<{ fp: FileProgress }> = ({ fp }) => {
    const percent =
      fp.totalChunks > 0
        ? Math.round((fp.uploadedChunks.size / fp.totalChunks) * 100)
        : 0;
    const tone =
      fp.status === "completed"
        ? "success"
        : fp.status === "error"
          ? "danger"
          : fp.status === "paused"
            ? "warn"
            : "default";

    return (
      <div
        className={[
          "rounded-2xl border card p-3 flex flex-col md:flex-row gap-4 items-start",
          "hover:shadow-sm transition-shadow",
        ].join(" ")}
        aria-label={`Upload status for ${fp.file.name}`}
      >
        {/* File avatar */}
        <div className="shrink-0">
          <div className="h-10 w-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 grid place-items-center">
            <span className="text-xs font-medium">
              {(fp.file.name.split(".").pop() || "").slice(0, 4).toUpperCase()}
            </span>
          </div>
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium truncate">{fp.file.name}</div>
              <div className="text-xs text-neutral-500">
                {formatBytes(fp.file.size)} •{" "}
                <Chip tone={tone as any}>{fp.status}</Chip>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              {fp.status === "uploading" && (
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={() => pauseUpload(fp.fingerprint)}
                  title="Pause"
                >
                  <IconPause />
                </button>
              )}
              {fp.status === "paused" && (
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={() => resumeUpload(fp.fingerprint)}
                  title="Resume"
                >
                  <IconPlay />
                </button>
              )}
              {fp.status !== "completed" && (
                <button
                  className="btn-ghost px-2 py-1 text-red-600"
                  onClick={() => cancelUpload(fp.fingerprint)}
                  title="Cancel"
                >
                  <IconX />
                </button>
              )}
              {fp.status === "completed" && (
                <div className="text-green-600 flex items-center gap-1 text-sm">
                  <IconCheck /> Done
                </div>
              )}
            </div>
          </div>

          {/* Progress */}
          <div className="mt-2">
            <div className="w-full h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
              <div
                className={[
                  "h-full transition-all",
                  fp.status === "error" ? "bg-red-500" : "bg-brand",
                ].join(" ")}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="text-xs mt-1">
              {percent}% ({fp.uploadedChunks.size}/{fp.totalChunks} chunks)
              {fp.error && (
                <span className="text-red-600 ml-2">Error: {fp.error}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const CompletedCard: React.FC<{ fp: FileProgress }> = ({ fp }) => (
    <div className="rounded-2xl border card p-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="font-medium truncate">{fp.file.name}</div>
        <div className="text-xs text-neutral-500">
          {formatBytes(fp.file.size)} • Uploaded
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Chip tone="success">Completed</Chip>
        <button
          className="btn-ghost px-2 py-1"
          onClick={() => removeProgressEntry(fp.fingerprint)}
        >
          Remove
        </button>
      </div>
    </div>
  );

  /** ======= Compact trigger (popover) ======= */
  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          ref={buttonRef}
          onClick={() => {
            setShowPanel((s) => !s);
            setTimeout(() => {
              const btn = buttonRef.current;
              if (!btn) return;
              const rect = btn.getBoundingClientRect();
              const panelWidth = 440;
              const margin = 8;
              const top = rect.bottom + margin + window.scrollY;
              const left = Math.max(
                8 + window.scrollX,
                Math.min(
                  window.innerWidth - panelWidth - 8 + window.scrollX,
                  rect.right - panelWidth,
                ),
              );
              setPanelPosition({ top, left });
            }, 0);
          }}
          className="btn-primary"
        >
          Upload
          {activeFiles.length > 0 && (
            <span className="ml-2 badge">{activeFiles.length}</span>
          )}
        </button>

        {showPanel && (
          <div
            className="fixed w-[440px] max-h-[560px] bg-white dark:bg-neutral-900 border rounded-2xl shadow-2xl p-4 z-[1000] overflow-auto"
            style={{
              top: panelPosition?.top ?? 80,
              left: panelPosition?.left ?? Math.max(8, window.innerWidth - 460),
            }}
            role="dialog"
            aria-label="Upload files"
          >
            {/* Dropzone */}
            <div
              className={[
                "card border-dashed px-3 py-2 mb-3 cursor-pointer transition",
                dragOver
                  ? "ring-2 ring-brand-primary/40 bg-brand/5"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800",
              ].join(" ")}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                name="compact-upload-files"
                type="file"
                multiple
                accept={FILE_INPUT_ACCEPT}
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <div className="flex items-center gap-3">
                <div className="rounded-xl p-2 bg-neutral-100 dark:bg-neutral-800">
                  <IconUpload className="w-4 h-4" />
                </div>
                <div className="text-sm">
                  <div className="font-medium">Add files</div>
                  <div className="text-xs text-neutral-500">
                    Drag & drop or click to select • {FILE_INPUT_HINT}
                  </div>
                </div>
              </div>
            </div>

            {doneFiles.length > 0 && (
              <div className="flex items-center justify-between bg-neutral-100 dark:bg-neutral-800 rounded-xl px-3 py-2 mb-3">
                <div className="text-sm">
                  {doneFiles.length} file{doneFiles.length !== 1 ? "s" : ""}{" "}
                  uploaded
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn-ghost px-2 py-1 text-sm"
                    onClick={() => setShowCompleted((s) => !s)}
                  >
                    {showCompleted ? "Hide" : "Show"} completed
                  </button>
                  <button
                    className="btn-ghost px-2 py-1 text-sm"
                    onClick={() => {
                      doneFiles.forEach((f) =>
                        removeProgressEntry(f.fingerprint),
                      );
                      setShowCompleted(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Active uploads */}
            <div className="space-y-2">
              {activeFiles.map((fp) => (
                <ProgressCard key={fp.fingerprint} fp={fp} />
              ))}
            </div>

            {/* Completed */}
            {showCompleted && (
              <div className="mt-3 space-y-2">
                {doneFiles.map((fp) => (
                  <CompletedCard key={fp.fingerprint} fp={fp} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /** ======= Full view (non-compact) ======= */
  return (
    <div className="space-y-3 w-full">
      {/* Dropzone */}
      <div
        className={[
          "card border-dashed px-4 py-3 flex items-center justify-between cursor-pointer transition",
          dragOver
            ? "ring-2 ring-brand-primary/40 bg-brand/5"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-800",
        ].join(" ")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
        aria-label="Add files"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-3 bg-neutral-100 dark:bg-neutral-800">
            <IconUpload />
          </div>
          <div className="min-w-0">
            <div className="font-medium">Upload files</div>
            <div className="text-xs text-neutral-500">
              Drag & drop or click to select multiple files • {FILE_INPUT_HINT}
            </div>
          </div>
        </div>
        <button className="btn-primary px-4 py-2">Select</button>
        <input
          ref={inputRef}
          name="upload-files"
          type="file"
          multiple
          accept={FILE_INPUT_ACCEPT}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Completed summary */}
      {doneFiles.length > 0 && (
        <div className="flex items-center justify-between bg-neutral-100 dark:bg-neutral-800 rounded-xl px-3 py-2">
          <div className="text-sm">
            {doneFiles.length} file{doneFiles.length !== 1 ? "s" : ""} uploaded
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost px-2 py-1 text-sm"
              onClick={() => setShowCompleted((s) => !s)}
            >
              {showCompleted ? "Hide" : "Show"} completed
            </button>
            <button
              className="btn-ghost px-2 py-1 text-sm"
              onClick={() => {
                doneFiles.forEach((f) => removeProgressEntry(f.fingerprint));
                setShowCompleted(false);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Active uploads */}
      <div className="space-y-2">
        {activeFiles.map((fp) => (
          <ProgressCard key={fp.fingerprint} fp={fp} />
        ))}
      </div>

      {/* Completed uploads */}
      {showCompleted && (
        <div className="space-y-2">
          {doneFiles.map((fp) => (
            <CompletedCard key={fp.fingerprint} fp={fp} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AdvancedFileUpload;
