import React, {
  useEffect,
  useId,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  listFolders,
  createFolder,
  getFolder,
  getInstitutionalNodeHealth,
  getInstitutionalSessionStatus,
  openInstitutionalLogin,
  type InstitutionalNodeHealth,
  type InstitutionalProvider,
  type InstitutionalSessionStatus,
} from "../../lib/api";
import CloseIcon from "../icons/CloseIcon";
import { PlusButton } from "../ui/PlusButton";
import { useDialogA11y } from "../common/useDialogA11y";

type Folder = { id: string; name: string; parentId?: string | null };
type Mode = "text" | "pdf";
type CaptureAccessMode = "public" | "institutional";

interface Props {
  open: boolean;
  suggestedName: string;
  mode: Mode;
  showInstitutionalToggle?: boolean;
  defaultAccessMode?: CaptureAccessMode;
  onCancel: () => void;
  onConfirm: (opts: {
    folderId?: string | null;
    fileName: string;
    mode: Mode;
    accessMode?: CaptureAccessMode;
  }) => void;
}

const FolderPickerModal: React.FC<Props> = ({
  open,
  suggestedName,
  mode,
  showInstitutionalToggle = false,
  defaultAccessMode = "public",
  onCancel,
  onConfirm,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const createErrorId = useId();

  const [current, setCurrent] = useState<string | null>(null); // null = root
  const [stack, setStack] = useState<Folder[]>([]);
  const [children, setChildren] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);

  const [fileName, setFileName] = useState(suggestedName);
  const [accessMode, setAccessMode] =
    useState<CaptureAccessMode>(defaultAccessMode);

  const [loginProvider, setLoginProvider] =
    useState<InstitutionalProvider>("pressreader");
  const [customLoginUrl, setCustomLoginUrl] = useState("");

  const [icnHealth, setIcnHealth] = useState<InstitutionalNodeHealth | null>(
    null,
  );
  const [icnSession, setIcnSession] =
    useState<InstitutionalSessionStatus | null>(null);
  const [icnStatusLoading, setIcnStatusLoading] = useState(false);
  const [icnBusy, setIcnBusy] = useState(false);
  const [icnMessage, setIcnMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [currentInfo, setCurrentInfo] = useState<Folder | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Which folder in the list is selected as the destination (single click)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Manual double-click detector (more reliable than native dblclick if UI re-renders)
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const DOUBLE_CLICK_MS = 320;

  useEffect(() => {
    if (!open) return;
    setFileName(suggestedName);
    setAccessMode(defaultAccessMode);
    setLoginProvider("pressreader");
    setCustomLoginUrl("");
    setIcnHealth(null);
    setIcnSession(null);
    setIcnMessage(null);
    setCurrent(null);
    setStack([]);
    setSelectedFolderId(null);
    setCreateError(null);
    lastClickRef.current = null;
  }, [open, suggestedName, defaultAccessMode]);

  useDialogA11y({
    isOpen: open,
    onClose: onCancel,
    dialogRef,
    initialFocusRef: fileNameInputRef,
  });

  const load = useCallback(async (parentId: string | null) => {
    setLoading(true);
    try {
      const res = await listFolders(parentId ?? undefined);
      setChildren(res);
      setSelectedFolderId(null);
      lastClickRef.current = null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load current folder info (name, etc.) for header/labels
  useEffect(() => {
    let active = true;

    // Modal closed → clear state and stop
    if (!open) {
      setCurrentInfo(null);
      setInfoLoading(false);
      return () => {
        active = false;
      };
    }

    // Root (no current folder) → clear and stop
    if (!current) {
      setCurrentInfo(null);
      setInfoLoading(false);
      return () => {
        active = false;
      };
    }

    setInfoLoading(true);

    (async () => {
      try {
        const info = await getFolder(current);
        if (active) setCurrentInfo(info);
      } catch (e) {
        if (active) setCurrentInfo(null);
        // eslint-disable-next-line no-console
        console.error("Failed to load folder info", e);
      } finally {
        if (active) setInfoLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [current, open]);

  useEffect(() => {
    if (open) load(current);
  }, [open, current, load]);

  const refreshInstitutionalState = useCallback(async () => {
    if (!showInstitutionalToggle || accessMode !== "institutional") return;

    setIcnStatusLoading(true);
    try {
      const [health, session] = await Promise.all([
        getInstitutionalNodeHealth(),
        getInstitutionalSessionStatus(),
      ]);

      setIcnHealth(health);
      setIcnSession(session);
    } catch (e: any) {
      setIcnMessage({
        type: "error",
        text:
          e?.message || "Could not reach the institutional session backend.",
      });
    } finally {
      setIcnStatusLoading(false);
    }
  }, [showInstitutionalToggle, accessMode]);

  useEffect(() => {
    if (!open) return;
    if (!(showInstitutionalToggle && accessMode === "institutional")) return;
    void refreshInstitutionalState();
  }, [open, showInstitutionalToggle, accessMode, refreshInstitutionalState]);

  const goInto = (f: Folder) => {
    setStack((s) => [...s, f]);
    setCurrent(f.id);
  };

  const handleChildClick = (f: Folder) => {
    const now = Date.now();
    const last = lastClickRef.current;

    // If the same folder is clicked twice quickly → enter it
    if (last && last.id === f.id && now - last.t < DOUBLE_CLICK_MS) {
      lastClickRef.current = null;
      setSelectedFolderId(null);
      goInto(f);
      return;
    }

    // Otherwise just select it as the destination
    lastClickRef.current = { id: f.id, t: now };
    setSelectedFolderId(f.id);
  };

  const goUp = () => {
    if (stack.length === 0) {
      setCurrent(null);
      return;
    }
    const next = [...stack];
    next.pop();
    setStack(next);
    setCurrent(next.length ? next[next.length - 1].id : null);
  };

  const breadcrumb = useMemo(
    () => [{ id: "", name: "Home" }, ...stack],
    [stack],
  );

  const selectedFolder = useMemo(
    () => children.find((f) => f.id === selectedFolderId) ?? null,
    [children, selectedFolderId],
  );

  const destinationName = selectedFolder?.name ?? currentInfo?.name ?? "Home";

  const institutionalReady =
    accessMode !== "institutional" ||
    Boolean(
      icnSession?.enabled && icnSession?.reachable && icnSession?.authenticated,
    );

  const institutionalStatus = (() => {
    if (accessMode !== "institutional") {
      return {
        label: "Public route",
        className: "border-neutral-200 bg-neutral-50 text-neutral-700",
      };
    }

    if (icnStatusLoading) {
      return {
        label: "Checking IIT session…",
        className: "border-blue-200 bg-blue-50 text-blue-700",
      };
    }

    if (!icnHealth?.enabled) {
      return {
        label: "ICN disabled",
        className: "border-neutral-200 bg-neutral-50 text-neutral-700",
      };
    }

    if (!icnHealth?.reachable) {
      return {
        label: "ICN offline",
        className: "border-red-200 bg-red-50 text-red-700",
      };
    }

    if (icnSession?.authenticated) {
      return {
        label: "IIT session ready",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }

    return {
      label: "Login required",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  })();

  const handleOpenInstitutionalLogin = async () => {
    if (loginProvider === "custom" && !customLoginUrl.trim()) {
      setIcnMessage({
        type: "error",
        text: "Enter the exact IIT/library entry URL for custom login.",
      });
      return;
    }

    setIcnBusy(true);
    try {
      const result = await openInstitutionalLogin(
        loginProvider === "custom"
          ? { provider: "custom", url: customLoginUrl.trim() }
          : { provider: loginProvider },
      );

      setIcnMessage({
        type: "success",
        text:
          result?.message ||
          "Login window opened. Complete the IIT/library sign-in there, then refresh the session status.",
      });

      await refreshInstitutionalState();
    } catch (e: any) {
      setIcnMessage({
        type: "error",
        text: e?.message || "Could not open the institutional login window.",
      });
    } finally {
      setIcnBusy(false);
    }
  };

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreateError("Enter a folder name.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const f = await createFolder(name, current ?? undefined);
      // Enter the new folder
      setStack((s) => [...s, f]);
      setCurrent(f.id);
      setNewFolderName("");
      setSelectedFolderId(null);
      lastClickRef.current = null;
    } catch (e: any) {
      setCreateError(e?.message || "Could not create the folder.");
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[2px]" />

      {/* Panel */}
      <div className="relative w-full max-w-3xl">
        <div className="bg-landing-gradient rounded-3xl p-[1px] shadow-2xl">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="md3-surface overflow-hidden rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="md3-chip">
                    {mode === "pdf" ? "PDF" : "TEXT"}
                  </span>

                  {showInstitutionalToggle &&
                    accessMode === "institutional" && (
                      <span className="md3-chip">IIT session</span>
                    )}

                  <span className="text-sm text-muted truncate flex items-center gap-2">
                    <span className="truncate">
                      Saving to:{" "}
                      <span className="font-medium text-foreground">
                        {destinationName}
                      </span>
                    </span>

                    {infoLoading && (
                      <span className="md3-chip inline-flex items-center gap-1">
                        <svg
                          className="h-3.5 w-3.5 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            className="opacity-75"
                            d="M4 12a8 8 0 0 1 8-8"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                        Loading
                      </span>
                    )}
                  </span>
                </div>

                <h3
                  id={titleId}
                  className="mt-2 text-xl font-semibold leading-snug"
                >
                  Choose a destination
                </h3>
                <p id={descriptionId} className="mt-1 text-sm text-muted">
                  Click a folder to select it. Double-click to open it.
                </p>
              </div>

              <PlusButton
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                aria-label="Close"
              >
                <CloseIcon className="h-4 w-4" />
              </PlusButton>
            </div>

            <div className="md3-divider" />

            {/* Content */}
            <div className="px-6 py-5 space-y-4">
              {/* Breadcrumb */}
              <div className="flex flex-wrap items-center gap-2">
                {breadcrumb.map((b, i) => (
                  <React.Fragment key={b.id || `root-${i}`}>
                    <PlusButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full px-3"
                      onClick={() => {
                        const next = stack.slice(0, i);
                        setStack(next);
                        setCurrent(
                          next.length ? next[next.length - 1].id : null,
                        );
                        setSelectedFolderId(null);
                        lastClickRef.current = null;
                      }}
                    >
                      {b.name}
                    </PlusButton>

                    {i < breadcrumb.length - 1 && (
                      <span className="text-neutral-400 select-none">›</span>
                    )}
                  </React.Fragment>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* Folder list */}
                <div className="md:col-span-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Folders</div>
                      <div className="text-xs text-muted">
                        Tip: double-click to open (reliable)
                      </div>
                    </div>

                    <PlusButton
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={stack.length === 0}
                      onClick={() => {
                        setSelectedFolderId(null);
                        lastClickRef.current = null;
                        goUp();
                      }}
                    >
                      Up
                    </PlusButton>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 overflow-hidden">
                    <div className="max-h-[46vh] overflow-auto p-2">
                      {loading ? (
                        <div className="text-sm text-muted p-3">Loading…</div>
                      ) : children.length === 0 ? (
                        <div className="text-sm text-muted p-3">
                          No folders here.
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {children.map((f) => {
                            const active = selectedFolderId === f.id;

                            return (
                              <li key={f.id}>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  aria-pressed={active}
                                  className={[
                                    "flex items-center justify-between gap-3 rounded-2xl px-3 py-2 transition cursor-pointer",
                                    active
                                      ? "bg-[color-mix(in_oklab,var(--color-accent),transparent_90%)] ring-1 ring-[color-mix(in_oklab,var(--color-accent),transparent_70%)]"
                                      : "hover:bg-[color-mix(in_oklab,var(--color-foreground),transparent_96%)]",
                                  ].join(" ")}
                                  onClick={() => handleChildClick(f)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      handleChildClick(f);
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <svg
                                      className="h-4 w-4 text-neutral-500 shrink-0"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                                    </svg>

                                    <div className="min-w-0">
                                      <div className="truncate font-medium">
                                        {f.name}
                                      </div>
                                      <div className="text-xs text-muted truncate">
                                        {active
                                          ? "Selected as destination"
                                          : "Click to select"}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {active && (
                                      <span className="md3-chip">Selected</span>
                                    )}
                                    <PlusButton
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedFolderId(null);
                                        lastClickRef.current = null;
                                        goInto(f);
                                      }}
                                    >
                                      Open
                                    </PlusButton>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right column: create + filename + route + institutional session */}
                <div className="md:col-span-2 space-y-4">
                  <div className="rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 p-4">
                    <div className="text-sm font-semibold">Create folder</div>
                    <p className="text-xs text-muted mt-1">
                      Create inside{" "}
                      <span className="font-medium text-foreground">
                        {currentInfo?.name || "Home"}
                      </span>
                      .
                    </p>

                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleCreate();
                      }}
                    >
                      <div className="bg-landing-gradient rounded-2xl p-[1px] flex-1">
                        <input
                          name="folder-create-name"
                          className="md3-input w-full rounded-2xl"
                          placeholder="New folder name"
                          value={newFolderName}
                          onChange={(e) => {
                            setNewFolderName(e.target.value);
                            if (createError) setCreateError(null);
                          }}
                          aria-invalid={createError ? "true" : "false"}
                          aria-describedby={createError ? createErrorId : undefined}
                        />
                      </div>

                      <PlusButton
                        type="submit"
                        variant="outline"
                        size="sm"
                        loading={creating}
                        disabled={creating || !newFolderName.trim()}
                      >
                        Create
                      </PlusButton>
                    </form>

                    {createError && (
                      <p
                        id={createErrorId}
                        role="alert"
                        className="mt-2 text-xs text-red-700 dark:text-red-300"
                      >
                        {createError}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 p-4">
                    <div className="text-sm font-semibold">File name</div>
                    <p className="text-xs text-muted mt-1">
                      {mode === "pdf"
                        ? "Saved as a PDF file."
                        : "Saved as a text file."}
                    </p>

                    <div className="mt-3 bg-landing-gradient rounded-2xl p-[1px]">
                      <input
                        ref={fileNameInputRef}
                        name="capture-file-name"
                        className="md3-input w-full rounded-2xl"
                        value={fileName}
                        onChange={(e) => setFileName(e.target.value)}
                        placeholder={mode === "pdf" ? "page.pdf" : "page.txt"}
                      />
                    </div>
                  </div>

                  {showInstitutionalToggle && (
                    <div className="rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">
                            Access route
                          </div>
                          <p className="text-xs text-muted mt-1">
                            Use the IIT institutional lane only for sources that
                            require campus, VPN, or library access.
                          </p>
                        </div>

                        <span
                          className={[
                            "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            institutionalStatus.className,
                          ].join(" ")}
                        >
                          {institutionalStatus.label}
                        </span>
                      </div>

                      <label className="mt-3 flex items-start gap-3 rounded-2xl border border-border px-3 py-3 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                        <input
                          name="capture-access-route"
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={accessMode === "institutional"}
                          onChange={(e) => {
                            const nextMode = e.target.checked
                              ? "institutional"
                              : "public";
                            setAccessMode(nextMode);
                            setIcnMessage(null);
                          }}
                        />

                        <div className="min-w-0">
                          <div className="font-medium text-sm">
                            Use IIT institutional session
                          </div>
                          <div className="text-xs text-muted mt-1">
                            {accessMode === "institutional"
                              ? "This capture will be routed through the institutional capture lane."
                              : "This capture will use the normal public capture lane."}
                          </div>
                        </div>
                      </label>
                    </div>
                  )}

                  {showInstitutionalToggle &&
                    accessMode === "institutional" && (
                      <div className="rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">
                              IIT session
                            </div>
                            <p className="text-xs text-muted mt-1">
                              Open the dedicated login window, complete the
                              sign-in there, then refresh this status before
                              saving.
                            </p>
                          </div>

                          <PlusButton
                            type="button"
                            variant="outline"
                            size="sm"
                            loading={icnStatusLoading}
                            disabled={icnBusy}
                            onClick={() => {
                              setIcnMessage(null);
                              void refreshInstitutionalState();
                            }}
                          >
                            Refresh
                          </PlusButton>
                        </div>

                        {icnMessage && (
                          <div
                            className={[
                              "rounded-2xl border px-3 py-2 text-xs",
                              icnMessage.type === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : icnMessage.type === "error"
                                  ? "border-red-200 bg-red-50 text-red-800"
                                  : "border-blue-200 bg-blue-50 text-blue-800",
                            ].join(" ")}
                          >
                            {icnMessage.text}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl border border-border px-3 py-2">
                            <div className="text-muted">Node</div>
                            <div className="mt-1 font-medium text-foreground truncate">
                              {icnHealth?.nodeName || "—"}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border px-3 py-2">
                            <div className="text-muted">Cookies</div>
                            <div className="mt-1 font-medium text-foreground">
                              {typeof icnSession?.cookieCount === "number"
                                ? icnSession.cookieCount
                                : "—"}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border px-3 py-2">
                            <div className="text-muted">Browser</div>
                            <div className="mt-1 font-medium text-foreground truncate">
                              {icnHealth?.browserReady
                                ? icnHealth.browserChannel || "Ready"
                                : "Not launched yet"}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border px-3 py-2">
                            <div className="text-muted">Providers seen</div>
                            <div className="mt-1 font-medium text-foreground truncate">
                              {icnSession?.providerHints?.length
                                ? icnSession.providerHints.join(", ")
                                : "—"}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-foreground">
                            Login provider
                          </div>
                          <select
                            name="institutional-login-provider"
                            className="md3-input mt-2 w-full rounded-2xl"
                            value={loginProvider}
                            onChange={(e) =>
                              setLoginProvider(
                                e.target.value as InstitutionalProvider,
                              )
                            }
                          >
                            <option value="pressreader">PressReader</option>
                            <option value="proquest">ProQuest</option>
                            <option value="nexis">Nexis Uni</option>
                            <option value="openathens">
                              OpenAthens / library SSO
                            </option>
                            <option value="custom">
                              Custom IIT/library URL
                            </option>
                          </select>
                        </div>

                        {loginProvider === "custom" && (
                          <div className="bg-landing-gradient rounded-2xl p-[1px]">
                            <input
                              name="institutional-login-url"
                              className="md3-input w-full rounded-2xl"
                              value={customLoginUrl}
                              onChange={(e) =>
                                setCustomLoginUrl(e.target.value)
                              }
                              placeholder="Paste the exact IIT/library entry URL"
                            />
                          </div>
                        )}

                        <div className="flex items-start gap-2">
                          <PlusButton
                            type="button"
                            variant="solid"
                            loading={icnBusy}
                            disabled={icnStatusLoading}
                            onClick={() => void handleOpenInstitutionalLogin()}
                          >
                            Open login window
                          </PlusButton>

                          <div className="text-xs text-muted pt-2">
                            This opens the dedicated institutional capture
                            browser, not your normal everyday browser.
                          </div>
                        </div>

                        {!institutionalReady && (
                          <div className="text-xs text-amber-700">
                            Complete the IIT/library sign-in and refresh the
                            status before saving through the institutional lane.
                          </div>
                        )}
                      </div>
                    )}
                </div>
              </div>
            </div>

            <div className="md3-divider" />

            {/* Footer actions */}
            <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-muted flex items-center gap-2">
                <span className="truncate">
                  Destination:{" "}
                  <span className="font-medium text-foreground">
                    {destinationName}
                  </span>
                </span>

                {infoLoading && (
                  <span className="md3-chip inline-flex items-center gap-1">
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                      <path
                        className="opacity-75"
                        d="M4 12a8 8 0 0 1 8-8"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                    Loading
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 justify-end">
                <PlusButton type="button" variant="ghost" onClick={onCancel}>
                  Cancel
                </PlusButton>

                <PlusButton
                  type="button"
                  variant="solid"
                  onClick={() =>
                    onConfirm({
                      folderId: selectedFolderId ?? current,
                      fileName,
                      mode,
                      accessMode,
                    })
                  }
                  disabled={
                    !fileName.trim() ||
                    infoLoading ||
                    loading ||
                    (showInstitutionalToggle &&
                      accessMode === "institutional" &&
                      !institutionalReady)
                  }
                >
                  Save
                </PlusButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FolderPickerModal;
