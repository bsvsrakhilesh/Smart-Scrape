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
  fetchSavedUrlsPage as apiFetchSavedUrlsPage,
  fetchSavedUrlFacets as apiFetchSavedUrlFacets,
  fetchSavedUrlReviewQueueSummary as apiFetchSavedUrlReviewQueueSummary,
  saveUrls as apiSaveUrls,
  patchUrl,
  deleteUrlsBulk,
  type BackendUrlRow,
  type UrlTaggingSummary,
  type BackendSavedUrlSearchPreset,
  getUrlTaggingSummary,
  retryFailedUrlTagging,
  crawlSavePdf,
  crawlSaveText,
  getUrlTagJob,
  startUrlTagJob,
  getUrlById,
  fetchSavedUrlSearchPresets,
  createSavedUrlSearchPreset,
  updateSavedUrlSearchPreset,
  deleteSavedUrlSearchPreset,
} from "../lib/api";
import {
  deriveSeparatedTags,
  mergeUniqueTags,
  normalizeTagList,
} from "../lib/tagBuckets";
import {
  AI_TAG_JOB_POLL_MS,
  AI_TAG_JOB_TIMEOUT_SEC,
  deriveAiTagRuntimeFromJob,
} from "../lib/aiTagUi";
import FolderPickerModal from "../components/urlcollector/FolderPickerModal";
import {
  getCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setUrlCollections,
  reconcileUrlCollections,
  hydrateCollectionsFromBackend,
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
const LEGACY_SAVED_URLS_SEARCHES_KEY = "saved-urls:saved-searches";

type SavedUrlsViewMode = "registry" | "cards";
type SavedUrlsTextDialog =
  | {
      kind: "collection";
      mode: "create" | "rename";
      collectionId?: string;
      value: string;
    }
  | { kind: "saved-search"; value: string };

type BulkAiTagFailure = {
  id: string;
  title: string;
  message: string;
};

type BulkAiTagRunStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled";

type BulkAiTagRunState = {
  status: BulkAiTagRunStatus;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentTitle: string | null;
  currentUrl: string | null;
  failures: BulkAiTagFailure[];
  startedAt: number | null;
  finishedAt: number | null;
};

const EMPTY_BULK_AI_TAG_RUN: BulkAiTagRunState = {
  status: "idle",
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  currentTitle: null,
  currentUrl: null,
  failures: [],
  startedAt: null,
  finishedAt: null,
};

const SAVED_URLS_VIEW_KEY = "saved-urls:view-mode";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function isAbortLikeError(error: any) {
  return (
    error?.name === "CanceledError" ||
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED"
  );
}

const DEFAULT_URL_FILTER: UrlFilterState = {
  query: "",
  favoritesOnly: false,
  tags: [],
  domains: [],
  visibility: "all",
  dateFrom: "",
  dateTo: "",
  publishedFrom: "",
  publishedTo: "",
  snapshotStatus: "all",
  taggingStatus: "all",
  metadataState: "all",
};

const DEFAULT_SORT_KEY: SortKey = "createdAt";
const DEFAULT_SORT_ORDER: SortOrder = "desc";
const DEFAULT_YEAR = "all";
const DEFAULT_QUEUE_ID: SavedUrlQueueId = "all";
const PAGE_SIZE = 50;

const DEFAULT_REVIEW_VIEW_SIGNATURE = JSON.stringify({
  filter: DEFAULT_URL_FILTER,
  sortKey: DEFAULT_SORT_KEY,
  sortOrder: DEFAULT_SORT_ORDER,
  year: DEFAULT_YEAR,
  selectedCollectionId: null,
  queueId: DEFAULT_QUEUE_ID,
});

function buildSavedSearchSignature(input: {
  filter: UrlFilterState;
  sortKey: SortKey;
  sortOrder: SortOrder;
  year: string;
  selectedCollectionId?: string | null;
  queueId: SavedUrlQueueId;
}) {
  return JSON.stringify({
    filter: input.filter,
    sortKey: input.sortKey,
    sortOrder: input.sortOrder,
    year: input.year,
    selectedCollectionId: input.selectedCollectionId ?? null,
    queueId: input.queueId,
  });
}

function getSavedSearchPresetSignature(preset: SavedUrlSearchPreset) {
  return buildSavedSearchSignature({
    filter: preset.filter,
    sortKey: preset.sortKey,
    sortOrder: preset.sortOrder,
    year: preset.year,
    selectedCollectionId: preset.selectedCollectionId,
    queueId: preset.queueId,
  });
}

function toSavedUrlSearchPreset(
  row: BackendSavedUrlSearchPreset,
): SavedUrlSearchPreset {
  return {
    id: row.id,
    name: row.name,
    filter: row.filter as UrlFilterState,
    sortKey: row.sortKey,
    sortOrder: row.sortOrder,
    year: row.year,
    selectedCollectionId: row.selectedCollectionId ?? undefined,
    queueId: row.queueId,
  };
}

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

function parseLocalDateInput(value: string): {
  year: number;
  monthIndex: number;
  day: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    !Number.isInteger(day) ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { year, monthIndex, day };
}

function startOfLocalDayMs(value: string): number | null {
  const parts = parseLocalDateInput(value);
  if (!parts) return null;

  const ms = new Date(
    parts.year,
    parts.monthIndex,
    parts.day,
    0,
    0,
    0,
    0,
  ).getTime();

  return Number.isFinite(ms) ? ms : null;
}

function endOfLocalDayMs(value: string): number | null {
  const parts = parseLocalDateInput(value);
  if (!parts) return null;

  const ms = new Date(
    parts.year,
    parts.monthIndex,
    parts.day,
    23,
    59,
    59,
    999,
  ).getTime();

  return Number.isFinite(ms) ? ms : null;
}

function getDomain(u: string): string {
  try {
    let hostname = new URL(u).hostname.trim().toLowerCase();
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    return hostname;
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
  const collections = Array.isArray(row.collections)
    ? Array.from(new Set(row.collections.map(String).filter(Boolean)))
    : [];
  const tagsMetaRaw = (row as any).tagsMeta ?? null;
  const tagState = deriveSeparatedTags(row.tags || [], tagsMetaRaw);

  return {
    id: String(row.id),
    url: row.url,
    title: row.title || row.url,
    description: row.snippet || "",
    publishedAt: (row as any).publishedAt ?? null,
    authors: Array.isArray((row as any).authors) ? (row as any).authors : [],
    faviconUrl: faviconFor(row.url),
    domain: domain || "",
    tags: tagState.effectiveTags,
    userTags: tagState.userTags,
    aiTags: tagState.aiTags,
    effectiveTags: tagState.effectiveTags,
    taggingStatus: row.taggingStatus ?? "NONE",
    taggingJobId: row.taggingJobId ?? null,
    taggingError: (row as any).taggingError ?? null,
    notes: row.notes || "",
    isFavorited: !!row.isFavorited,
    collections,
    visibility: row.visibility === "public" ? "public" : "private",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastVisitedAt: row.lastVisitedAt ?? undefined,
    visitCount: typeof row.visitCount === "number" ? row.visitCount : 0,
    latestSnapshot: (row as any).latestSnapshot ?? null,
    tagsMetaRaw,
    taggerVersion: (row as any).taggerVersion ?? null,
    contentHash: (row as any).contentHash ?? null,
  };
}

function loadLegacySavedUrlSearchPresets(): SavedUrlSearchPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_SAVED_URLS_SEARCHES_KEY);
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

    for (const collection of collections) {
      counts[collection.id] =
        typeof collection.urlCount === "number" ? collection.urlCount : 0;
    }

    return counts;
  }, [collections]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId),
    [collections, selectedCollectionId],
  );

  const collectionNamesById = useMemo(
    () =>
      Object.fromEntries(
        collections.map((collection) => [collection.id, collection.name]),
      ) as Record<string, string>,
    [collections],
  );

  // Filters
  const [filter, setFilter] = useState<UrlFilterState>({
    ...DEFAULT_URL_FILTER,
  });

  // Sort + Year
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [year, setYear] = useState<string>(DEFAULT_YEAR); // 'all' or 'YYYY'
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [libraryTotalCount, setLibraryTotalCount] = useState(0);

  const [facetSummary, setFacetSummary] = useState<{
    domains: string[];
    tags: string[];
    years: string[];
  }>({
    domains: [],
    tags: [],
    years: [],
  });

  const [queueSummary, setQueueSummary] = useState<{
    all: number;
    neverCaptured: number;
    staleCapture: number;
    aiFailed: number;
    metadataMissing: number;
  }>({
    all: 0,
    neverCaptured: 0,
    staleCapture: 0,
    aiFailed: 0,
    metadataMissing: 0,
  });

  const [activeQueueId, setActiveQueueId] =
    useState<SavedUrlQueueId>(DEFAULT_QUEUE_ID);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalResults / PAGE_SIZE)),
    [totalResults],
  );

  const activeServerQueue = useMemo(
    () => (activeQueueId === "updated-since-review" ? "all" : activeQueueId),
    [activeQueueId],
  );

  const serverDateFrom = useMemo(() => {
    if (!filter.dateFrom) return undefined;
    const ms = startOfLocalDayMs(filter.dateFrom);
    return ms === null ? undefined : new Date(ms).toISOString();
  }, [filter.dateFrom]);

  const serverDateTo = useMemo(() => {
    if (!filter.dateTo) return undefined;
    const ms = endOfLocalDayMs(filter.dateTo);
    return ms === null ? undefined : new Date(ms).toISOString();
  }, [filter.dateTo]);

  const serverPublishedFrom = useMemo(() => {
    if (!filter.publishedFrom) return undefined;
    const ms = startOfLocalDayMs(filter.publishedFrom);
    return ms === null ? undefined : new Date(ms).toISOString();
  }, [filter.publishedFrom]);

  const serverPublishedTo = useMemo(() => {
    if (!filter.publishedTo) return undefined;
    const ms = endOfLocalDayMs(filter.publishedTo);
    return ms === null ? undefined : new Date(ms).toISOString();
  }, [filter.publishedTo]);

  const queueSummaryServerQuery = useMemo(() => {
    return {
      q: filter.query.trim() || undefined,
      year: year !== "all" ? year : undefined,
      tags: filter.tags.length ? filter.tags : undefined,
      domains: filter.domains.length ? filter.domains : undefined,
      collectionId: selectedCollectionId || undefined,
      favoritesOnly: filter.favoritesOnly || undefined,
      visibility: filter.visibility !== "all" ? filter.visibility : undefined,
      dateFrom: serverDateFrom,
      dateTo: serverDateTo,
      publishedFrom: serverPublishedFrom,
      publishedTo: serverPublishedTo,
      snapshotStatus:
        filter.snapshotStatus !== "all" ? filter.snapshotStatus : undefined,
      taggingStatus:
        filter.taggingStatus !== "all" ? filter.taggingStatus : undefined,
      metadataState:
        filter.metadataState !== "all" ? filter.metadataState : undefined,
    };
  }, [
    filter.dateFrom,
    filter.dateTo,
    filter.domains,
    filter.favoritesOnly,
    filter.metadataState,
    filter.publishedFrom,
    filter.publishedTo,
    filter.query,
    filter.snapshotStatus,
    filter.taggingStatus,
    filter.tags,
    filter.visibility,
    selectedCollectionId,
    serverDateFrom,
    serverDateTo,
    serverPublishedFrom,
    serverPublishedTo,
    year,
  ]);

  const baseServerQuery = useMemo(() => {
    const snapshotStatus =
      activeServerQueue === "never-captured"
        ? "missing"
        : activeServerQueue === "stale-capture"
          ? "stale"
          : filter.snapshotStatus !== "all"
            ? filter.snapshotStatus
            : undefined;

    const taggingStatus =
      activeServerQueue === "ai-failed"
        ? "FAILED"
        : filter.taggingStatus !== "all"
          ? filter.taggingStatus
          : undefined;

    const metadataState =
      activeServerQueue === "metadata-missing"
        ? "missing"
        : filter.metadataState !== "all"
          ? filter.metadataState
          : undefined;

    return {
      q: filter.query.trim() || undefined,
      year: year !== "all" ? year : undefined,
      tags: filter.tags.length ? filter.tags : undefined,
      domains: filter.domains.length ? filter.domains : undefined,
      collectionId: selectedCollectionId || undefined,
      favoritesOnly: filter.favoritesOnly || undefined,
      visibility: filter.visibility !== "all" ? filter.visibility : undefined,
      dateFrom: serverDateFrom,
      dateTo: serverDateTo,
      publishedFrom: serverPublishedFrom,
      publishedTo: serverPublishedTo,
      snapshotStatus,
      taggingStatus,
      metadataState,
      sortKey,
      sortOrder,
      pageSize: PAGE_SIZE,
    };
  }, [
    activeServerQueue,
    filter.dateFrom,
    filter.dateTo,
    filter.domains,
    filter.favoritesOnly,
    filter.metadataState,
    filter.publishedFrom,
    filter.publishedTo,
    filter.query,
    filter.snapshotStatus,
    filter.taggingStatus,
    filter.tags,
    filter.visibility,
    selectedCollectionId,
    serverDateFrom,
    serverDateTo,
    serverPublishedFrom,
    serverPublishedTo,
    sortKey,
    sortOrder,
    year,
  ]);

  const [reviewedAtById, setReviewedAtById] = useState<ReviewStampMap>(() =>
    loadReviewStampMap(SAVED_URLS_REVIEWED_KEY),
  );

  useEffect(() => {
    saveReviewStampMap(SAVED_URLS_REVIEWED_KEY, reviewedAtById);
  }, [reviewedAtById]);

  const [savedSearches, setSavedSearches] = useState<SavedUrlSearchPreset[]>(
    [],
  );
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(
    null,
  );

  const [textDialog, setTextDialog] = useState<SavedUrlsTextDialog | null>(
    null,
  );
  const [textDialogValue, setTextDialogValue] = useState("");
  const [textDialogBusy, setTextDialogBusy] = useState(false);

  const [bulkTagDialogIds, setBulkTagDialogIds] = useState<string[]>([]);
  const [bulkTagDialogValue, setBulkTagDialogValue] = useState("");
  const [bulkTagDialogBusy, setBulkTagDialogBusy] = useState(false);

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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [bulkAiTagRun, setBulkAiTagRun] = useState<BulkAiTagRunState>(
    EMPTY_BULK_AI_TAG_RUN,
  );
  const bulkAiTagCancelRef = useRef(false);

  const detail = useMemo(
    () => (detailId ? (urls.find((u) => u.id === detailId) ?? null) : null),
    [detailId, urls],
  );

  const bulkAiTagIsBusy =
    bulkAiTagRun.status === "running" || bulkAiTagRun.status === "cancelling";

  const bulkAiTagProgressPercent = useMemo(() => {
    if (bulkAiTagRun.total <= 0) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((bulkAiTagRun.completed / bulkAiTagRun.total) * 100),
      ),
    );
  }, [bulkAiTagRun.completed, bulkAiTagRun.total]);

  const bulkAiTagRemaining = Math.max(
    0,
    bulkAiTagRun.total - bulkAiTagRun.completed,
  );

  const dismissBulkAiTagRun = useCallback(() => {
    if (bulkAiTagIsBusy) return;
    setBulkAiTagRun(EMPTY_BULK_AI_TAG_RUN);
  }, [bulkAiTagIsBusy]);

  const cancelBulkAiTagRun = useCallback(() => {
    bulkAiTagCancelRef.current = true;
    setBulkAiTagRun((prev) =>
      prev.status === "running" ? { ...prev, status: "cancelling" } : prev,
    );
  }, []);

  useEffect(() => {
    if (detailId && !urls.some((u) => u.id === detailId)) {
      setDetailId(null);
    }
  }, [detailId, urls]);

  // Poll saved URLs briefly so newly-generated AI tags show up automatically
  const tagPollRef = useRef<number | null>(null);

  const rowsRequestSeqRef = useRef(0);
  const facetRequestSeqRef = useRef(0);
  const queueRequestSeqRef = useRef(0);

  const rowsAbortRef = useRef<AbortController | null>(null);
  const facetsAbortRef = useRef<AbortController | null>(null);
  const queueAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      rowsAbortRef.current?.abort();
      facetsAbortRef.current?.abort();
      queueAbortRef.current?.abort();
    };
  }, []);

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
  const [detailCaptureRefreshKey, setDetailCaptureRefreshKey] = useState(0);

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

  const refreshCollectionsFromServer = useCallback(async () => {
    await hydrateCollectionsFromBackend();
    setCollections(getCollections());
  }, []);

  const refreshLibraryTotalCount = useCallback(async () => {
    const out = await apiFetchSavedUrlsPage({
      page: 1,
      pageSize: 1,
    });
    setLibraryTotalCount(out.total);
    return out.total;
  }, []);

  const refreshFacetSummary = useCallback(
    async (signal?: AbortSignal) => {
      const requestSeq = ++facetRequestSeqRef.current;

      const out = await apiFetchSavedUrlFacets(baseServerQuery, { signal });

      if (requestSeq !== facetRequestSeqRef.current) return null;

      setFacetSummary(out);
      return out;
    },
    [baseServerQuery],
  );

  const refreshQueueSummary = useCallback(
    async (signal?: AbortSignal) => {
      const requestSeq = ++queueRequestSeqRef.current;

      const out = await apiFetchSavedUrlReviewQueueSummary(
        queueSummaryServerQuery,
        { signal },
      );

      if (requestSeq !== queueRequestSeqRef.current) return null;

      setQueueSummary(out);
      return out;
    },
    [queueSummaryServerQuery],
  );

  const refreshUrlsFromServer = useCallback(
    async (pageOverride?: number, signal?: AbortSignal) => {
      const requestSeq = ++rowsRequestSeqRef.current;
      const requestedPage = Math.max(1, pageOverride ?? page);

      const out = await apiFetchSavedUrlsPage(
        {
          ...baseServerQuery,
          page: requestedPage,
        },
        { signal },
      );

      if (requestSeq !== rowsRequestSeqRef.current) return null;

      if (!out.items.length && out.total > 0 && requestedPage > 1) {
        const fallbackPage = Math.max(1, Math.ceil(out.total / out.pageSize));
        const fallback = await apiFetchSavedUrlsPage(
          {
            ...baseServerQuery,
            page: fallbackPage,
          },
          { signal },
        );

        if (requestSeq !== rowsRequestSeqRef.current) return null;

        setPage(fallback.page);
        setTotalResults(fallback.total);

        const nextUi = fallback.items.map(toUISaved);
        setUrls(nextUi);
        return nextUi;
      }

      setTotalResults(out.total);

      const nextUi = out.items.map(toUISaved);
      setUrls(nextUi);
      return nextUi;
    },
    [baseServerQuery, page],
  );

  const refreshSavedUrlsScope = useCallback(
    async (pageOverride?: number) => {
      await Promise.all([
        refreshCollectionsFromServer(),
        refreshFacetSummary(),
        refreshQueueSummary(),
        refreshUrlsFromServer(pageOverride),
      ]);
    },
    [
      refreshCollectionsFromServer,
      refreshFacetSummary,
      refreshQueueSummary,
      refreshUrlsFromServer,
    ],
  );

  const refreshRowsAndQueueSummary = useCallback(
    async (pageOverride?: number) => {
      await Promise.all([
        refreshQueueSummary(),
        refreshUrlsFromServer(pageOverride),
      ]);
    },
    [refreshQueueSummary, refreshUrlsFromServer],
  );

  const refreshRowsAndFacetsAndQueue = useCallback(
    async (pageOverride?: number) => {
      await Promise.all([
        refreshFacetSummary(),
        refreshQueueSummary(),
        refreshUrlsFromServer(pageOverride),
      ]);
    },
    [refreshFacetSummary, refreshQueueSummary, refreshUrlsFromServer],
  );

  const refreshSavedUrlsWorkspace = useCallback(
    async (pageOverride?: number) => {
      await Promise.all([
        refreshLibraryTotalCount(),
        refreshSavedUrlsScope(pageOverride),
      ]);
    },
    [refreshLibraryTotalCount, refreshSavedUrlsScope],
  );

  const refreshTaggingSummary = useCallback(async () => {
    try {
      const s = await getUrlTaggingSummary();
      setTagSummary(s);
      setTagSummaryError(null);
    } catch (e: any) {
      setTagSummaryError(e?.message ?? "Failed to load tagging summary");
    }
  }, []);

  const refreshSavedSearchesFromBackend = useCallback(async () => {
    const rows = await fetchSavedUrlSearchPresets();
    setSavedSearches(rows.map(toSavedUrlSearchPreset));
    return rows;
  }, []);

  const hydrateSavedSearchesFromBackend = useCallback(async () => {
    const existing = await refreshSavedSearchesFromBackend();
    if (existing.length > 0) return;

    const legacy = loadLegacySavedUrlSearchPresets().slice(0, 10);
    if (!legacy.length) return;

    let imported = 0;

    for (const preset of legacy) {
      try {
        await createSavedUrlSearchPreset({
          name: preset.name,
          filter: preset.filter,
          sortKey: preset.sortKey,
          sortOrder: preset.sortOrder,
          year: preset.year,
          selectedCollectionId: preset.selectedCollectionId ?? null,
          queueId: preset.queueId,
        });
        imported += 1;
      } catch (e: any) {
        if (e?.response?.status === 409) continue;
        throw e;
      }
    }

    if (typeof window !== "undefined") {
      localStorage.removeItem(LEGACY_SAVED_URLS_SEARCHES_KEY);
    }

    await refreshSavedSearchesFromBackend();

    if (imported > 0) {
      notify({
        text: `Imported ${imported} saved search${imported === 1 ? "" : "es"} from this browser.`,
        kind: "success",
      });
    }
  }, [refreshSavedSearchesFromBackend, notify]);

  const handleRetryFailedTagging = useCallback(async () => {
    try {
      setTagSummaryLoading(true);
      const out = await retryFailedUrlTagging();

      await Promise.all([
        refreshTaggingSummary(),
        refreshRowsAndQueueSummary(),
      ]);

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
  }, [refreshRowsAndQueueSummary, refreshTaggingSummary, notify]);

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

        // Refresh rows and queue summary so snapshot-related pills stay correct.
        await refreshRowsAndQueueSummary();
      } finally {
        setBulkRunning(false);
      }
    },
    [refreshRowsAndQueueSummary],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([
          refreshCollectionsFromServer(),
          refreshLibraryTotalCount(),
          refreshTaggingSummary(),
        ]);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load saved URLs");
      } finally {
        setLoading(false);
      }
    })();
  }, [
    refreshCollectionsFromServer,
    refreshLibraryTotalCount,
    refreshTaggingSummary,
  ]);

  useEffect(() => {
    rowsAbortRef.current?.abort();

    const controller = new AbortController();
    rowsAbortRef.current = controller;

    (async () => {
      setLoading(true);
      try {
        await refreshUrlsFromServer(undefined, controller.signal);
        if (!controller.signal.aborted) {
          setError(null);
        }
      } catch (e: any) {
        if (isAbortLikeError(e)) return;
        if (!controller.signal.aborted) {
          setError(e?.message ?? "Failed to load saved URLs");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [page, refreshUrlsFromServer]);

  useEffect(() => {
    facetsAbortRef.current?.abort();

    const controller = new AbortController();
    facetsAbortRef.current = controller;

    refreshFacetSummary(controller.signal).catch((e: any) => {
      if (isAbortLikeError(e)) return;
      console.error("Failed to load saved URL facets", e);
    });

    return () => {
      controller.abort();
    };
  }, [refreshFacetSummary]);

  useEffect(() => {
    queueAbortRef.current?.abort();

    const controller = new AbortController();
    queueAbortRef.current = controller;

    refreshQueueSummary(controller.signal).catch((e: any) => {
      if (isAbortLikeError(e)) return;
      console.error("Failed to load saved URL queue summary", e);
    });

    return () => {
      controller.abort();
    };
  }, [refreshQueueSummary]);

  useEffect(() => {
    hydrateSavedSearchesFromBackend().catch((e: any) => {
      notify({
        text: e?.message ?? "Failed to load saved searches.",
        kind: "error",
      });
    });
  }, [hydrateSavedSearchesFromBackend, notify]);

  useEffect(() => {
    setPage(1);
    setSelection(new Set());
  }, [baseServerQuery]);

  useEffect(() => {
    const liveRows = urls.filter((u) => {
      const jobId = String((u as any)?.taggingJobId ?? "").trim();
      const status = String((u as any)?.taggingStatus ?? "NONE").toUpperCase();

      return (
        Boolean(jobId) &&
        !jobId.startsWith("claim:") &&
        (status === "PENDING" || status === "RUNNING")
      );
    });

    if (!liveRows.length) {
      if (tagPollRef.current) {
        window.clearInterval(tagPollRef.current);
        tagPollRef.current = null;
      }
      return;
    }

    if (tagPollRef.current) return;

    const stop = () => {
      if (tagPollRef.current) {
        window.clearInterval(tagPollRef.current);
        tagPollRef.current = null;
      }
    };

    tagPollRef.current = window.setInterval(async () => {
      try {
        await Promise.allSettled(
          liveRows.slice(0, 8).map(async (u) => {
            const idNum = Number(u.id);
            const jobId = String((u as any)?.taggingJobId ?? "").trim();
            if (!jobId || !Number.isFinite(idNum)) return;

            const data = await getUrlTagJob(jobId, idNum);

            if (data?.state === "SUCCESS") {
              const ai = normalizeTagList((data as any).tags ?? []);

              setUrls((prev) =>
                prev.map((x) => {
                  if (x.id !== u.id) return x;
                  const effectiveTags = mergeUniqueTags(x.userTags ?? [], ai);
                  return {
                    ...x,
                    taggingStatus: "SUCCESS",
                    taggingJobId: null,
                    taggingError: null,
                    aiTags: ai,
                    effectiveTags,
                    tags: effectiveTags,
                    aiTagJobProgress: 100,
                    aiTagJobStage: null,
                    aiTagJobMessage: null,
                    aiTagJobAttempt: null,
                    aiTagJobCached:
                      typeof (data as any).cached === "boolean"
                        ? Boolean((data as any).cached)
                        : null,
                  };
                }),
              );

              try {
                const fresh = await getUrlById(idNum);
                const next = toUISaved(fresh);
                setUrls((prev) =>
                  prev.map((row) =>
                    row.id === next.id ? { ...row, ...next } : row,
                  ),
                );
              } catch {
                // optimistic success is already visible
              }

              return;
            }

            if (data?.state === "FAILURE") {
              setUrls((prev) =>
                prev.map((x) =>
                  x.id === u.id
                    ? {
                        ...x,
                        taggingStatus: "FAILED",
                        taggingJobId: null,
                        taggingError:
                          (data as any)?.error ||
                          (data as any)?.message ||
                          "AI tagging failed",
                        aiTagJobProgress:
                          typeof (data as any)?.progress === "number"
                            ? Number((data as any).progress)
                            : null,
                        aiTagJobStage: (data as any)?.stage ?? null,
                        aiTagJobMessage: (data as any)?.message ?? null,
                        aiTagJobAttempt:
                          typeof (data as any)?.attempt === "number"
                            ? Number((data as any).attempt)
                            : null,
                        aiTagJobCached: null,
                      }
                    : x,
                ),
              );
              return;
            }

            const runtime = deriveAiTagRuntimeFromJob(
              data,
              (u as any)?.aiTagJobProgress ?? null,
            );

            setUrls((prev) =>
              prev.map((x) =>
                x.id === u.id
                  ? {
                      ...x,
                      taggingStatus:
                        runtime.taggingStatus ??
                        (data?.state === "PENDING" ? "PENDING" : "RUNNING"),
                      aiTagJobProgress: runtime.aiTagJobProgress ?? null,
                      aiTagJobStage: runtime.aiTagJobStage ?? null,
                      aiTagJobMessage: runtime.aiTagJobMessage ?? null,
                      aiTagJobAttempt: runtime.aiTagJobAttempt ?? null,
                      aiTagJobCached: runtime.aiTagJobCached ?? null,
                      taggingError: null,
                    }
                  : x,
              ),
            );
          }),
        );
      } catch {
        // keep existing interval alive; this is best-effort UI runtime polling
      }
    }, AI_TAG_JOB_POLL_MS);

    return stop;
  }, [urls]);

  useEffect(() => {
    const hasQueuedOrRunningRows = urls.some((u) => {
      const status = String((u as any)?.taggingStatus ?? "NONE").toUpperCase();
      return status === "PENDING" || status === "RUNNING";
    });

    if (!hasQueuedOrRunningRows) return;

    const timer = window.setInterval(() => {
      void refreshRowsAndQueueSummary();
      void refreshTaggingSummary();
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [urls, refreshRowsAndQueueSummary, refreshTaggingSummary]);

  // Global facet options from the backend query scope.
  // Keep currently-selected values merged in so users can always see/remove them
  // even during transient refreshes.
  const availableDomains = useMemo(() => {
    const fallbackDomains = Array.from(
      new Set(urls.map((u) => u.domain).filter(Boolean)),
    );

    const merged = new Set<string>(
      (facetSummary.domains.length
        ? facetSummary.domains
        : fallbackDomains
      ).filter(Boolean),
    );

    for (const domain of filter.domains) {
      if (domain) merged.add(domain);
    }

    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [facetSummary.domains, filter.domains, urls]);

  const availableTags = useMemo(() => {
    const fallbackTags = Array.from(new Set(urls.flatMap((u) => u.tags || [])));

    const merged = new Set<string>(
      (facetSummary.tags.length ? facetSummary.tags : fallbackTags).filter(
        Boolean,
      ),
    );

    for (const tag of filter.tags) {
      if (tag) merged.add(tag);
    }

    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [facetSummary.tags, filter.tags, urls]);

  const availableYears = useMemo(() => {
    const fallbackYears = Array.from(
      new Set(
        urls
          .map((u) => String(new Date(u.createdAt).getFullYear()))
          .filter((y) => /^\d{4}$/.test(y)),
      ),
    );

    const merged = new Set<string>(
      (facetSummary.years.length ? facetSummary.years : fallbackYears).filter(
        (y) => y !== "all",
      ),
    );

    if (year !== "all") merged.add(year);

    return ["all", ...Array.from(merged).sort((a, b) => Number(b) - Number(a))];
  }, [facetSummary.years, urls, year]);

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

  // The server owns the primary query pipeline:
  // search, tags, domains, favorites, date range, collection, snapshot state,
  // tagging state, metadata state, year, sort, and pagination.
  // Keep "updated since review" separate because it is browser-local and only
  // evaluates the rows loaded on the current page.

  const updatedSinceReviewCount = useMemo(
    () =>
      urls.filter((u) =>
        isUpdatedSinceReview(u.updatedAt, reviewedAtById[u.id]),
      ).length,
    [urls, reviewedAtById],
  );

  const isLocalReviewQueueActive = activeQueueId === "updated-since-review";

  const queueFiltered = useMemo(() => {
    if (!isLocalReviewQueueActive) return urls;
    return urls.filter((u) =>
      isUpdatedSinceReview(u.updatedAt, reviewedAtById[u.id]),
    );
  }, [urls, isLocalReviewQueueActive, reviewedAtById]);

  const sorted = useMemo(() => queueFiltered, [queueFiltered]);

  const reviewQueues = useMemo(
    () => [
      {
        id: "all" as SavedUrlQueueId,
        label: "All",
        count: queueSummary.all,
        help: "Everything in the current filtered scope",
      },
      {
        id: "never-captured" as SavedUrlQueueId,
        label: "Never captured",
        count: queueSummary.neverCaptured,
        help: "No snapshot stored yet",
      },
      {
        id: "stale-capture" as SavedUrlQueueId,
        label: "Stale capture",
        count: queueSummary.staleCapture,
        help: `Snapshot older than ${SNAPSHOT_STALE_DAYS} days`,
      },
      {
        id: "ai-failed" as SavedUrlQueueId,
        label: "AI failed",
        count: queueSummary.aiFailed,
        help: "Background AI tagging failed",
      },
      {
        id: "metadata-missing" as SavedUrlQueueId,
        label: "Metadata missing",
        count: queueSummary.metadataMissing,
        help: "Missing published date, authors, or tags",
      },
    ],
    [queueSummary],
  );

  const localReviewQueue = useMemo(
    () => ({
      id: "updated-since-review" as SavedUrlQueueId,
      label: "Updated since review",
      count: updatedSinceReviewCount,
      help: "Browser-local review state for the rows loaded on this page only",
    }),
    [updatedSinceReviewCount],
  );

  const activeSavedSearch = useMemo(
    () => savedSearches.find((s) => s.id === activeSavedSearchId) ?? null,
    [savedSearches, activeSavedSearchId],
  );

  const currentSavedSearchSignature = useMemo(
    () =>
      buildSavedSearchSignature({
        filter,
        sortKey,
        sortOrder,
        year,
        selectedCollectionId,
        queueId: activeQueueId,
      }),
    [filter, sortKey, sortOrder, year, selectedCollectionId, activeQueueId],
  );

  const currentSavedSearchMatch = useMemo(
    () =>
      savedSearches.find(
        (preset) =>
          getSavedSearchPresetSignature(preset) === currentSavedSearchSignature,
      ) ?? null,
    [savedSearches, currentSavedSearchSignature],
  );

  const activeSavedSearchDirty = useMemo(() => {
    if (!activeSavedSearch) return false;
    if (currentSavedSearchMatch) return false;

    return (
      getSavedSearchPresetSignature(activeSavedSearch) !==
      currentSavedSearchSignature
    );
  }, [activeSavedSearch, currentSavedSearchMatch, currentSavedSearchSignature]);

  const displayedSavedSearch = currentSavedSearchMatch ?? activeSavedSearch;

  const savedSearchStateLabel = useMemo(() => {
    if (currentSavedSearchMatch) return currentSavedSearchMatch.name;
    if (activeSavedSearch && activeSavedSearchDirty) {
      return `Edited from ${activeSavedSearch.name}`;
    }
    return "Ad hoc";
  }, [currentSavedSearchMatch, activeSavedSearch, activeSavedSearchDirty]);

  useEffect(() => {
    if (currentSavedSearchMatch) {
      setActiveSavedSearchId((prev) =>
        prev === currentSavedSearchMatch.id ? prev : currentSavedSearchMatch.id,
      );
      return;
    }

    if (!activeSavedSearch && activeSavedSearchId !== null) {
      setActiveSavedSearchId(null);
    }
  }, [currentSavedSearchMatch, activeSavedSearch, activeSavedSearchId]);

  // Selection helpers (page-scoped)
  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const visibleIds = new Set(sorted.map((u) => u.id));

    setSelection((prev) => {
      let changed = false;
      const next = new Set<string>();

      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      });

      return changed ? next : prev;
    });
  }, [sorted]);

  const selectedItems = useMemo(
    () => sorted.filter((u) => selection.has(u.id)),
    [sorted, selection],
  );

  const selectAllPage = useCallback(
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
    setDetailId(null);

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
    async (name: string) => {
      const existing = savedSearches.find(
        (preset) => preset.name.toLowerCase() === name.toLowerCase(),
      );

      const body = {
        name,
        filter: { ...filter },
        sortKey,
        sortOrder,
        year,
        selectedCollectionId: selectedCollectionId ?? null,
        queueId: activeQueueId,
      };

      const saved = existing
        ? await updateSavedUrlSearchPreset(existing.id, body)
        : await createSavedUrlSearchPreset(body);

      await refreshSavedSearchesFromBackend();
      setActiveSavedSearchId(saved.id);

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
      refreshSavedSearchesFromBackend,
    ],
  );

  const saveCurrentSearch = useCallback(() => {
    const suggestedName =
      displayedSavedSearch && !activeSavedSearchDirty
        ? displayedSavedSearch.name
        : "";

    setTextDialog({
      kind: "saved-search",
      value: suggestedName,
    });
  }, [displayedSavedSearch, activeSavedSearchDirty]);

  const deleteActiveSavedSearch = useCallback(async () => {
    if (!displayedSavedSearch) return;

    const ok = await confirm({
      title: "Delete saved search?",
      description: `Delete "${displayedSavedSearch.name}"? This removes the preset only and does not affect your saved URLs.`,
      confirmText: "Delete preset",
      cancelText: "Keep preset",
      danger: true,
    });

    if (!ok) return;

    await deleteSavedUrlSearchPreset(displayedSavedSearch.id);
    await refreshSavedSearchesFromBackend();

    setActiveSavedSearchId((prev) =>
      prev === displayedSavedSearch.id ? null : prev,
    );

    notify({
      text: `Deleted saved search "${displayedSavedSearch.name}".`,
      kind: "success",
    });
  }, [displayedSavedSearch, confirm, notify, refreshSavedSearchesFromBackend]);

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

      await deleteCollection(collection.id);

      if (selectedCollectionId === collection.id) {
        setSelectedCollectionId(undefined);
      }

      await refreshSavedUrlsScope();

      notify({
        text: `Deleted collection "${collection.name}".`,
        kind: "success",
      });
    },
    [
      collectionCounts,
      confirm,
      notify,
      refreshSavedUrlsScope,
      selectedCollectionId,
    ],
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
          const created = await createCollection(name);
          await refreshCollectionsFromServer();
          setSelectedCollectionId(created.id);

          notify({
            text: `Created collection "${created.name}".`,
            kind: "success",
          });
        } else {
          if (!textDialog.collectionId) {
            throw new Error("Missing collection id for rename.");
          }

          await renameCollection(textDialog.collectionId, name);
          await refreshCollectionsFromServer();

          notify({
            text: `Renamed collection to "${name}".`,
            kind: "success",
          });
        }
      } else {
        const action = await upsertSavedSearch(name);
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
  }, [
    textDialog,
    textDialogValue,
    collections,
    notify,
    refreshCollectionsFromServer,
    upsertSavedSearch,
  ]);

  const allPageRowsSelected =
    sorted.length > 0 && sorted.every((u) => selection.has(u.id));

  const shouldRefetchAfterFavoriteMutation = useMemo(
    () =>
      filter.favoritesOnly ||
      sortKey === "updatedAt" ||
      activeQueueId === "updated-since-review",
    [activeQueueId, filter.favoritesOnly, sortKey],
  );

  const shouldRefetchAfterNotesMutation = useMemo(
    () =>
      Boolean(filter.query.trim()) ||
      sortKey === "updatedAt" ||
      activeQueueId === "updated-since-review",
    [activeQueueId, filter.query, sortKey],
  );

  const formatBulkFailurePreview = useCallback(
    (
      rows: Array<{ id: string; title?: string; url: string }>,
      failedIds: string[],
    ) => {
      if (!failedIds.length) return "";

      const preview = rows
        .filter((row) => failedIds.includes(row.id))
        .slice(0, 2)
        .map((row) => row.title || row.url)
        .join(", ");

      if (!preview) return "";

      return `${preview}${failedIds.length > 2 ? "…" : ""}`;
    },
    [],
  );

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

      if (shouldRefetchAfterFavoriteMutation) {
        await refreshUrlsFromServer();
      }
    } catch {
      setUrls((prev) =>
        prev.map((x) =>
          x.id === u.id ? { ...x, isFavorited: u.isFavorited } : x,
        ),
      );
      notify({ text: "Failed to update favorite.", kind: "error" });
    }
  };

  const openCapturePicker = useCallback(
    (url: UISavedUrl, mode: "text" | "pdf") => {
      setPickerTarget(url);
      setPickerMode(mode);
      setPickerOpen(true);
    },
    [],
  );

  const handleNotesChange = async (id: string, notes: string) => {
    const idNum = Number(id);
    const before = urls.find((u) => u.id === id)?.notes ?? "";
    setUrls((prev) => prev.map((x) => (x.id === id ? { ...x, notes } : x)));
    try {
      await patchUrl(idNum, { notes });

      if (shouldRefetchAfterNotesMutation) {
        await refreshUrlsFromServer();
      }
    } catch (e) {
      setUrls((prev) =>
        prev.map((x) => (x.id === id ? { ...x, notes: before } : x)),
      );
      notify({ text: "Failed to save notes.", kind: "error" });
      throw e;
    }
  };

  const updateTags = async (id: string, tags: string[]) => {
    const idNum = Number(id);
    const before = urls.find((u) => u.id === id);
    if (!before) return;

    const nextUserTags = normalizeTagList(tags);
    const nextEffectiveTags = mergeUniqueTags(
      nextUserTags,
      before.aiTags ?? [],
    );

    setUrls((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              userTags: nextUserTags,
              effectiveTags: nextEffectiveTags,
              tags: nextEffectiveTags,
            }
          : x,
      ),
    );

    try {
      await patchUrl(idNum, { tags: nextUserTags });
      await refreshRowsAndFacetsAndQueue();
    } catch {
      setUrls((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                userTags: before.userTags ?? [],
                aiTags: before.aiTags ?? [],
                effectiveTags: before.effectiveTags ?? before.tags ?? [],
                tags: before.tags ?? [],
              }
            : x,
        ),
      );
      notify({ text: "Failed to update tags.", kind: "error" });
    }
  };

  // Bulk actions
  const onFavorite = async (ids: string[]) => {
    if (!ids.length) return;

    const targetRows = urls.filter((u) => ids.includes(u.id));
    const beforeById = new Map(
      targetRows.map((row) => [row.id, row.isFavorited] as const),
    );

    setUrls((prev) =>
      prev.map((u) => (ids.includes(u.id) ? { ...u, isFavorited: true } : u)),
    );

    const results = await Promise.allSettled(
      ids.map((id) => patchUrl(Number(id), { isFavorited: true })),
    );

    const failedIds = ids.filter(
      (_, index) => results[index].status === "rejected",
    );
    const successCount = ids.length - failedIds.length;

    if (failedIds.length === 0) {
      if (shouldRefetchAfterFavoriteMutation) {
        await refreshUrlsFromServer();
      }

      notify({
        text:
          successCount === 1
            ? "Marked 1 selected row on this page as favorite."
            : `Marked ${successCount} selected rows on this page as favorite.`,
        kind: "success",
      });
      return;
    }

    setUrls((prev) =>
      prev.map((u) =>
        failedIds.includes(u.id)
          ? {
              ...u,
              isFavorited: beforeById.get(u.id) ?? u.isFavorited,
            }
          : u,
      ),
    );

    setSelection(new Set(failedIds));

    const failedPreview = formatBulkFailurePreview(targetRows, failedIds);

    if (successCount > 0) {
      if (shouldRefetchAfterFavoriteMutation) {
        await refreshUrlsFromServer();
      }

      notify({
        text:
          `Marked ${successCount} selected row${successCount === 1 ? "" : "s"} on this page as favorite, but ${failedIds.length} failed.` +
          (failedPreview ? ` Failed: ${failedPreview}` : ""),
        kind: "warning",
      });
      return;
    }

    notify({
      text:
        `Could not mark ${failedIds.length} selected row${failedIds.length === 1 ? "" : "s"} on this page as favorite.` +
        (failedPreview ? ` Failed: ${failedPreview}` : ""),
      kind: "error",
    });
  };

  // Bulk AI auto-tag selected URLs
  const onAutoTagSelected = useCallback(
    async (ids: string[]) => {
      if (!ids?.length) return;

      if (bulkAiTagIsBusy) {
        notify({
          text: "AI auto-tag is already running for a page selection.",
          kind: "warning",
        });
        return;
      }

      const targets = urls.filter((u) => ids.includes(u.id));
      if (!targets.length) return;

      bulkAiTagCancelRef.current = false;

      setBulkAiTagRun({
        status: "running",
        total: targets.length,
        completed: 0,
        succeeded: 0,
        failed: 0,
        currentTitle: null,
        currentUrl: null,
        failures: [],
        startedAt: Date.now(),
        finishedAt: null,
      });

      let completed = 0;
      let succeeded = 0;
      let failed = 0;

      for (const u of targets) {
        if (bulkAiTagCancelRef.current) break;

        setBulkAiTagRun((prev) => ({
          ...prev,
          status: bulkAiTagCancelRef.current ? "cancelling" : prev.status,
          currentTitle: u.title || u.url,
          currentUrl: u.url,
        }));

        try {
          const idNum = Number(u.id);
          const { jobId } = await startUrlTagJob(idNum);

          let attempt = 0;
          let success = false;

          const maxAttempts = Math.max(
            10,
            Math.ceil((AI_TAG_JOB_TIMEOUT_SEC * 1000) / AI_TAG_JOB_POLL_MS),
          );

          while (attempt < maxAttempts) {
            if (bulkAiTagCancelRef.current) break;

            const data = await getUrlTagJob(jobId, idNum);

            if (data?.state === "SUCCESS") {
              const ai = normalizeTagList(data.tags ?? []);

              setUrls((prev) =>
                prev.map((x) => {
                  if (x.id !== u.id) return x;
                  const effectiveTags = mergeUniqueTags(x.userTags ?? [], ai);
                  return {
                    ...x,
                    aiTags: ai,
                    effectiveTags,
                    tags: effectiveTags,
                  };
                }),
              );

              success = true;
              break;
            }

            if (data?.state === "FAILURE") {
              throw new Error(data?.error || "AI tagging failed");
            }

            await new Promise((r) => setTimeout(r, AI_TAG_JOB_POLL_MS));
            attempt++;
          }

          if (bulkAiTagCancelRef.current) break;

          if (!success) {
            throw new Error("Timed out waiting for AI auto-tagging.");
          }

          completed += 1;
          succeeded += 1;

          setBulkAiTagRun((prev) => ({
            ...prev,
            completed,
            succeeded,
            failed,
          }));
        } catch (err: any) {
          if (bulkAiTagCancelRef.current) break;

          const failure: BulkAiTagFailure = {
            id: u.id,
            title: u.title || u.url,
            message: err?.message || "AI tagging failed",
          };

          completed += 1;
          failed += 1;

          setBulkAiTagRun((prev) => ({
            ...prev,
            completed,
            succeeded,
            failed,
            failures: [...prev.failures, failure],
          }));
        }
      }

      const cancelled = bulkAiTagCancelRef.current;

      setBulkAiTagRun((prev) => ({
        ...prev,
        status: cancelled ? "cancelled" : "completed",
        completed,
        succeeded,
        failed,
        currentTitle: null,
        currentUrl: null,
        finishedAt: Date.now(),
      }));

      await Promise.all([
        refreshTaggingSummary(),
        refreshRowsAndFacetsAndQueue(),
      ]);

      if (cancelled) {
        notify({
          text:
            completed === 0
              ? "Cancelled AI auto-tag before any rows finished."
              : `Cancelled AI auto-tag after processing ${completed} of ${targets.length} selected rows on this page.`,
          kind: "warning",
        });
        return;
      }

      if (failed === 0) {
        notify({
          text:
            succeeded === 1
              ? "AI auto-tag completed for 1 selected row on this page."
              : `AI auto-tag completed for ${succeeded} selected rows on this page.`,
          kind: "success",
        });
        return;
      }

      if (succeeded === 0) {
        notify({
          text:
            failed === 1
              ? "AI auto-tag failed for 1 selected row on this page."
              : `AI auto-tag failed for ${failed} selected rows on this page.`,
          kind: "error",
        });
        return;
      }

      notify({
        text: `AI auto-tag finished with partial success: ${succeeded} succeeded, ${failed} failed.`,
        kind: "warning",
      });
    },
    [
      bulkAiTagIsBusy,
      notify,
      refreshRowsAndFacetsAndQueue,
      refreshTaggingSummary,
      urls,
    ],
  );

  const onAddTag = async (ids: string[], tag: string) => {
    if (!tag || !ids.length) return;

    const targetRows = urls.filter((u) => ids.includes(u.id));
    const beforeTagsById = new Map(
      targetRows.map((row) => [row.id, row.tags ?? []] as const),
    );

    const beforeUserTagsById = new Map(
      targetRows.map((row) => [row.id, row.userTags ?? []] as const),
    );

    setUrls((prev) =>
      prev.map((u) => {
        if (!ids.includes(u.id)) return u;
        const nextUserTags = mergeUniqueTags(u.userTags ?? [], [tag]);
        const nextEffectiveTags = mergeUniqueTags(nextUserTags, u.aiTags ?? []);
        return {
          ...u,
          userTags: nextUserTags,
          effectiveTags: nextEffectiveTags,
          tags: nextEffectiveTags,
        };
      }),
    );

    const results = await Promise.allSettled(
      ids.map((id) => {
        const current = beforeUserTagsById.get(id) ?? [];
        const next = mergeUniqueTags(current, [tag]);
        return patchUrl(Number(id), { tags: next });
      }),
    );

    const failedIds = ids.filter(
      (_, index) => results[index].status === "rejected",
    );
    const successCount = ids.length - failedIds.length;

    if (failedIds.length === 0) {
      await refreshRowsAndFacetsAndQueue();

      notify({
        text:
          successCount === 1
            ? `Added tag "${tag}" to 1 selected row on this page.`
            : `Added tag "${tag}" to ${successCount} selected rows on this page.`,
        kind: "success",
      });
      return;
    }

    setUrls((prev) =>
      prev.map((u) =>
        failedIds.includes(u.id)
          ? {
              ...u,
              tags: [...(beforeTagsById.get(u.id) ?? u.tags ?? [])],
            }
          : u,
      ),
    );

    setSelection(new Set(failedIds));

    if (successCount > 0) {
      await refreshRowsAndFacetsAndQueue();
    }

    const failedPreview = formatBulkFailurePreview(targetRows, failedIds);

    notify({
      text:
        successCount > 0
          ? `Added tag "${tag}" to ${successCount} selected row${successCount === 1 ? "" : "s"} on this page, but ${failedIds.length} failed.${failedPreview ? ` Failed: ${failedPreview}` : ""}`
          : `Could not add tag "${tag}" to ${failedIds.length} selected row${failedIds.length === 1 ? "" : "s"} on this page.${failedPreview ? ` Failed: ${failedPreview}` : ""}`,
      kind: successCount > 0 ? "warning" : "error",
    });
  };

  const openBulkAddTagDialog = useCallback((ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return;

    setBulkTagDialogIds(uniqueIds);
    setBulkTagDialogValue("");
  }, []);

  const closeBulkAddTagDialog = useCallback(() => {
    if (bulkTagDialogBusy) return;

    setBulkTagDialogIds([]);
    setBulkTagDialogValue("");
  }, [bulkTagDialogBusy]);

  const submitBulkAddTagDialog = useCallback(async () => {
    const tag = bulkTagDialogValue.trim();
    if (!tag || bulkTagDialogIds.length === 0) return;

    setBulkTagDialogBusy(true);

    try {
      await onAddTag(bulkTagDialogIds, tag);

      setBulkTagDialogIds([]);
      setBulkTagDialogValue("");
    } catch (e: any) {
      notify({
        text: e?.message ?? "Unable to add tag right now.",
        kind: "error",
      });
    } finally {
      setBulkTagDialogBusy(false);
    }
  }, [bulkTagDialogIds, bulkTagDialogValue, notify, onAddTag]);

  const onDelete = async (ids: string[]) => {
    const idsNum = ids.map(Number);
    const targetRows = urls.filter((u) => ids.includes(u.id));
    const affectedCollectionCount = targetRows.filter(
      (u) => (u.collections?.length ?? 0) > 0,
    ).length;
    const preview = targetRows
      .slice(0, 2)
      .map((u) => u.title || u.url)
      .join(", ");

    const confirmed = await confirm({
      title:
        ids.length === 1
          ? "Delete saved URL from library?"
          : `Delete ${ids.length} saved URLs from library?`,
      description:
        ids.length === 1
          ? `${preview || "This saved URL"} will be removed from the Saved URLs library.${
              affectedCollectionCount > 0
                ? " Its collection memberships will also be removed."
                : ""
            } Captured files and evidence snapshots already stored in File Manager will remain available, but the URL's saved-library entry, tags, notes, and favorites will be removed.`
          : `This will remove ${ids.length} saved URLs from the Saved URLs library.${
              affectedCollectionCount > 0
                ? ` ${affectedCollectionCount} of them ${
                    affectedCollectionCount === 1 ? "is" : "are"
                  } currently assigned to collections, and those memberships will also be removed.`
                : ""
            } Captured files and evidence snapshots already stored in File Manager will remain available.${
              preview
                ? ` Examples: ${preview}${targetRows.length > 2 ? "..." : ""}`
                : ""
            }`,
      confirmText: "Delete from library",
      cancelText: "Keep saved",
      danger: true,
    });

    if (!confirmed) return;

    const backup = urls;

    setUrls((prev) => prev.filter((u) => !ids.includes(u.id)));
    setSelection(new Set());

    try {
      const result = await deleteUrlsBulk(idsNum);

      const deletedIdSet = new Set(result.deleted.map((id) => String(id)));
      const failedIds = result.failures.map((failure) => String(failure.id));

      const actuallyDeletedUrls = targetRows
        .filter((u) => deletedIdSet.has(u.id))
        .map((u) => u.url);

      // Keep local collections in sync only for URLs that were truly deleted
      actuallyDeletedUrls.forEach((u) => reconcileUrlCollections(u));

      if (result.failures.length === 0) {
        await refreshSavedUrlsWorkspace(page);

        notify({
          text:
            result.deleted.length === 1
              ? "Deleted 1 saved URL from the library."
              : `Deleted ${result.deleted.length} saved URLs from the library.`,
          kind: "success",
        });
        return;
      }

      // Restore only the rows that failed deletion
      setUrls(backup.filter((u) => !deletedIdSet.has(u.id)));
      setSelection(new Set(failedIds));

      await refreshSavedUrlsWorkspace(page);

      const deletedCount = result.deleted.length;
      const failureCount = result.failures.length;

      const failedPreview = targetRows
        .filter((u) => failedIds.includes(u.id))
        .slice(0, 2)
        .map((u) => u.title || u.url)
        .join(", ");

      notify({
        text:
          deletedCount > 0
            ? `Deleted ${deletedCount} saved URL${deletedCount === 1 ? "" : "s"} from the library, but ${failureCount} could not be deleted.${failedPreview ? ` Failed: ${failedPreview}${failureCount > 2 ? "…" : ""}` : ""}`
            : `No saved URLs were deleted from the library. ${failureCount} delete operation${failureCount === 1 ? "" : "s"} failed.${failedPreview ? ` Failed: ${failedPreview}${failureCount > 2 ? "…" : ""}` : ""}`,
        kind: deletedCount > 0 ? "warning" : "error",
      });
    } catch (e: any) {
      setUrls(backup);
      setSelection(new Set(ids));
      notify({
        text:
          e?.message ?? "Failed to delete the selected rows from this page.",
        kind: "error",
      });
    }
  };

  // -------- Clipboard + Move handlers --------
  const byIds = useCallback(
    (ids: string[]) => urls.filter((u) => ids.includes(u.id)),
    [urls],
  );

  const applyCollectionAssignment = useCallback(
    async (ids: string[], collectionId: string, mode: "add" | "move") => {
      const items = byIds(ids);
      if (!items.length) return;

      const targetCollectionName =
        collections.find((c) => c.id === collectionId)?.name ??
        "selected collection";

      try {
        if (mode === "add") {
          await Promise.all(
            items.map((u) =>
              setUrlCollections(
                u.url,
                Array.from(new Set([...(u.collections || []), collectionId])),
                {
                  title: u.title,
                  snippet: u.description || null,
                },
              ),
            ),
          );

          await refreshSavedUrlsScope();

          notify({
            text:
              items.length === 1
                ? `Added 1 URL to "${targetCollectionName}" without removing its other collections.`
                : `Added ${items.length} URLs to "${targetCollectionName}" without removing their other collections.`,
            kind: "success",
          });
        } else {
          await Promise.all(
            items.map((u) =>
              setUrlCollections(u.url, [collectionId], {
                title: u.title,
                snippet: u.description || null,
              }),
            ),
          );

          await refreshSavedUrlsScope();

          notify({
            text:
              items.length === 1
                ? `Moved 1 URL into "${targetCollectionName}" as its only collection.`
                : `Moved ${items.length} URLs into "${targetCollectionName}" as their only collection.`,
            kind: "success",
          });
        }

        setCollPickerOpen(false);
        setMoveIds([]);
      } catch (e: any) {
        notify({
          text: e?.message ?? "Failed to update collection membership.",
          kind: "error",
        });
      }
    },
    [byIds, collections, notify, refreshSavedUrlsScope],
  );

  const handleCopy = useCallback(
    (ids: string[]) => {
      const items = byIds(ids);
      if (!items.length) return;

      setClipboard({ mode: "copy", items });

      notify({
        text:
          items.length === 1
            ? "Copied 1 URL for collection assignment. Select a destination collection, then use Paste into collection."
            : `Copied ${items.length} URLs for collection assignment. Select a destination collection, then use Paste into collection.`,
        kind: "info",
      });
    },
    [byIds, notify],
  );

  const handleCut = useCallback(
    (ids: string[]) => {
      const items = byIds(ids);
      if (!items.length) return;

      setClipboard({ mode: "cut", items });

      notify({
        text:
          items.length === 1
            ? "Prepared 1 URL to move. Select a destination collection, then use Paste into collection."
            : `Prepared ${items.length} URLs to move. Select a destination collection, then use Paste into collection.`,
        kind: "warning",
      });
    },
    [byIds, notify],
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

    const items = clipboard.items;
    const targetCollectionName =
      selectedCollection?.name ?? "selected collection";

    try {
      if (clipboard.mode === "copy") {
        await Promise.all(
          items.map((u) =>
            setUrlCollections(
              u.url,
              Array.from(
                new Set([...(u.collections || []), selectedCollectionId]),
              ),
              {
                title: u.title,
                snippet: u.description || null,
              },
            ),
          ),
        );

        await refreshSavedUrlsScope();

        notify({
          text:
            items.length === 1
              ? `Added 1 URL to "${targetCollectionName}" without removing its other collections.`
              : `Added ${items.length} URLs to "${targetCollectionName}" without removing their other collections.`,
          kind: "success",
        });
      } else {
        const ok = await confirm({
          title: "Move URLs into this collection only?",
          description:
            items.length === 1
              ? `Move the selected URL into "${targetCollectionName}" and replace its current collection memberships?`
              : `Move ${items.length} selected URLs into "${targetCollectionName}" and replace their current collection memberships?`,
          confirmText: "Move only here",
          cancelText: "Cancel",
          danger: true,
        });

        if (!ok) return;

        await Promise.all(
          items.map((u) =>
            setUrlCollections(u.url, [selectedCollectionId], {
              title: u.title,
              snippet: u.description || null,
            }),
          ),
        );

        await refreshSavedUrlsScope();

        notify({
          text:
            items.length === 1
              ? `Moved 1 URL into "${targetCollectionName}" as its only collection.`
              : `Moved ${items.length} URLs into "${targetCollectionName}" as their only collection.`,
          kind: "success",
        });
      }

      setClipboard(null);
    } catch (e: any) {
      notify({
        text: e?.message ?? "Failed to paste into the selected collection.",
        kind: "error",
      });
    }
  }, [
    clipboard,
    confirm,
    notify,
    refreshSavedUrlsScope,
    selectedCollection,
    selectedCollectionId,
  ]);

  const handleMoveTo = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setMoveIds(ids);
    setCollPickerOpen(true);
  }, []);

  const openCollectionDialogFromPicker = useCallback(() => {
    setCollPickerOpen(false);
    setMoveIds([]);
    openCollectionDialog();
  }, [openCollectionDialog]);

  const canPaste = !!clipboard && !!selectedCollectionId;

  // Quick add
  const handleQuickAdd = async (value: string) => {
    const raw = value.trim();
    if (!raw) return false;

    try {
      const result = await apiSaveUrls([{ url: raw, title: raw, snippet: "" }]);
      const savedRef = result.rows?.[0];

      if (!savedRef?.id) {
        setPage(1);
        await refreshSavedUrlsWorkspace(1);

        notify({
          text:
            result.added > 0
              ? "Saved URL."
              : "URL already exists. Refreshed the existing record list.",
          kind: result.added > 0 ? "success" : "info",
        });

        return true;
      }

      let fresh = await getUrlById(savedRef.id);

      if (selectedCollectionId) {
        const nextCollectionIds = Array.from(
          new Set([...(fresh.collections || []), selectedCollectionId]),
        );

        await setUrlCollections(fresh.url, nextCollectionIds, {
          title: fresh.title,
          snippet: fresh.snippet ?? null,
        });

        fresh = await getUrlById(savedRef.id);
      }

      setPage(1);
      await refreshSavedUrlsWorkspace(1);

      notify({
        text: savedRef.isNew
          ? selectedCollection
            ? `Saved URL and added it to "${selectedCollection.name}".`
            : "Saved URL."
          : selectedCollection
            ? `URL was already saved. Refreshed it and added it to "${selectedCollection.name}".`
            : "URL was already saved. Refreshed the existing record.",
        kind: savedRef.isNew ? "success" : "info",
      });

      return true;
    } catch (e: any) {
      notify({ text: e?.message ?? "Failed to save URL.", kind: "error" });
      return false;
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
    <main className="saved-urls-page space-y-6 px-4 md:px-6 lg:px-8 pt-6 md:pt-8 min-w-0">
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
            <span className="page-header-pill-label">Page rows</span>
            <span className="page-header-pill-value">{sorted.length}</span>
          </div>
          <div className="page-header-pill">
            <span className="page-header-pill-label">
              {isLocalReviewQueueActive ? "Page queue matches" : "Matches"}
            </span>
            <span className="page-header-pill-value">
              {isLocalReviewQueueActive ? sorted.length : totalResults}
            </span>
          </div>
          {selection.size > 0 && (
            <div className="page-header-pill page-header-pill--accent">
              <span className="page-header-pill-label">Selected on page</span>
              <span className="page-header-pill-value">{selection.size}</span>
            </div>
          )}
        </div>
      </header>

      {tagSummary && (tagSummary.inProgress > 0 || tagSummary.failed > 0) && (
        <div className="saved-urls-panel saved-urls-banner p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/10">
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
        <div className="saved-urls-panel saved-urls-banner p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-sky-200 bg-sky-50/60 dark:border-sky-900/40 dark:bg-sky-900/10">
          <div className="text-sm text-sky-950 dark:text-sky-100">
            <span className="font-semibold">Snapshots on this page</span>
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
            <p className="mt-1 text-xs text-sky-800/80 dark:text-sky-200/75">
              Counts and capture actions apply only to the URLs currently loaded
              on this page.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              className="btn-secondary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={() =>
                setFilter((f: any) => ({ ...f, snapshotStatus: "missing" }))
              }
              disabled={bulkRunning}
              title="Filter the full result set to URLs with no active snapshots"
            >
              Show missing
            </button>

            <button
              className="btn-secondary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={() =>
                setFilter((f: any) => ({ ...f, snapshotStatus: "stale" }))
              }
              disabled={bulkRunning}
              title={`Filter the full result set to URLs with snapshots older than ${SNAPSHOT_STALE_DAYS} days`}
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
                  title="Capture TEXT snapshots for missing URLs currently loaded on this page"
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
                  title="Capture PDF snapshots for missing URLs currently loaded on this page"
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
                  title="Refresh TEXT snapshots for stale URLs currently loaded on this page"
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
                  title="Refresh PDF snapshots for stale URLs currently loaded on this page"
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

      <div className="saved-urls-panel p-4 sm:p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div>
            <p className="page-header-kicker">Review operations</p>
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-100">
              Review queues & saved searches
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">
              Jump straight into stale captures, failed AI jobs, and metadata
              gaps. Local review checks stay separate and only apply to the rows
              loaded on the current page.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end ">
            <span className="page-header-pill">
              <span className="page-header-pill-label">State</span>
              <span className="page-header-pill-value">
                {savedSearchStateLabel}
              </span>
            </span>

            <button
              type="button"
              className="btn-primary px-3 py-2 rounded-lg disabled:opacity-60"
              onClick={markVisibleReviewed}
              disabled={sorted.length === 0}
              title="Mark every visible row on this page as reviewed right now"
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

            {displayedSavedSearch && (
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

        <div className="space-y-3">
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

          <div className="rounded-2xl border border-dashed border-black/10 bg-neutral-50/70 p-3 dark:border-white/10 dark:bg-neutral-900/40">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
              Local review queue
            </div>

            <button
              type="button"
              onClick={() => setActiveQueueId(localReviewQueue.id)}
              title={localReviewQueue.help}
              className={[
                "w-full rounded-xl border px-3 py-2 text-left transition",
                activeQueueId === localReviewQueue.id
                  ? "border-brand-primary bg-brand-primary/10 text-brand-primary shadow-sm"
                  : "border-black/10 dark:border-white/10 hover:bg-white dark:hover:bg-neutral-900/60",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {localReviewQueue.label}
                </span>
                <span className="chip chip-slate">
                  {localReviewQueue.count}
                </span>
              </div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {localReviewQueue.help}
              </div>
            </button>

            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              This queue uses browser-local review stamps and only evaluates the
              rows already loaded on the current page.
            </p>
          </div>
        </div>

        {savedSearches.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
              Saved searches
            </div>

            <div className="flex flex-wrap gap-2">
              {savedSearches.map((preset) => {
                const active = currentSavedSearchMatch?.id === preset.id;
                const editedFromThisPreset =
                  !currentSavedSearchMatch &&
                  activeSavedSearchDirty &&
                  activeSavedSearch?.id === preset.id;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySavedSearch(preset)}
                    title={
                      active
                        ? `Applied saved search: ${preset.name}`
                        : editedFromThisPreset
                          ? `Current view was edited from "${preset.name}"`
                          : `Apply saved search: ${preset.name}`
                    }
                    className={[
                      "rounded-full px-3 py-2 text-sm border transition",
                      active
                        ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                        : editedFromThisPreset
                          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200"
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
        <div className="saved-urls-panel saved-urls-banner p-3 sm:p-4 border border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-900/10">
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
      <section className="grid grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)] gap-5 xl:gap-6 items-start min-w-0">
        {/* Sidebar */}
        <div className="saved-urls-grid-item min-w-0">
          <div className="md:sticky md:top-20 lg:top-[76px]">
            <div className="saved-urls-panel saved-urls-sidebar-panel h-full p-4 sm:p-5">
              <CollectionSidebar
                collections={collections}
                collectionCounts={collectionCounts}
                totalUrlCount={libraryTotalCount}
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
        <div className="saved-urls-grid-item min-w-0">
          <div className="saved-urls-panel saved-urls-main-panel p-4 sm:p-5 lg:p-6 space-y-5 md:space-y-6 mb-10 min-w-0">
            {/* Toolbar: 2-row responsive grid to avoid collisions */}
            <header
              className="saved-urls-toolbar relative grid grid-cols-12 gap-4 rounded-2xl p-4 md:p-5 min-w-0"
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
                  isLoading={loading}
                />
              </div>

              {/* Row 2: ALL SELECTS IN ONE ROW */}
              <div className="col-span-12">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                    {/* Saved year */}
                    <label className="sr-only" htmlFor="year-filter">
                      Filter by saved year
                    </label>
                    <select
                      id="year-filter"
                      className="input-pill w-auto shrink-0 min-w-[11rem] text-sm py-2.5 px-3 hover:cursor-pointer transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      title="Filter by saved year"
                      aria-label="Filter by saved year"
                    >
                      {availableYears.map((y) => (
                        <option key={y} value={y}>
                          {y === "all" ? "All saved years" : y}
                        </option>
                      ))}
                    </select>

                    {/* Sort key */}
                    <label className="sr-only" htmlFor="sortKey">
                      Sort key
                    </label>
                    <select
                      id="sortKey"
                      className="input-pill w-auto shrink-0 min-w-[11rem] text-sm py-2.5 px-3 hover:cursor-pointer transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value as SortKey)}
                      title="Sort key"
                    >
                      <option value="createdAt">Sort: Saved date</option>
                      <option value="updatedAt">Sort: Updated</option>
                      <option value="title">Sort: Title</option>
                    </select>

                    {/* Sort order */}
                    <label className="sr-only" htmlFor="sortOrder">
                      Sort order
                    </label>
                    <select
                      id="sortOrder"
                      className="input-pill w-auto shrink-0 min-w-[7rem] text-sm py-2.5 px-3 hover:cursor-pointer transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                      value={sortOrder}
                      onChange={(e) =>
                        setSortOrder(e.target.value as SortOrder)
                      }
                      title="Sort order"
                    >
                      <option value="desc">Desc</option>
                      <option value="asc">Asc</option>
                    </select>
                  </div>

                  <div className="inline-flex self-start xl:self-auto items-center rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/70 p-1 shadow-sm">
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
                  className="input h-11 w-full md:w-[min(100%,30rem)] rounded-xl shadow-sm transition focus:ring-2 focus:ring-brand-primary/40 focus:outline-none"
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;

                    e.preventDefault();
                    const input = e.currentTarget;
                    const ok = await handleQuickAdd(input.value);

                    if (ok) {
                      input.value = "";
                    }
                  }}
                />
              </div>
            </header>

            {bulkAiTagRun.status !== "idle" && (
              <div className="card p-4 space-y-4 border border-brand-primary/15 bg-brand-primary/5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {bulkAiTagRun.status === "running" &&
                        "AI auto-tag is running"}
                      {bulkAiTagRun.status === "cancelling" &&
                        "Cancelling AI auto-tag…"}
                      {bulkAiTagRun.status === "cancelled" &&
                        "AI auto-tag cancelled"}
                      {bulkAiTagRun.status === "completed" &&
                        (bulkAiTagRun.failed > 0
                          ? "AI auto-tag finished with some failures"
                          : "AI auto-tag finished")}
                    </div>

                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {bulkAiTagRun.completed} of {bulkAiTagRun.total} processed
                      · {bulkAiTagRun.succeeded} succeeded ·{" "}
                      {bulkAiTagRun.failed} failed
                    </div>

                    {bulkAiTagRun.currentTitle && bulkAiTagIsBusy && (
                      <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                        Current: {bulkAiTagRun.currentTitle}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {bulkAiTagIsBusy ? (
                      <button
                        type="button"
                        onClick={cancelBulkAiTagRun}
                        className="btn-ghost px-3 py-2 rounded-lg transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                      >
                        Cancel run
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={dismissBulkAiTagRun}
                        className="btn-ghost px-3 py-2 rounded-lg transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-brand-primary transition-all duration-300"
                    style={{ width: `${bulkAiTagProgressPercent}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  <div className="rounded-xl border border-black/10 dark:border-white/10 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">
                      Completed
                    </div>
                    <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                      {bulkAiTagRun.completed}
                    </div>
                  </div>
                  <div className="rounded-xl border border-black/10 dark:border-white/10 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">
                      Remaining
                    </div>
                    <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                      {bulkAiTagRemaining}
                    </div>
                  </div>
                  <div className="rounded-xl border border-black/10 dark:border-white/10 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">
                      Succeeded
                    </div>
                    <div className="mt-1 font-semibold text-emerald-700 dark:text-emerald-300">
                      {bulkAiTagRun.succeeded}
                    </div>
                  </div>
                  <div className="rounded-xl border border-black/10 dark:border-white/10 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">
                      Failed
                    </div>
                    <div className="mt-1 font-semibold text-red-700 dark:text-red-300">
                      {bulkAiTagRun.failed}
                    </div>
                  </div>
                </div>

                {bulkAiTagRun.failures.length > 0 && (
                  <div className="rounded-xl border border-red-200/70 bg-red-50/70 p-3 dark:border-red-500/20 dark:bg-red-500/10">
                    <div className="text-xs font-semibold text-red-700 dark:text-red-300">
                      Failed rows
                    </div>

                    <ul className="mt-2 space-y-1 text-xs text-red-700 dark:text-red-200">
                      {bulkAiTagRun.failures.slice(0, 5).map((failure) => (
                        <li key={`${failure.id}-${failure.message}`}>
                          <span className="font-medium">{failure.title}</span>:{" "}
                          {failure.message}
                        </li>
                      ))}
                    </ul>

                    {bulkAiTagRun.failures.length > 5 && (
                      <div className="mt-2 text-xs text-red-700 dark:text-red-200">
                        +{bulkAiTagRun.failures.length - 5} more failures
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Selection controls */}
            {sorted.length > 0 && (
              <div className="flex flex-col gap-3 text-sm text-gray-600 dark:text-gray-300 md:flex-row md:items-center md:justify-between">
                <div>
                  <div>
                    {selection.size > 0
                      ? `${selection.size} selected on this page`
                      : "No rows selected on this page"}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Bulk actions below apply only to the currently visible page
                    selection. If a bulk action partially fails, only the failed
                    rows stay selected so you can retry them.
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectAllPage}
                    className="btn-ghost px-2 py-1 rounded-lg transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    title="Select every row on the current page"
                  >
                    Select page ({sorted.length})
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="btn-ghost px-2 py-1 rounded-lg transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    title="Clear the current page selection"
                  >
                    Clear selection
                  </button>
                  <button
                    onClick={() =>
                      onAutoTagSelected(selectedItems.map((u) => u.id))
                    }
                    disabled={selectedItems.length === 0 || bulkAiTagIsBusy}
                    className="btn-primary inline-flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm transition hover:translate-y-[-1px] focus:outline-none focus:ring-2 focus:ring-brand-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      bulkAiTagIsBusy
                        ? "Bulk AI auto-tag is already running for a page selection"
                        : "Run AI auto-tag on the selected rows on this page"
                    }
                  >
                    {bulkAiTagRun.status === "cancelling"
                      ? "Cancelling…"
                      : bulkAiTagIsBusy
                        ? "AI Auto-Tag running…"
                        : "AI Auto-Tag page selection"}
                  </button>
                </div>
              </div>
            )}

            {/* Bulk action bar */}
            {selectedItems.length > 0 && (
              <div className="sticky top-20 lg:top-[76px] z-20">
                <BulkActionBar
                  selected={selectedItems}
                  selectionSummary={`${selectedItems.length} selected on this page`}
                  onDelete={onDelete}
                  onAddTag={onAddTag}
                  onRequestAddTag={openBulkAddTagDialog}
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
                    a.download = "saved_urls_page_selection.csv";
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  onCopy={handleCopy}
                  onCut={handleCut}
                  onPaste={handlePaste}
                  canPaste={canPaste}
                  onMoveTo={handleMoveTo}
                  deleteLabel="Delete from library"
                  deleteTitle="Delete the selected saved URLs from the library"
                  exportLabel="Export page selection"
                  exportTitle="Export the selected rows on this page as CSV"
                  moveToLabel="Assign page selection…"
                  moveToTitle="Choose whether to add the selected rows on this page to another collection or move them into it"
                  copyLabel="Copy page selection"
                  copyTitle="Copy the selected rows on this page so you can add them to another collection"
                  cutLabel="Cut page selection"
                  cutTitle="Prepare the selected rows on this page to move into a different collection"
                  pasteLabel={
                    selectedCollection
                      ? `Paste into ${selectedCollection.name}`
                      : "Paste into collection"
                  }
                  pasteTitle={
                    selectedCollection
                      ? `Paste the copied page selection into "${selectedCollection.name}"`
                      : "Select a collection in the sidebar, then paste into it"
                  }
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
                {libraryTotalCount === 0 ? (
                  <div className="space-y-2">
                    <div className="font-medium text-gray-800 dark:text-gray-100">
                      No saved URLs yet.
                    </div>
                    <div>
                      Paste a URL above and press Enter to save your first one.
                    </div>
                  </div>
                ) : isLocalReviewQueueActive ? (
                  <div className="space-y-2">
                    <div className="font-medium text-gray-800 dark:text-gray-100">
                      No rows on this page have changed since your local review
                      stamp.
                    </div>
                    <div>
                      Move to another page, clear the local review queue, or
                      mark this page as reviewed again after new changes land.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="font-medium text-gray-800 dark:text-gray-100">
                      No rows on this page match the current filters.
                    </div>
                    <div>
                      Try clearing filters, switching queues, or choosing a
                      different collection.
                    </div>
                  </div>
                )}
              </div>
            )}

            {!loading && !error && totalResults > 0 && (
              <div className="flex flex-col gap-3 rounded-xl border border-black/10 dark:border-white/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-neutral-600 dark:text-neutral-300">
                  {isLocalReviewQueueActive ? (
                    <>
                      Showing{" "}
                      <span className="font-medium">{sorted.length}</span>{" "}
                      locally queued URLs on this page. The broader filtered
                      result set still contains{" "}
                      <span className="font-medium">{totalResults}</span> URLs
                      across all pages.
                    </>
                  ) : (
                    <>
                      Showing{" "}
                      <span className="font-medium">
                        {urls.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
                      </span>{" "}
                      –{" "}
                      <span className="font-medium">
                        {Math.min(page * PAGE_SIZE, totalResults)}
                      </span>{" "}
                      of <span className="font-medium">{totalResults}</span>{" "}
                      matching URLs across all pages
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </button>

                  <span className="text-sm text-neutral-600 dark:text-neutral-300">
                    Page <span className="font-medium">{page}</span> of{" "}
                    <span className="font-medium">{totalPages}</span>
                  </span>

                  <button
                    type="button"
                    className="rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Registry / Cards */}
            {viewMode === "registry" ? (
              <SourceRegistryTable
                rows={sorted}
                selection={selection}
                allPageRowsSelected={allPageRowsSelected}
                onToggleSelect={toggleSelect}
                onSelectAllPage={selectAllPage}
                onClearSelection={clearSelection}
                onOpenDetail={(x) => setDetailId(x.id)}
                onFavoriteToggle={handleFavoriteToggle}
                onCapture={openCapturePicker}
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
                      onOpenDetail={(x) => setDetailId(x.id)}
                      onCapture={openCapturePicker}
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

            <TextEntryModal
              open={bulkTagDialogIds.length > 0}
              onClose={closeBulkAddTagDialog}
              title="Add tag to page selection"
              description={
                bulkTagDialogIds.length === 1
                  ? "Apply one user tag to the selected Saved URL. Existing user tags and AI tags will be preserved."
                  : `Apply one user tag to ${bulkTagDialogIds.length} selected Saved URLs on this page. Existing user tags and AI tags will be preserved.`
              }
              value={bulkTagDialogValue}
              placeholder="e.g. indoor-air, follow-up, reading-list"
              submitLabel={
                bulkTagDialogIds.length === 1
                  ? "Add tag"
                  : `Add tag to ${bulkTagDialogIds.length} URLs`
              }
              busy={bulkTagDialogBusy}
              onChange={setBulkTagDialogValue}
              onSubmit={submitBulkAddTagDialog}
            />

            <CollectionPickerModal
              isOpen={collPickerOpen}
              title={
                moveIds.length === 1
                  ? "Assign collection"
                  : `Assign collection to ${moveIds.length} URLs`
              }
              description="Add keeps existing collection memberships. Move only here replaces them with the selected collection."
              collections={collections}
              selectedCount={moveIds.length}
              onCancel={() => {
                setCollPickerOpen(false);
                setMoveIds([]);
              }}
              onAddToCollection={(collectionId) => {
                applyCollectionAssignment(moveIds, collectionId, "add");
              }}
              onMoveToCollection={async (collectionId) => {
                const targetCollectionName =
                  collections.find((c) => c.id === collectionId)?.name ??
                  "selected collection";

                const ok = await confirm({
                  title: "Move selected URLs into one collection?",
                  description:
                    moveIds.length === 1
                      ? `Move the selected URL into "${targetCollectionName}" and replace its current collection memberships?`
                      : `Move ${moveIds.length} selected URLs into "${targetCollectionName}" and replace their current collection memberships?`,
                  confirmText: "Move only here",
                  cancelText: "Cancel",
                  danger: true,
                });

                if (!ok) return;

                applyCollectionAssignment(moveIds, collectionId, "move");
              }}
              onRequestCreate={openCollectionDialogFromPicker}
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

                const openedFromDetailModal = detailId === pickerTarget.id;

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

                  // Refresh list so latestSnapshot appears immediately.
                  await refreshUrlsFromServer();

                  if (openedFromDetailModal) {
                    setDetailCaptureRefreshKey((key) => key + 1);
                  }

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
                onClose={() => setDetailId(null)}
                onFavoriteToggle={handleFavoriteToggle}
                onTagUpdate={updateTags}
                onNotesChange={handleNotesChange}
                collectionNamesById={collectionNamesById}
                onRequestCapture={openCapturePicker}
                captureRefreshKey={detailCaptureRefreshKey}
                isCapturePickerOpen={pickerOpen}
                onUrlHydrate={async (fresh) => {
                  const next = toUISaved(fresh);
                  setUrls((prev) =>
                    prev.map((u) => (u.id === next.id ? { ...u, ...next } : u)),
                  );

                  await refreshRowsAndFacetsAndQueue();
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
