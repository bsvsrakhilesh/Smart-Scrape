import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import type { SavedUrl as UISavedUrl, Collection } from "../lib/types";
import SearchFilterUrls, {
  UrlFilterState,
} from "../components/savedurls/SearchFilterUrls";
import SavedUrlCard from "../components/savedurls/SavedUrlCard";
import SavedUrlDetailModal from "../components/savedurls/SavedUrlDetailModal";
import CollectionSidebar from "../components/savedurls/CollectionSidebar";
import CollectionPickerModal from "../components/savedurls/CollectionPickerModal";
import BulkActionBar from "../components/common/BulkActionBar";
import {
  fetchSavedUrls as apiFetchSavedUrls,
  saveUrls as apiSaveUrls,
  patchUrl,
  deleteUrlsBulk,
  type BackendUrlRow,
  type UrlTaggingSummary,
  getUrlTaggingSummary,
  retryFailedUrlTagging,
  crawlSavePdf,
  crawlSaveText,
  getUrlTagJob,
  startUrlTagJob,
  getUrlById,
} from "../lib/api";
import FolderPickerModal from "../components/savedurls/FolderPickerModal";
import {
  getCollections,
  createCollection,
  getUrlCollections,
  addUrlToCollection,
  setUrlCollections,
} from "../utils/collections";
import { StaggerList, StaggerItem } from "../components/motion/StaggerList";

type SortKey = "createdAt" | "updatedAt" | "title";
type SortOrder = "asc" | "desc";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function snapshotCreatedAt(u: any): number | null {
  const s = u?.latestSnapshot;
  if (!s?.createdAt) return null;
  const t = new Date(s.createdAt).getTime();
  return Number.isFinite(t) ? t : null;
}

function isSnapshotMissing(u: any): boolean {
  return !u?.latestSnapshot;
}

function isSnapshotStale(u: any, nowMs: number): boolean {
  const t = snapshotCreatedAt(u);
  if (!t) return false;
  return nowMs - t > SNAPSHOT_STALE_DAYS * DAY_MS;
}

