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
import SourceRegistryTable from "../components/savedurls/SourceRegistryTable";
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
import FolderPickerModal from "../components/urlcollector/FolderPickerModal";
import {
  getCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  getUrlCollections,
  addUrlToCollection,
  setUrlCollections,
} from "../utils/collections";
import { StaggerList, StaggerItem } from "../components/motion/StaggerList";
import {
  loadReviewStampMap,
  saveReviewStampMap,
  markReviewedEntries,
  isUpdatedSinceReview,
  type ReviewStampMap,
} from "../utils/reviewState";
import TextEntryModal from "../components/common/TextEntryModal";
import { useToast } from "../components/providers/Toast";
import { useConfirm } from "../components/providers/Confirm";

type SortKey = "createdAt" | "updatedAt" | "title";
type SortOrder = "asc" | "desc";

type SavedUrlQueueId =
  | "all"
  | "never-captured"
  | "stale-capture"
  | "ai-failed"
  | "metadata-missing"
  | "updated-since-review";

type SavedUrlSearchPreset = {
  id: string;
  name: string;
  filter: UrlFilterState;
  sortKey: SortKey;
  sortOrder: SortOrder;
  year: string;
  selectedCollectionId?: string;
  queueId: SavedUrlQueueId;
};

const SAVED_URLS_REVIEWED_KEY = "saved-urls:reviewed-at";
const SAVED_URLS_SEARCHES_KEY = "saved-urls:saved-searches";

type SavedUrlsViewMode = "registry" | "cards";
type SavedUrlsTextDialog =
  | {
      kind: "collection";
      mode: "create" | "rename";
      collectionId?: string;
      value: string;
    }
  | { kind: "saved-search"; value: string };

const SAVED_URLS_VIEW_KEY = "saved-urls:view-mode";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_URL_FILTER: UrlFilterState = {
  query: "",
  favoritesOnly: false,
  tags: [],
  domains: [],
  visibility: "all",
  dateFrom: "",
  dateTo: "",
  snapshotStatus: "all",
  taggingStatus: "all",
  metadataState: "all",
};

const DEFAULT_SORT_KEY: SortKey = "createdAt";
const DEFAULT_SORT_ORDER: SortOrder = "desc";
const DEFAULT_YEAR = "all";
const DEFAULT_QUEUE_ID: SavedUrlQueueId = "all";

const DEFAULT_REVIEW_VIEW_SIGNATURE = JSON.stringify({
  filter: DEFAULT_URL_FILTER,
  sortKey: DEFAULT_SORT_KEY,
  sortOrder: DEFAULT_SORT_ORDER,
  year: DEFAULT_YEAR,
  selectedCollectionId: null,
  queueId: DEFAULT_QUEUE_ID,
});

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
    publishedAt: (row as any).publishedAt ?? null,
    authors: Array.isArray((row as any).authors) ? (row as any).authors : [],
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
    tagsMetaRaw: (row as any).tagsMeta ?? null,
    taggerVersion: (row as any).taggerVersion ?? null,
    contentHash: (row as any).contentHash ?? null,
  };
}

function urlHasMissingMetadata(u: UISavedUrl) {
  return !u.publishedAt || !u.authors?.length || !u.tags?.length;
}