function getDomain(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
function faviconFor(u: string): string {
  const d = getDomain(u) || "example.com";
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(d)}`;
}

function toUISaved(row: BackendUrlRow): UISavedUrl {
  const domain = getDomain(row.url);
  const collections = getUrlCollections(row.url);
  return {
    id: String(row.id),
    url: row.url,
    title: row.title || row.url,
    description: row.snippet || "",
    faviconUrl: faviconFor(row.url),
    domain: domain || "",
    tags: row.tags || [],
    taggingStatus: row.taggingStatus ?? "NONE",
    taggingError: (row as any).taggingError ?? null,
    notes: row.notes || "",
    isFavorited: !!row.isFavorited,
    collections,
    visibility: "private",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    visitCount: 0,
    latestSnapshot: (row as any).latestSnapshot ?? null,
  };
}

const SavedUrlsPage: React.FC = () => {
  // Data
  const [urls, setUrls] = useState<UISavedUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tagging health banner
  const [tagSummary, setTagSummary] = useState<UrlTaggingSummary | null>(null);
  const [tagSummaryLoading, setTagSummaryLoading] = useState(false);
  const [tagSummaryError, setTagSummaryError] = useState<string | null>(null);

  // Collections (left sidebar)
  const [collections, setCollections] =
    useState<Collection[]>(getCollections());
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | undefined
  >(undefined);

  // Filters
  const [filter, setFilter] = useState<UrlFilterState>({
    query: "",
    favoritesOnly: false,
    tags: [],
    domains: [],
    visibility: "all",
    dateFrom: "",
    dateTo: "",
    snapshotStatus: "all" as any,
  });

  // Sort + Year
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [year, setYear] = useState<string>("all"); // 'all' or 'YYYY'

  // Selection + detail
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<UISavedUrl | null>(null);

  // Poll saved URLs briefly so newly-generated AI tags show up automatically
  const tagPollRef = useRef<number | null>(null);

  // Clipboard for bulk copy/cut/paste
  const [clipboard, setClipboard] = useState<{
    mode: "copy" | "cut";
    items: UISavedUrl[];
  } | null>(null);

  // Collection picker for "Move to…"
  const [collPickerOpen, setCollPickerOpen] = useState(false);
  const [moveIds, setMoveIds] = useState<string[]>([]);

  // Capture state (Text/PDF → folder picker)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"text" | "pdf">("text");
  const [pickerTarget, setPickerTarget] = useState<UISavedUrl | null>(null);

  // Bulk snapshot enforcement
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkPickerMode, setBulkPickerMode] = useState<"text" | "pdf">("text");
  const [bulkTargets, setBulkTargets] = useState<UISavedUrl[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkFailed, setBulkFailed] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkFailures, setBulkFailures] = useState<
    { id: string; url: string; error: string }[]
  >([]);
  const bulkAbortRef = useRef(false);

  const refreshTaggingSummary = useCallback(async () => {
    try {
      const s = await getUrlTaggingSummary();
      setTagSummary(s);
      setTagSummaryError(null);
    } catch (e: any) {
      setTagSummaryError(e?.message ?? "Failed to load tagging summary");
    }
  }, []);

  const handleRetryFailedTagging = useCallback(async () => {
    try {
      setTagSummaryLoading(true);
      const out = await retryFailedUrlTagging(); // default retries newest failed (limit 50)
      await refreshTaggingSummary();

      // refresh rows so tags/status update on screen
      const rows = await apiFetchSavedUrls();
      setUrls(rows.map(toUISaved));

      if (out?.scheduled === 0) {
        alert("No failed items to retry.");
      }
    } catch (e: any) {
      alert(e?.message ?? "Retry failed");
    } finally {
      setTagSummaryLoading(false);
    }
  }, [refreshTaggingSummary]);

  async function runPool<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ) {
    const q = [...items];
    const runners = new Array(Math.min(limit, items.length))
      .fill(0)
      .map(async () => {
        while (q.length) {
          if (bulkAbortRef.current) return;
          const item = q.shift()!;
          await worker(item);
        }
      });
    await Promise.all(runners);
  }

  const startBulkCapture = useCallback(
    async (
      mode: "text" | "pdf",
      targets: UISavedUrl[],
      folderId?: string | null,
    ) => {
      if (!targets.length) return;

      bulkAbortRef.current = false;
      setBulkRunning(true);
      setBulkDone(0);
      setBulkFailed(0);
      setBulkTotal(targets.length);
      setBulkFailures([]);

      const worker = async (u: UISavedUrl) => {
        const urlId = Number(u.id);
        try {
          if (mode === "pdf") {
            // NOTE: omit fileName → backend generates; we still pass urlId
            await crawlSavePdf(
              u.url,
              folderId ?? undefined,
              undefined,
              true,
              true,
              urlId,
            );
          } else {
            await crawlSaveText(u.url, folderId ?? undefined, undefined, urlId);
          }
          setBulkDone((x) => x + 1);
        } catch (e: any) {
          setBulkFailed((x) => x + 1);
          setBulkFailures((prev) => [
            ...prev,
            { id: u.id, url: u.url, error: e?.message ?? "Capture failed" },
          ]);
        }
      };

      try {
        // limit=2 keeps load sane; bump to 3 if you want faster
        await runPool(targets, 2, worker);

        // refresh list so latestSnapshot updates
        const rows = await apiFetchSavedUrls();
        setUrls(rows.map(toUISaved));
      } finally {
        setBulkRunning(false);
      }
    },
    [],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const rows = await apiFetchSavedUrls();
        setUrls(rows.map(toUISaved));
        await refreshTaggingSummary();
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load saved URLs");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshTaggingSummary]);

  useEffect(() => {
    if (!tagSummary || tagSummary.inProgress <= 0) return;
    const id = window.setInterval(() => {
      refreshTaggingSummary();
    }, 5000);
    return () => window.clearInterval(id);
  }, [tagSummary?.inProgress, refreshTaggingSummary]);

  useEffect(() => {
    const needsPolling = (rows: UISavedUrl[]) => {
      const now = Date.now();
      return rows.some((u) => {
        const ageMs = now - new Date(u.createdAt).getTime();
        const status = (u as any).taggingStatus;
        const isTagging = status === "PENDING" || status === "RUNNING";
        const hasNoTags = (u.tags?.length ?? 0) === 0;

        // If backend is actively tagging, poll. Also keep old fallback for older rows.
        return (
          (isTagging && ageMs < 10 * 60 * 1000) ||
          (hasNoTags && ageMs < 10 * 60 * 1000)
        );
      });
    };

    // Stop polling if nothing needs it
    if (!needsPolling(urls)) {
      if (tagPollRef.current) {
        window.clearInterval(tagPollRef.current);
        tagPollRef.current = null;
      }
      return;
    }

    // Already polling
    if (tagPollRef.current) return;

    let ticks = 0;
    const MAX_TICKS = 20; // ~60 seconds (20 * 3s)

    const stop = () => {
      if (tagPollRef.current) {
        window.clearInterval(tagPollRef.current);
        tagPollRef.current = null;
      }
    };

    tagPollRef.current = window.setInterval(async () => {
      ticks++;
      try {
        const rows = await apiFetchSavedUrls();
        const ui = rows.map(toUISaved);
        setUrls(ui);

        // If tags arrived (or time budget exceeded), stop polling
        if (!needsPolling(ui) || ticks >= MAX_TICKS) stop();
      } catch {
        if (ticks >= MAX_TICKS) stop();
      }
    }, 3000);

    return stop;
  }, [urls]);

  // Domain/Tag options
  const availableDomains = useMemo(
    () => Array.from(new Set(urls.map((u) => u.domain).filter(Boolean))).sort(),
    [urls],
  );
  const availableTags = useMemo(
    () => Array.from(new Set(urls.flatMap((u) => u.tags || []))).sort(),
    [urls],
  );

  const snapshotHealth = useMemo(() => {
    const nowMs = Date.now();
    const missing = urls.filter((u) => isSnapshotMissing(u));
    const stale = urls.filter(
      (u) => !isSnapshotMissing(u) && isSnapshotStale(u, nowMs),
    );
    return {
      missing,
      stale,
      missingCount: missing.length,
      staleCount: stale.length,
    };
  }, [urls]);

  // Years from createdAt
  const availableYears = useMemo(() => {
    const s = new Set<string>();
    urls.forEach((u) => {
      const y = new Date(u.createdAt).getFullYear();
      if (!Number.isNaN(y)) s.add(String(y));
    });
    return ["all", ...Array.from(s).sort((a, b) => Number(b) - Number(a))];
  }, [urls]);

  // Apply existing filters
  const filteredByForm = useMemo(() => {
    return urls.filter((u) => {
      if (filter.visibility !== "all" && u.visibility !== filter.visibility)
        return false;
      if (filter.domains.length && !filter.domains.includes(u.domain))
        return false;
      if (
        filter.tags.length &&
        !(u.tags || []).some((t) => filter.tags.includes(t))
      )
        return false;
      if (filter.favoritesOnly && !u.isFavorited) return false;
      if (filter.query) {
        const q = filter.query.toLowerCase();
        const hay = `${u.title} ${u.url} ${u.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter.dateFrom) {
        const d = new Date(u.createdAt).getTime();
        const from = new Date(filter.dateFrom).getTime();
        if (d < from) return false;
      }
      if (filter.dateTo) {
        const d = new Date(u.createdAt).getTime();
        const to = new Date(filter.dateTo).getTime();
        if (d > to) return false;
      }
      // Snapshot filter
      const snap = (filter as any).snapshotStatus || "all";
      if (snap !== "all") {
        const nowMs = Date.now();
        const missing = isSnapshotMissing(u);
        const stale = isSnapshotStale(u, nowMs);
        const fresh = !missing && !stale;

        if (snap === "missing" && !missing) return false;
        if (snap === "stale" && !stale) return false;
        if (snap === "fresh" && !fresh) return false;
      }
      return true;
    });
  }, [urls, filter]);

  // Collection filter (if a category selected on left)
  const filteredByCollection = useMemo(() => {
    if (!selectedCollectionId) return filteredByForm;
    return filteredByForm.filter((u) =>
      (u.collections || []).includes(selectedCollectionId),
    );
  }, [filteredByForm, selectedCollectionId]);

  // Year filter + sort
  const yearFiltered = useMemo(() => {
    if (year === "all") return filteredByCollection;
    return filteredByCollection.filter(
      (u) => String(new Date(u.createdAt).getFullYear()) === year,
    );
  }, [filteredByCollection, year]);

  const sorted = useMemo(() => {
    const dir = sortOrder === "asc" ? 1 : -1;
    const arr = [...yearFiltered].sort((a, b) => {
      if (sortKey === "title") {
        const av = (a.title || "").toLowerCase();
        const bv = (b.title || "").toLowerCase();
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      }
      const av = new Date(a[sortKey]).getTime();
      const bv = new Date(b[sortKey]).getTime();
      return av === bv ? 0 : (av < bv ? -1 : 1) * dir;
    });
    return arr;
  }, [yearFiltered, sortKey, sortOrder]);

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectedItems = useMemo(
    () => urls.filter((u) => selection.has(u.id)),
    [urls, selection],
  );

  // Select all (filtered) & clear
  const selectAllFiltered = useCallback(
    () => setSelection(new Set(sorted.map((u) => u.id))),
    [sorted],
  );
  const clearSelection = useCallback(() => setSelection(new Set()), []);

  // Persisted actions
  const handleFavoriteToggle = async (u: UISavedUrl) => {
    const idNum = Number(u.id);
    setUrls((prev) =>
      prev.map((x) =>
        x.id === u.id ? { ...x, isFavorited: !x.isFavorited } : x,
      ),
    );
    try {
      await patchUrl(idNum, { isFavorited: !u.isFavorited });
    } catch {
      setUrls((prev) =>
        prev.map((x) =>
          x.id === u.id ? { ...x, isFavorited: u.isFavorited } : x,
        ),
      );
      alert("Failed to update favorite");
    }
  };

  const handleNotesChange = async (id: string, notes: string) => {
    const idNum = Number(id);
    const before = urls.find((u) => u.id === id)?.notes ?? "";
    setUrls((prev) => prev.map((x) => (x.id === id ? { ...x, notes } : x)));
    try {
      await patchUrl(idNum, { notes });
    } catch {
      setUrls((prev) =>
        prev.map((x) => (x.id === id ? { ...x, notes: before } : x)),
      );
      alert("Failed to save notes");
    }
  };

  const updateTags = async (id: string, tags: string[]) => {
    const idNum = Number(id);
    const before = urls.find((u) => u.id === id)?.tags ?? [];
    setUrls((prev) => prev.map((x) => (x.id === id ? { ...x, tags } : x)));
    try {
      await patchUrl(idNum, { tags });
    } catch {
      setUrls((prev) =>
        prev.map((x) => (x.id === id ? { ...x, tags: before } : x)),
      );
      alert("Failed to update tags");
    }
  };

  // Bulk actions
  const onFavorite = async (ids: string[]) => {
    const idsNum = ids.map(Number);
    setUrls((prev) =>
      prev.map((u) => (ids.includes(u.id) ? { ...u, isFavorited: true } : u)),
    );
    try {
      await Promise.all(
        idsNum.map((id) => patchUrl(id, { isFavorited: true })),
      );
    } catch {
      alert("Some favorites failed to update");
    }
  };
  // Bulk AI auto-tag selected URLs
  const onAutoTagSelected = useCallback(
    async (ids: string[]) => {
      if (!ids?.length) return;
      const targets = urls.filter((u) => ids.includes(u.id));

      for (const u of targets) {
        try {
          // 1) start job
          const idNum = Number(u.id);
          const { jobId } = await startUrlTagJob(idNum);

          // 2) poll job
          let attempt = 0;
          while (attempt < 90) {
            // ~90s
            const data = await getUrlTagJob(jobId, idNum);

            if (data?.state === "SUCCESS") {
              const ai = Array.from(
                new Set<string>((data.tags ?? []).map(String)),
              );
              const merged = Array.from(new Set([...(u.tags ?? []), ...ai]));

              // 3) update UI immediately
              setUrls((prev) =>
                prev.map((x) => (x.id === u.id ? { ...x, tags: merged } : x)),
              );

              // NEW: replace optimistic tags with server truth (backend merge + meta)
              try {
                const freshRow = await getUrlById(idNum);
                setUrls((prev) =>
                  prev.map((x) => (x.id === u.id ? toUISaved(freshRow) : x)),
                );
              } catch (e) {
                console.warn("Failed to refresh URL after AI tag", idNum, e);
              }

              // Persist is handled by GET /api/tag-jobs/:jobId?urlId=... when state=SUCCESS
              break;
            }

            if (data?.state === "FAILURE") {
              throw new Error(data?.error || "AI tagging failed");
            }

            await new Promise((r) => setTimeout(r, 1000));
            attempt++;
          }
        } catch (err) {
          console.error("Auto-tag URL failed", u.id, err);
        }
      }
    },
    [urls],
  );

  const onAddTag = async (ids: string[], tag: string) => {
    if (!tag) return;
    const idsNum = ids.map(Number);
    setUrls((prev) =>
      prev.map((u) =>
        ids.includes(u.id)
          ? { ...u, tags: Array.from(new Set([...(u.tags || []), tag])) }
          : u,
      ),
    );
    try {
      await Promise.all(
        idsNum.map((id) => {
          const current = urls.find((u) => u.id === String(id))?.tags ?? [];
          const next = Array.from(new Set([...current, tag]));
          return patchUrl(id, { tags: next });
        }),
      );
    } catch {
      alert("Failed to add tag to some items");
    }
  };

  const onDelete = async (ids: string[]) => {
    const idsNum = ids.map(Number);
    const backup = urls;
    setUrls((prev) => prev.filter((u) => !ids.includes(u.id)));
    setSelection(new Set());
    try {
      await deleteUrlsBulk(idsNum);
    } catch {
      setUrls(backup);
      alert("Failed to delete selected");
    }
  };

  // -------- Clipboard + Move handlers --------
  const byIds = useCallback(
    (ids: string[]) => urls.filter((u) => ids.includes(u.id)),
    [urls],
  );

  const handleCopy = useCallback(
    (ids: string[]) => {
      const items = byIds(ids);
      if (items.length) setClipboard({ mode: "copy", items });
    },
    [byIds],
  );

  const handleCut = useCallback(
    (ids: string[]) => {
      const items = byIds(ids);
      if (items.length) setClipboard({ mode: "cut", items });
    },
    [byIds],
  );

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    if (!selectedCollectionId) {
      alert("Choose a category on the left to paste into.");
      return;
    }
    try {
      if (clipboard.mode === "copy") {
        clipboard.items.forEach((u) =>
          addUrlToCollection(selectedCollectionId, u.url),
        );
        setUrls((prev) =>
          prev.map((u) =>
            clipboard.items.some((it) => it.id === u.id)
              ? {
                  ...u,
                  collections: Array.from(
                    new Set([...(u.collections || []), selectedCollectionId]),
                  ),
                }
              : u,
          ),
        );
      } else {
        clipboard.items.forEach((u) =>
          setUrlCollections(u.url, [selectedCollectionId]),
        );
        setUrls((prev) =>
          prev.map((u) =>
            clipboard.items.some((it) => it.id === u.id)
              ? { ...u, collections: [selectedCollectionId] }
              : u,
          ),
        );
      }
    } finally {
      setClipboard(null);
    }
  }, [clipboard, selectedCollectionId]);

  const handleMoveTo = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setMoveIds(ids);
    setCollPickerOpen(true);
  }, []);

  const canPaste = !!clipboard && !!selectedCollectionId;

  // Quick add
  const handleQuickAdd = async (value: string) => {
    const raw = value.trim();
    if (!raw) return;
    try {
      await apiSaveUrls([{ url: raw, title: raw, snippet: "" }]);
      setUrls((prev) => [
        toUISaved({
          id: Date.now(),
          url: raw,
          title: raw,
          snippet: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isFavorited: false,
          notes: "",
          tags: [],
        } as any),
        ...prev,
      ]);
    } catch {
      alert("Failed to save URL");
    }
  };

  // Global shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        (target?.isContentEditable ?? false);
      if (typing) return;
      if (collPickerOpen || pickerOpen || !!detail) return;

      if (isMeta && key === "c") {
        if (selectedItems.length) {
          e.preventDefault();
          handleCopy(selectedItems.map((u) => u.id));
        }
      } else if (isMeta && key === "x") {
        if (selectedItems.length) {
          e.preventDefault();
          handleCut(selectedItems.map((u) => u.id));
        }
      } else if (isMeta && key === "v") {
        if (clipboard && selectedCollectionId) {
          e.preventDefault();
          handlePaste();
        }
      } else if (key === "escape") {
        if (selection.size) {
          e.preventDefault();
          clearSelection();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedItems,
    clipboard,
    selectedCollectionId,
    collPickerOpen,
    pickerOpen,
    detail,
    selection.size,
    handleCopy,
    handleCut,
    handlePaste,
    clearSelection,
  ]);

  return (
    <main className="space-y-6 px-4 md:px-6 lg:px-8 pt-6 md:pt-8">
      <header className="page-header">
        <div className="page-header-main">
          <p className="page-header-kicker">Library</p>
          <h1 className="page-header-title">Saved URLs</h1>
          <p className="page-header-subtitle">
            Browse, filter, and organise all the links you have collected from
            searches and uploads.
          </p>
        </div>

        <div className="page-header-meta">
          <div className="page-header-pill">
            <span className="page-header-pill-label">Links</span>
            <span className="page-header-pill-value">{urls.length}</span>
          </div>
          {selection.size > 0 && (
            <div className="page-header-pill page-header-pill--accent">
              <span className="page-header-pill-label">Selected</span>
              <span className="page-header-pill-value">{selection.size}</span>
            </div>
          )}
        </div>
      </header>

      {tagSummary && (tagSummary.inProgress > 0 || tagSummary.failed > 0) && (
        <div className="fm-panel p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/10">
          <div className="text-sm text-amber-950 dark:text-amber-100">
            <span className="font-semibold">AI Tagging</span>
            <span className="ml-2">
              Pending{" "}
              <span className="font-semibold">
                {tagSummary.byStatus?.PENDING ?? 0}
              </span>
              , Running{" "}
              <span className="font-semibold">
                {tagSummary.byStatus?.RUNNING ?? 0}
              </span>
              , Failed{" "}
              <span className="font-semibold">{tagSummary.failed}</span>
            </span>
            {tagSummaryError && (
              <span className="ml-2 opacity-70">({tagSummaryError})</span>
            )}
          </div>

          {tagSummary.failed > 0 && (
            <button
              className="btn-primary px-4 py-2 rounded-lg disabled:opacity-60"
              onClick={handleRetryFailedTagging}
              disabled={tagSummaryLoading}
              title="Re-run auto-tagging for failed URLs"
            >
              {tagSummaryLoading ? "Retrying…" : "Retry failed"}
            </button>
          )}
        </div>
      )}

      {(snapshotHealth.missingCount > 0 || snapshotHealth.staleCount > 0) && (
        <div className="fm-panel p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-sky-200 bg-sky-50/60 dark:border-sky-900/40 dark:bg-sky-900/10">
          <div className="text-sm text-sky-950 dark:text-sky-100">
            <span className="font-semibold">Snapshots</span>
            <span className="ml-2">
              Missing{" "}
              <span className="font-semibold">
                {snapshotHealth.missingCount}
              </span>
              {" • "}
              Stale (&gt;{SNAPSHOT_STALE_DAYS}d){" "}
              <span className="font-semibold">{snapshotHealth.staleCount}</span>
            </span>

            {bulkRunning && (
              <span className="ml-2 opacity-80">
                (Running: {bulkDone}/{bulkTotal}, Failed: {bulkFailed})
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              className="btn-secondary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={() =>
                setFilter((f: any) => ({ ...f, snapshotStatus: "missing" }))
              }
              disabled={bulkRunning}
              title="Show only URLs that have no snapshots"
            >
              Show missing
            </button>

            <button
              className="btn-secondary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={() =>
                setFilter((f: any) => ({ ...f, snapshotStatus: "stale" }))
              }
              disabled={bulkRunning}
              title="Show only URLs with stale snapshots"
            >
              Show stale
            </button>

            {snapshotHealth.missingCount > 0 && (
              <>
                <button
                  className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
                  onClick={() => {
                    setBulkTargets(snapshotHealth.missing);
                    setBulkPickerMode("text");
                    setBulkPickerOpen(true);
                  }}
                  disabled={bulkRunning}
                  title="Capture TEXT snapshots for all missing URLs"
                >
                  Snapshot missing (Text)
                </button>

                <button
                  className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
                  onClick={() => {
                    setBulkTargets(snapshotHealth.missing);
                    setBulkPickerMode("pdf");
                    setBulkPickerOpen(true);
                  }}
                  disabled={bulkRunning}
                  title="Capture PDF snapshots for all missing URLs"
                >
                  Snapshot missing (PDF)
                </button>
              </>
            )}

            {snapshotHealth.staleCount > 0 && (
              <>
                <button
                  className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
                  onClick={() => {
                    setBulkTargets(snapshotHealth.stale);
                    setBulkPickerMode("text");
                    setBulkPickerOpen(true);
                  }}
                  disabled={bulkRunning}
                  title="Refresh TEXT snapshots for all stale URLs"
                >
                  Refresh stale (Text)
                </button>

                <button
                  className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
                  onClick={() => {
                    setBulkTargets(snapshotHealth.stale);
                    setBulkPickerMode("pdf");
                    setBulkPickerOpen(true);
                  }}
                  disabled={bulkRunning}
                  title="Refresh PDF snapshots for all stale URLs"
                >
                  Refresh stale (PDF)
                </button>
              </>
            )}

            {bulkRunning && (
              <button
                className="btn-secondary px-3 py-2 rounded-lg"
                onClick={() => {
                  bulkAbortRef.current = true;
                }}
                title="Stop after current in-flight captures finish"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {bulkFailures.length > 0 && !bulkRunning && (
        <div className="fm-panel p-3 sm:p-4 border border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-900/10">
          <div className="text-sm text-rose-950 dark:text-rose-100">
            <span className="font-semibold">Snapshot failures:</span>{" "}
            {bulkFailures.length}
            <div className="mt-2 max-h-40 overflow-auto text-xs space-y-1">
              {bulkFailures.slice(0, 50).map((f) => (
                <div key={f.id} className="truncate">
                  {f.url} — {f.error}
                </div>
              ))}
              {bulkFailures.length > 50 && (
                <div className="opacity-80">…and more</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grid inside AppShell content */}
      <section className="grid grid-cols-12 gap-4 sm:gap-6">
        {/* Sidebar */}
        <div className="col-span-12 md:col-span-4 lg:col-span-3">
          <div className="md:sticky md:top-20 lg:top-[76px]">
            <div className="fm-panel h-full p-4 sm:p-5">
              <CollectionSidebar
                collections={collections}
                selectedCollectionId={selectedCollectionId}
                onSelect={(id) => setSelectedCollectionId(id)}
                onCreate={(name) => {
                  const created = createCollection(name);
                  setCollections(getCollections());
                  setSelectedCollectionId(created.id);
                }}
              />
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="col-span-12 md:col-span-8 lg:col-span-9">
          <div className="fm-panel p-4 sm:p-5 space-y-4 md:space-y-5 mb-10">
            {/* Toolbar: 2-row responsive grid to avoid collisions */}
            <header
              className="toolbar--glass relative grid grid-cols-12 gap-3 rounded-xl p-3 md:p-4 ring-1 ring-black/5 dark:ring-white/10 supports-backdrop:backdrop-blur-md"
              role="toolbar"
              aria-label="Saved URLs controls"
            >
              {/* Row 1: Search (full width) */}
              <div className="col-span-12">
                <SearchFilterUrls
                  availableDomains={availableDomains}
                  availableTags={availableTags}
                  initial={filter}
                  onChange={setFilter}
                />
              </div>

              {/* Row 2: ALL SELECTS IN ONE ROW */}
              <div className="col-span-12">
                <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap md:whitespace-normal md:overflow-visible">
                  {/* Year */}
                  <label className="sr-only" htmlFor="year-filter">
                    Filter by year
                  </label>
                  <select
                    id="year-filter"
                    className="input-pill w-auto shrink-0 min-w-[9rem] text-sm py-2 px-3 hover:cursor-pointer transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    title="Filter by year"
                  >
                    {availableYears.map((y) => (
                      <option key={y} value={y}>
                        {y === "all" ? "All years" : y}
                      </option>
                    ))}
                  </select>

                  {/* Sort key */}
                  <label className="sr-only" htmlFor="sortKey">
                    Sort key
                  </label>
                  <select
                    id="sortKey"
                    className="input-pill w-auto shrink-0 min-w-[11rem] text-sm py-2 px-3 hover:cursor-pointer transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    title="Sort key"
                  >
                    <option value="createdAt">Sort: Created</option>
                    <option value="updatedAt">Sort: Updated</option>
                    <option value="title">Sort: Title</option>
                  </select>

                  {/* Sort order */}
                  <label className="sr-only" htmlFor="sortOrder">
                    Sort order
                  </label>
                  <select
                    id="sortOrder"
                    className="input-pill w-auto shrink-0 min-w-[7rem] text-sm py-2 px-3 hover:cursor-pointer transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                    title="Sort order"
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </div>
              </div>

              {/* Row 3: QUICK ADD (next row, full width) */}
              <div className="col-span-12">
                <label className="sr-only" htmlFor="quick-add-url">
                  Quick add URL
                </label>
                <input
                  id="quick-add-url"
                  type="text"
                  aria-label="Quick add URL"
                  placeholder="Paste a URL and press Enter"
                  className="input h-11 w-full md:w-[min(100%,28rem)] rounded-lg shadow-sm transition focus:ring-2 focus:ring-brand-primary/40 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleQuickAdd((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
            </header>

            {/* Selection controls */}
            {sorted.length > 0 && (
              <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                <div>
                  {selection.size > 0
                    ? `${selection.size} selected`
                    : "No selection"}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="btn-ghost px-2 py-1 rounded-lg transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    title="Select all items that match current filters"
                  >
                    Select all ({sorted.length})
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="btn-ghost px-2 py-1 rounded-lg transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    title="Clear current selection"
                  >
                    Clear selection
                  </button>
                  <button
                    onClick={() =>
                      onAutoTagSelected(selectedItems.map((u) => u.id))
                    }
                    className="btn-primary inline-flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40 disabled:opacity-50"
                    title="Run AI auto-tag on selected URLs"
                  >
                    AI Auto-Tag selected
                  </button>
                </div>
              </div>
            )}

            {/* Bulk action bar */}
            {selectedItems.length > 0 && (
              <div className="sticky top-20 lg:top-[76px] z-20">
                <BulkActionBar
                  selected={selectedItems}
                  onDelete={onDelete}
                  onAddTag={onAddTag}
                  onFavorite={onFavorite}
                  onExport={() => {
                    const headers = [
                      "title",
                      "url",
                      "description",
                      "createdAt",
                    ];
                    const csv = [
                      headers.join(","),
                      ...selectedItems.map((r) =>
                        [
                          r.title,
                          r.url,
                          (r.description || "").replace(/[\r\n,]+/g, " "),
                          r.createdAt,
                        ]
                          .map(
                            (v) => `"${String(v ?? "").replace(/"/g, '""')}"`,
                          )
                          .join(","),
                      ),
                    ].join("\n");
                    const blob = new Blob([csv], {
                      type: "text/csv;charset=utf-8;",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "saved_urls.csv";
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  onCopy={handleCopy}
                  onCut={handleCut}
                  onPaste={handlePaste}
                  canPaste={canPaste}
                  onMoveTo={handleMoveTo}
                />
              </div>
            )}

            {/* Content states */}
            {loading && (
              <div className="card p-8 text-center text-gray-600 dark:text-gray-300">
                <div
                  className="loading-bar mx-auto"
                  aria-label="Loading saved URLs"
                />
              </div>
            )}
            {error && !loading && (
              <div className="card border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4">
                {error}
              </div>
            )}
            {!loading && !error && sorted.length === 0 && (
              <div className="card p-10 text-center text-gray-600 dark:text-gray-300">
                No saved URLs match your filters.
              </div>
            )}

            {/* Cards */}
            <StaggerList className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5 2xl:gap-6">
              {sorted.map((u) => (
                <StaggerItem key={u.id}>
                  <SavedUrlCard
                    url={u}
                    selected={selection.has(u.id)}
                    onSelect={() => toggleSelect(u.id)}
                    onFavoriteToggle={handleFavoriteToggle}
                    onOpenDetail={(x) => setDetail(x)}
                    onCapture={async (x, mode) => {
                      setPickerTarget(x);
                      setPickerMode(mode);
                      setPickerOpen(true);
                    }}
                  />
                </StaggerItem>
              ))}
            </StaggerList>

            {/* Modals */}
            <CollectionPickerModal
              isOpen={collPickerOpen}
              collections={collections}
              onCancel={() => {
                setCollPickerOpen(false);
                setMoveIds([]);
              }}
              onConfirm={(collectionId) => {
                const ids = moveIds;
                const items = byIds(ids);
                items.forEach((u) => setUrlCollections(u.url, [collectionId]));
                setUrls((prev) =>
                  prev.map((u) =>
                    ids.includes(u.id)
                      ? { ...u, collections: [collectionId] }
                      : u,
                  ),
                );
                setCollPickerOpen(false);
                setMoveIds([]);
              }}
              onCreate={(name) => {
                const created = createCollection(name);
                setCollections(getCollections());
                return created;
              }}
            />

            <FolderPickerModal
              open={pickerOpen}
              suggestedName={
                pickerMode === "pdf"
                  ? `${(pickerTarget?.title || pickerTarget?.domain || "page").slice(0, 60)}.pdf`
                  : `${(pickerTarget?.title || pickerTarget?.domain || "page").slice(0, 60)}.txt`
              }
              mode={pickerMode}
              onCancel={() => setPickerOpen(false)}
              onConfirm={async ({ folderId, fileName, mode }) => {
                if (!pickerTarget) return;
                const urlId = Number(pickerTarget.id);

                try {
                  if (mode === "pdf") {
                    await crawlSavePdf(
                      pickerTarget.url,
                      folderId ?? undefined,
                      fileName,
                      true,
                      true,
                      urlId,
                    );
                  } else {
                    await crawlSaveText(
                      pickerTarget.url,
                      folderId ?? undefined,
                      fileName,
                      urlId,
                    );
                  }

                  // refresh list so latestSnapshot appears immediately
                  const rows = await apiFetchSavedUrls();
                  setUrls(rows.map(toUISaved));
                } catch (e) {
                  alert("Capture failed");
                } finally {
                  setPickerOpen(false);
                }
              }}
            />

            <FolderPickerModal
              open={bulkPickerOpen}
              suggestedName={bulkPickerMode === "pdf" ? "page.pdf" : "page.txt"}
              mode={bulkPickerMode}
              onCancel={() => {
                setBulkPickerOpen(false);
                setBulkTargets([]);
              }}
              onConfirm={async ({ folderId, mode }) => {
                try {
                  await startBulkCapture(
                    mode,
                    bulkTargets,
                    folderId ?? undefined,
                  );
                } finally {
                  setBulkPickerOpen(false);
                  setBulkTargets([]);
                }
              }}
            />

            {detail && (
              <SavedUrlDetailModal
                url={detail}
                isOpen={true}
                onClose={() => setDetail(null)}
                onFavoriteToggle={handleFavoriteToggle}
                onTagUpdate={updateTags}
                onNotesChange={handleNotesChange}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
};
export default SavedUrlsPage;