function loadSavedUrlSearchPresets(): SavedUrlSearchPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_URLS_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SavedUrlsPage: React.FC = () => {
  const { notify } = useToast();
  const { confirm } = useConfirm();
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

  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const url of urls) {
      for (const collectionId of url.collections || []) {
        counts[collectionId] = (counts[collectionId] ?? 0) + 1;
      }
    }

    return counts;
  }, [urls]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId),
    [collections, selectedCollectionId],
  );

  // Filters
  const [filter, setFilter] = useState<UrlFilterState>({
    ...DEFAULT_URL_FILTER,
  });

  // Sort + Year
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [year, setYear] = useState<string>(DEFAULT_YEAR); // 'all' or 'YYYY'

  const [activeQueueId, setActiveQueueId] =
    useState<SavedUrlQueueId>(DEFAULT_QUEUE_ID);

  const [reviewedAtById, setReviewedAtById] = useState<ReviewStampMap>(() =>
    loadReviewStampMap(SAVED_URLS_REVIEWED_KEY),
  );

  useEffect(() => {
    saveReviewStampMap(SAVED_URLS_REVIEWED_KEY, reviewedAtById);
  }, [reviewedAtById]);

  const [savedSearches, setSavedSearches] = useState<SavedUrlSearchPreset[]>(
    () => loadSavedUrlSearchPresets(),
  );
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(
    null,
  );

  const [textDialog, setTextDialog] = useState<SavedUrlsTextDialog | null>(
    null,
  );
  const [textDialogValue, setTextDialogValue] = useState("");
  const [textDialogBusy, setTextDialogBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      SAVED_URLS_SEARCHES_KEY,
      JSON.stringify(savedSearches),
    );
  }, [savedSearches]);

  useEffect(() => {
    setTextDialogValue(textDialog?.value ?? "");
  }, [textDialog]);

  const [viewMode, setViewMode] = useState<SavedUrlsViewMode>(() => {
    if (typeof window === "undefined") return "registry";
    const stored = localStorage.getItem(SAVED_URLS_VIEW_KEY);
    return stored === "cards" ? "cards" : "registry";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SAVED_URLS_VIEW_KEY, viewMode);
  }, [viewMode]);

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

  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

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
      const out = await retryFailedUrlTagging();
      await refreshTaggingSummary();

      const rows = await apiFetchSavedUrls();
      setUrls(rows.map(toUISaved));

      if ((out?.scheduled ?? 0) === 0) {
        notify({
          text: "No failed URLs were queued for retry.",
          kind: "info",
        });
      } else {
        notify({
          text: `Queued ${out.scheduled} failed URL${out.scheduled === 1 ? "" : "s"} for retry.`,
          kind: "success",
        });
      }
    } catch (e: any) {
      notify({
        text: e?.message ?? "Retry failed.",
        kind: "error",
      });
    } finally {
      setTagSummaryLoading(false);
    }
  }, [refreshTaggingSummary, notify]);

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

      if (
        filter.taggingStatus &&
        filter.taggingStatus !== "all" &&
        (u.taggingStatus ?? "NONE") !== filter.taggingStatus
      ) {
        return false;
      }

      if (filter.metadataState === "missing" && !urlHasMissingMetadata(u)) {
        return false;
      }

      if (filter.metadataState === "complete" && urlHasMissingMetadata(u)) {
        return false;
      }

      if (filter.query) {
        const q = filter.query.toLowerCase();
        const hay = [
          u.title,
          u.url,
          u.description ?? "",
          u.domain ?? "",
          u.notes ?? "",
          ...(u.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();

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

  const queueFiltered = useMemo(() => {
    const nowMs = Date.now();

    return filteredByCollection.filter((u) => {
      if (activeQueueId === "all") return true;
      if (activeQueueId === "never-captured") return isSnapshotMissing(u);
      if (activeQueueId === "stale-capture") {
        return !isSnapshotMissing(u) && isSnapshotStale(u, nowMs);
      }
      if (activeQueueId === "ai-failed") {
        return (u.taggingStatus ?? "NONE") === "FAILED";
      }
      if (activeQueueId === "metadata-missing") {
        return urlHasMissingMetadata(u);
      }
      if (activeQueueId === "updated-since-review") {
        return isUpdatedSinceReview(u.updatedAt, reviewedAtById[u.id]);
      }
      return true;
    });
  }, [filteredByCollection, activeQueueId, reviewedAtById]);

  // Year filter + sort
  const yearFiltered = useMemo(() => {
    if (year === "all") return queueFiltered;
    return queueFiltered.filter(
      (u) => String(new Date(u.createdAt).getFullYear()) === year,
    );
  }, [queueFiltered, year]);

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

  const reviewQueues = useMemo(() => {
    const nowMs = Date.now();
    const base = filteredByCollection;

    return [
      {
        id: "all" as SavedUrlQueueId,
        label: "All",
        count: base.length,
        help: "Everything in the current scope",
      },
      {
        id: "never-captured" as SavedUrlQueueId,
        label: "Never captured",
        count: base.filter((u) => isSnapshotMissing(u)).length,
        help: "No snapshot stored yet",
      },
      {
        id: "stale-capture" as SavedUrlQueueId,
        label: "Stale capture",
        count: base.filter(
          (u) => !isSnapshotMissing(u) && isSnapshotStale(u, nowMs),
        ).length,
        help: `Snapshot older than ${SNAPSHOT_STALE_DAYS} days`,
      },
      {
        id: "ai-failed" as SavedUrlQueueId,
        label: "AI failed",
        count: base.filter((u) => (u.taggingStatus ?? "NONE") === "FAILED")
          .length,
        help: "Background AI tagging failed",
      },
      {
        id: "metadata-missing" as SavedUrlQueueId,
        label: "Metadata missing",
        count: base.filter((u) => urlHasMissingMetadata(u)).length,
        help: "Missing published date, authors, or tags",
      },
      {
        id: "updated-since-review" as SavedUrlQueueId,
        label: "Updated since review",
        count: base.filter((u) =>
          isUpdatedSinceReview(u.updatedAt, reviewedAtById[u.id]),
        ).length,
        help: "New or changed since the last review pass",
      },
    ];
  }, [filteredByCollection, reviewedAtById]);

  const activeSavedSearch = useMemo(
    () => savedSearches.find((s) => s.id === activeSavedSearchId) ?? null,
    [savedSearches, activeSavedSearchId],
  );

  const currentSavedSearchSignature = useMemo(
    () =>
      JSON.stringify({
        filter,
        sortKey,
        sortOrder,
        year,
        selectedCollectionId: selectedCollectionId ?? null,
        queueId: activeQueueId,
      }),
    [filter, sortKey, sortOrder, year, selectedCollectionId, activeQueueId],
  );

  const activeSavedSearchDirty = useMemo(() => {
    if (!activeSavedSearch) return false;
    return (
      JSON.stringify({
        filter: activeSavedSearch.filter,
        sortKey: activeSavedSearch.sortKey,
        sortOrder: activeSavedSearch.sortOrder,
        year: activeSavedSearch.year,
        selectedCollectionId: activeSavedSearch.selectedCollectionId ?? null,
        queueId: activeSavedSearch.queueId,
      }) !== currentSavedSearchSignature
    );
  }, [activeSavedSearch, currentSavedSearchSignature]);

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

  const hasActiveReviewView = useMemo(() => {
    return (
      currentSavedSearchSignature !== DEFAULT_REVIEW_VIEW_SIGNATURE ||
      activeSavedSearchId !== null
    );
  }, [currentSavedSearchSignature, activeSavedSearchId]);

  const resetReviewView = useCallback(() => {
    setFilter({ ...DEFAULT_URL_FILTER });
    setSortKey(DEFAULT_SORT_KEY);
    setSortOrder(DEFAULT_SORT_ORDER);
    setYear(DEFAULT_YEAR);
    setSelectedCollectionId(undefined);
    setActiveQueueId(DEFAULT_QUEUE_ID);
    setActiveSavedSearchId(null);
    setSelection(new Set());
    setDetail(null);

    notify({
      text: "Reset filters, queue, collection, saved search context, and sorting.",
      kind: "success",
    });
  }, [notify]);

  const markVisibleReviewed = useCallback(() => {
    if (!sorted.length) return;
    setReviewedAtById((prev) =>
      markReviewedEntries(
        prev,
        sorted.map((u) => u.id),
      ),
    );
  }, [sorted]);

  const applySavedSearch = useCallback(
    (preset: SavedUrlSearchPreset) => {
      setFilter({ ...preset.filter });
      setSortKey(preset.sortKey);
      setSortOrder(preset.sortOrder);
      setYear(preset.year);
      setSelectedCollectionId(preset.selectedCollectionId);
      setActiveQueueId(preset.queueId);
      setActiveSavedSearchId(preset.id);
      clearSelection();
    },
    [clearSelection],
  );

  const upsertSavedSearch = useCallback(
    (name: string) => {
      const existing = savedSearches.find(
        (preset) => preset.name.toLowerCase() === name.toLowerCase(),
      );

      const nextPreset: SavedUrlSearchPreset = {
        id: existing?.id ?? `saved-url-search-${Date.now()}`,
        name,
        filter: { ...filter },
        sortKey,
        sortOrder,
        year,
        selectedCollectionId,
        queueId: activeQueueId,
      };

      setSavedSearches((prev) => {
        if (existing) {
          return prev.map((preset) =>
            preset.id === existing.id ? nextPreset : preset,
          );
        }
        return [nextPreset, ...prev].slice(0, 10);
      });

      setActiveSavedSearchId(nextPreset.id);
      return existing ? "updated" : "created";
    },
    [
      savedSearches,
      filter,
      sortKey,
      sortOrder,
      year,
      selectedCollectionId,
      activeQueueId,
    ],
  );

  const saveCurrentSearch = useCallback(() => {
    const suggestedName =
      activeSavedSearch && !activeSavedSearchDirty
        ? activeSavedSearch.name
        : "";

    setTextDialog({
      kind: "saved-search",
      value: suggestedName,
    });
  }, [activeSavedSearch, activeSavedSearchDirty]);

  const deleteActiveSavedSearch = useCallback(async () => {
    if (!activeSavedSearch) return;

    const ok = await confirm({
      title: "Delete saved search?",
      description: `Delete "${activeSavedSearch.name}"? This removes the preset only and does not affect your saved URLs.`,
      confirmText: "Delete preset",
      cancelText: "Keep preset",
      danger: true,
    });

    if (!ok) return;

    setSavedSearches((prev) =>
      prev.filter((preset) => preset.id !== activeSavedSearch.id),
    );
    setActiveSavedSearchId(null);

    notify({
      text: `Deleted saved search "${activeSavedSearch.name}".`,
      kind: "success",
    });
  }, [activeSavedSearch, confirm, notify]);

  const openCollectionDialog = useCallback(() => {
    setTextDialog({
      kind: "collection",
      mode: "create",
      value: "",
    });
  }, []);

  const openRenameCollectionDialog = useCallback((collection: Collection) => {
    setTextDialog({
      kind: "collection",
      mode: "rename",
      collectionId: collection.id,
      value: collection.name,
    });
  }, []);

  const deleteSelectedCollection = useCallback(
    async (collection: Collection) => {
      const usageCount = collectionCounts[collection.id] ?? 0;

      if (collection.id === "c_general") {
        notify({
          text: "The default General collection is protected.",
          kind: "info",
        });
        return;
      }

      const ok = await confirm({
        title: "Delete collection?",
        description:
          usageCount > 0
            ? `Delete "${collection.name}"? ${usageCount} saved URL${usageCount === 1 ? "" : "s"} will be removed from this collection, but the URLs themselves will remain saved.`
            : `Delete "${collection.name}"? The collection will be removed, but no saved URLs will be deleted.`,
        confirmText: "Delete collection",
        cancelText: "Keep collection",
        danger: true,
      });

      if (!ok) return;

      deleteCollection(collection.id);
      setCollections(getCollections());
      setUrls((prev) =>
        prev.map((u) => ({
          ...u,
          collections: (u.collections || []).filter(
            (id) => id !== collection.id,
          ),
        })),
      );

      if (selectedCollectionId === collection.id) {
        setSelectedCollectionId(undefined);
      }

      notify({
        text: `Deleted collection "${collection.name}".`,
        kind: "success",
      });
    },
    [collectionCounts, confirm, notify, selectedCollectionId],
  );

  const submitTextDialog = useCallback(async () => {
    if (!textDialog) return;

    const name = textDialogValue.trim();
    if (!name) return;

    const normalized = name.toLowerCase();

    if (textDialog.kind === "collection") {
      const duplicate = collections.find((c) => {
        if (textDialog.mode === "rename" && c.id === textDialog.collectionId) {
          return false;
        }
        return c.name.trim().toLowerCase() === normalized;
      });

      if (duplicate) {
        notify({
          text: `A collection named "${name}" already exists.`,
          kind: "warning",
        });
        return;
      }
    }

    setTextDialogBusy(true);

    try {
      if (textDialog.kind === "collection") {
        if (textDialog.mode === "create") {
          const created = createCollection(name);
          setCollections(getCollections());
          setSelectedCollectionId(created.id);

          notify({
            text: `Created collection "${created.name}".`,
            kind: "success",
          });
        } else {
          if (!textDialog.collectionId) {
            throw new Error("Missing collection id for rename.");
          }

          renameCollection(textDialog.collectionId, name);
          setCollections(getCollections());

          notify({
            text: `Renamed collection to "${name}".`,
            kind: "success",
          });
        }
      } else {
        const action = upsertSavedSearch(name);
        notify({
          text:
            action === "updated"
              ? `Updated saved search "${name}".`
              : `Saved search "${name}".`,
          kind: "success",
        });
      }

      setTextDialog(null);
    } catch (e: any) {
      notify({
        text: e?.message ?? "Unable to save right now.",
        kind: "error",
      });
    } finally {
      setTextDialogBusy(false);
    }
  }, [textDialog, textDialogValue, collections, notify, upsertSavedSearch]);

  const allVisibleSelected =
    sorted.length > 0 && sorted.every((u) => selection.has(u.id));

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
      notify({ text: "Failed to update favorite.", kind: "error" });
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
      notify({ text: "Failed to save notes.", kind: "error" });
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
      notify({ text: "Failed to update tags.", kind: "error" });
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
      notify({ text: "Some favorites failed to update.", kind: "warning" });
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

              // replace optimistic tags with server truth (backend merge + meta)
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
      notify({ text: "Failed to add a tag to some items.", kind: "warning" });
    }
  };

  const onDelete = async (ids: string[]) => {
    const idsNum = ids.map(Number);

    // capture URLs before optimistic UI update
    const deletedUrls = urls
      .filter((u) => ids.includes(u.id))
      .map((u) => u.url);

    const backup = urls;
    setUrls((prev) => prev.filter((u) => !ids.includes(u.id)));
    setSelection(new Set());

    try {
      await deleteUrlsBulk(idsNum);

      // Keep local collections in sync so Url Collector doesn't show stale “Saved”
      deletedUrls.forEach((u) => setUrlCollections(u, []));

      notify({
        text:
          ids.length === 1
            ? "Deleted 1 saved URL."
            : `Deleted ${ids.length} saved URLs.`,
        kind: "success",
      });
    } catch {
      setUrls(backup);
      notify({ text: "Failed to delete the selected URLs.", kind: "error" });
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
      notify({
        text: "Choose a collection on the left before pasting.",
        kind: "warning",
      });
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
      notify({ text: "Failed to save URL.", kind: "error" });
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

      <div className="fm-panel p-4 sm:p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div>
            <p className="page-header-kicker">Review operations</p>
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-100">
              Review queues & saved searches
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">
              Jump straight into stale captures, failed AI jobs, metadata gaps,
              or anything updated since the last review pass.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end ">
            <span className="page-header-pill">
              <span className="page-header-pill-label">State</span>
              <span className="page-header-pill-value">
                {activeSavedSearch
                  ? activeSavedSearchDirty
                    ? `Edited from ${activeSavedSearch.name}`
                    : activeSavedSearch.name
                  : "Ad hoc"}
              </span>
            </span>

            <button
              type="button"
              className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={markVisibleReviewed}
              disabled={sorted.length === 0}
              title="Mark every visible result as reviewed right now"
            >
              Mark visible reviewed
            </button>

            <button
              type="button"
              className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60 "
              onClick={resetReviewView}
              disabled={!hasActiveReviewView}
              title="Reset filters, selected collection, queue, saved-search context, year, and sort"
            >
              Reset review view
            </button>

            <button
              type="button"
              className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={saveCurrentSearch}
              title="Save the current filter, sort, collection, and queue state"
            >
              Save current search
            </button>

            {activeSavedSearch && (
              <button
                type="button"
                className="btn-ghost px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10 disabled:opacity-60"
                onClick={deleteActiveSavedSearch}
                title="Delete the active saved search"
              >
                Delete saved search
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-start xl:items-center">
          {reviewQueues.map((queue) => {
            const active = activeQueueId === queue.id;
            return (
              <button
                key={queue.id}
                type="button"
                onClick={() => setActiveQueueId(queue.id)}
                title={queue.help}
                className={[
                  "rounded-xl border px-3 py-2 text-left transition min-w-[180px]",
                  active
                    ? "border-brand-primary bg-brand-primary/10 text-brand-primary shadow-sm"
                    : "border-black/10 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-neutral-900/60",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{queue.label}</span>
                  <span className="chip chip-slate">{queue.count}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {queue.help}
                </div>
              </button>
            );
          })}
        </div>

        {savedSearches.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
              Saved searches
            </div>

            <div className="flex flex-wrap gap-2">
              {savedSearches.map((preset) => {
                const active =
                  activeSavedSearchId === preset.id && !activeSavedSearchDirty;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySavedSearch(preset)}
                    className={[
                      "rounded-full px-3 py-2 text-sm border transition",
                      active
                        ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                        : "border-black/10 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-neutral-900/60",
                    ].join(" ")}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
                collectionCounts={collectionCounts}
                totalUrlCount={urls.length}
                selectedCollectionId={selectedCollectionId}
                onSelect={(id) => setSelectedCollectionId(id)}
                onCreateClick={openCollectionDialog}
                onRenameClick={openRenameCollectionDialog}
                onDeleteClick={deleteSelectedCollection}
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

                  <div className="ml-auto inline-flex items-center rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/70 p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setViewMode("registry")}
                      className={[
                        "rounded-lg px-3 py-2 text-sm font-medium transition",
                        viewMode === "registry"
                          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                          : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white",
                      ].join(" ")}
                      title="Show dense source registry table"
                    >
                      Registry
                    </button>

                    <button
                      type="button"
                      onClick={() => setViewMode("cards")}
                      className={[
                        "rounded-lg px-3 py-2 text-sm font-medium transition",
                        viewMode === "cards"
                          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                          : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white",
                      ].join(" ")}
                      title="Show card layout"
                    >
                      Cards
                    </button>
                  </div>
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
            {captureNotice && !loading && (
              <div className="card border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 p-4">
                {captureNotice}
              </div>
            )}
            {!loading && !error && sorted.length === 0 && (
              <div className="card p-10 text-center text-gray-600 dark:text-gray-300">
                No saved URLs match your filters.
              </div>
            )}

            {/* Registry / Cards */}
            {viewMode === "registry" ? (
              <SourceRegistryTable
                rows={sorted}
                selection={selection}
                allVisibleSelected={allVisibleSelected}
                onToggleSelect={toggleSelect}
                onSelectAllVisible={selectAllFiltered}
                onClearSelection={clearSelection}
                onOpenDetail={(x) => setDetail(x)}
              />
            ) : (
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
            )}

            {/* Modals */}
            <TextEntryModal
              open={!!textDialog}
              onClose={() => {
                if (!textDialogBusy) setTextDialog(null);
              }}
              title={
                textDialog?.kind === "collection"
                  ? textDialog.mode === "rename"
                    ? "Rename collection"
                    : "Create collection"
                  : activeSavedSearch && !activeSavedSearchDirty
                    ? "Update saved search"
                    : "Save current search"
              }
              description={
                textDialog?.kind === "collection"
                  ? textDialog.mode === "rename"
                    ? "Update the collection name everywhere it appears in your Saved URLs workspace."
                    : "Create a collection to group related URLs for review, capture, and follow-up work."
                  : "Save the current filter, sort, collection, and queue state so you can reopen this review slice instantly."
              }
              value={textDialogValue}
              placeholder={
                textDialog?.kind === "collection"
                  ? textDialog.mode === "rename"
                    ? "Enter a clearer collection name"
                    : "e.g. Indoor air papers"
                  : "e.g. Stale captures to review"
              }
              submitLabel={
                textDialog?.kind === "collection"
                  ? textDialog.mode === "rename"
                    ? "Rename collection"
                    : "Create collection"
                  : activeSavedSearch && !activeSavedSearchDirty
                    ? "Update saved search"
                    : "Save search"
              }
              busy={textDialogBusy}
              onChange={setTextDialogValue}
              onSubmit={submitTextDialog}
            />

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
              onRequestCreate={openCollectionDialog}
            />

            <FolderPickerModal
              open={pickerOpen}
              suggestedName={
                pickerTarget
                  ? suggestCaptureName(
                      pickerTarget.url,
                      pickerTarget.title,
                      pickerMode,
                    )
                  : pickerMode === "pdf"
                    ? "page.pdf"
                    : "page.txt"
              }
              mode={pickerMode}
              onCancel={() => setPickerOpen(false)}
              onConfirm={async ({
                folderId,
                fileName,
                mode,
                accessMode = "public",
              }) => {
                if (!pickerTarget) return;

                const parsedUrlId = Number(pickerTarget.id);
                const urlId = Number.isFinite(parsedUrlId)
                  ? parsedUrlId
                  : undefined;

                try {
                  const captured =
                    mode === "pdf"
                      ? await crawlSavePdf(
                          pickerTarget.url,
                          folderId ?? undefined,
                          fileName,
                          true,
                          true,
                          urlId,
                          accessMode,
                        )
                      : await crawlSaveText(
                          pickerTarget.url,
                          folderId ?? undefined,
                          fileName,
                          urlId,
                          accessMode,
                        );

                  // refresh list so latestSnapshot appears immediately
                  const rows = await apiFetchSavedUrls();
                  setUrls(rows.map(toUISaved));

                  const method = captured?.captureMeta?.method
                    ? `via ${captured.captureMeta.method}`
                    : "";
                  const src = captured?.captureMeta?.capturedUrl
                    ? ` • ${captured.captureMeta.capturedUrl}`
                    : "";

                  const msg = `Captured ${method}${src}`
                    .replace(/\s+/g, " ")
                    .trim();
                  setCaptureNotice(msg || "Captured successfully.");

                  // auto-hide after a few seconds
                  window.setTimeout(() => setCaptureNotice(null), 8000);

                  // close only on success
                  setPickerOpen(false);
                } catch (e: any) {
                  const msg =
                    e?.response?.data?.message ??
                    e?.message ??
                    "Capture failed";

                  console.error("[SavedUrlsPage] capture failed", {
                    url: pickerTarget.url,
                    mode,
                    folderId,
                    fileName,
                    accessMode,
                    urlId,
                    error: e,
                  });

                  notify({
                    text: `Capture failed: ${msg}`,
                    kind: "error",
                  });
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
                onUrlHydrate={(fresh) => {
                  const next = toUISaved(fresh);
                  setUrls((prev) =>
                    prev.map((u) => (u.id === next.id ? { ...u, ...next } : u)),
                  );
                  setDetail((prev) =>
                    prev && prev.id === next.id ? { ...prev, ...next } : prev,
                  );
                }}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
};

function suggestCaptureName(
  url: string,
  title: string | undefined,
  mode: "pdf" | "text",
) {
  const looksLikeUrlTitle = (t?: string) =>
    !!t && /^https?:\/\//i.test(t.trim());

  const fromUrl = (u: string) => {
    try {
      const U = new URL(u);

      // prefer query params containing ".pdf" (like sci.gov.in ?filename=...pdf)
      for (const [, v] of U.searchParams.entries()) {
        const s = String(v || "");
        if (s.toLowerCase().includes(".pdf")) {
          const base = s.split("/").pop() || "document.pdf";
          return decodeURIComponent(base);
        }
      }

      const base = decodeURIComponent(U.pathname.split("/").pop() || "");
      return base || U.hostname || "page";
    } catch {
      return "page";
    }
  };

  const raw =
    title && !looksLikeUrlTitle(title) ? title.trim() : fromUrl(url).trim();

  const stem = raw.replace(/\.(pdf|txt)$/i, "").slice(0, 60) || "page";
  return mode === "pdf" ? `${stem}.pdf` : `${stem}.txt`;
}

export default SavedUrlsPage;
