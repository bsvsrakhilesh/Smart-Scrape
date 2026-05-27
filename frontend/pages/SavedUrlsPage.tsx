import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SavedUrl as UISavedUrl, Collection } from "../lib/types";
import SearchFilterUrls, {
  UrlFilterState,
} from "../components/savedurls/SearchFilterUrls";
import SavedUrlCard from "../components/savedurls/SavedUrlCard";
import SavedUrlDetailModal from "../components/savedurls/SavedUrlDetailModal";
import CollectionSidebar from "../components/savedurls/CollectionSidebar";
import CollectionPickerModal from "../components/savedurls/CollectionPickerModal";
import SavedUrlsEmptyState from "../components/savedurls/SavedUrlsEmptyState";
import SavedUrlsOperationsPanel from "../components/savedurls/SavedUrlsOperationsPanel";
import SavedUrlsPagination from "../components/savedurls/SavedUrlsPagination";
import BulkActionBar from "../components/common/BulkActionBar";
import SourceRegistryTable from "../components/savedurls/SourceRegistryTable";
import {
  fetchSavedUrlsPage as apiFetchSavedUrlsPage,
  fetchSavedUrlFacets as apiFetchSavedUrlFacets,
  fetchSavedUrlReviewQueueSummary as apiFetchSavedUrlReviewQueueSummary,
  saveUrls as apiSaveUrls,
  patchUrl,
  type BackendUrlRow,
  type FetchSavedUrlsParams,
  type UrlTaggingSummary,
  type BackendSavedUrlSearchPreset,
  getUrlTaggingSummary,
  retryFailedUrlTagging,
  crawlSavePdf,
  crawlSaveText,
  getUrlTagJob,
  getUrlById,
  refreshUrlMetadata,
  fetchSavedUrlSearchPresets,
  createSavedUrlSearchPreset,
  updateSavedUrlSearchPreset,
  deleteSavedUrlSearchPreset,
  getCollectorPurpose,
  listCollectorPurposes,
  type CollectorPurpose,
} from "../lib/api";
import { useSavedUrlOperationsQuery } from "../hooks/useSavedUrlOperations";
import { useSavedUrlReviewState } from "../hooks/useSavedUrlReviewState";
import { useSavedUrlsWorkspaceQuery } from "../hooks/useSavedUrlsWorkspaceQuery";
import {
  deriveSeparatedTags,
  mergeUniqueTags,
  normalizeTagList,
} from "../lib/tagBuckets";
import {
  AI_TAG_JOB_POLL_MS,
  deriveAiTagRuntimeFromJob,
} from "../lib/aiTagUi";
import FolderPickerModal from "../components/urlcollector/FolderPickerModal";
import PdfDiscoveryDrawer from "../components/urlcollector/PdfDiscoveryDrawer";
import {
  getCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setUrlCollections,
  hydrateCollectionsFromBackend,
} from "../utils/collections";
import { StaggerList, StaggerItem } from "../components/motion/StaggerList";
import TextEntryModal from "../components/common/TextEntryModal";
import { useToast } from "../components/providers/Toast";
import { useConfirm } from "../components/providers/Confirm";
import { openGovernanceWorkspace } from "../lib/governanceWorkspace";

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
const SAVED_URLS_REGISTRY_VIEW_QUERY = "(min-width: 1024px)";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function canUseSavedUrlsRegistryView(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(SAVED_URLS_REGISTRY_VIEW_QUERY).matches;
}

function getInitialSavedUrlsViewMode(): SavedUrlsViewMode {
  if (typeof window === "undefined") return "registry";
  if (!canUseSavedUrlsRegistryView()) return "cards";

  const stored = localStorage.getItem(SAVED_URLS_VIEW_KEY);
  return stored === "cards" ? "cards" : "registry";
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

function shortQueueTitle(
  item?: { title?: string | null; url?: string | null },
  max = 88,
): string {
  const raw = String(item?.title || item?.url || "Untitled URL").trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function queueDomain(item?: {
  normalizedDomain?: string | null;
  url?: string | null;
}): string {
  if (item?.normalizedDomain) return item.normalizedDomain;
  if (!item?.url) return "";
  return getDomain(item.url);
}

function relativeQueueAge(iso?: string | null): string {
  if (!iso) return "";

  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";

  const diffMs = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diffMs / 1000);

  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function queueHealthLabel(
  health?: "idle" | "processing" | "waiting_for_worker" | "attention_required",
): string {
  if (health === "processing") return "Processing now";
  if (health === "waiting_for_worker") return "Waiting for worker";
  if (health === "attention_required") return "Needs attention";
  return "Idle";
}

function reviewQueueToneClass(id: SavedUrlQueueId, active: boolean): string {
  if (active) {
    switch (id) {
      case "ai-failed":
        return "border-red-300 bg-red-50 text-red-800 shadow-sm dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-200";
      case "never-captured":
      case "stale-capture":
      case "metadata-missing":
        return "border-amber-300 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200";
      case "updated-since-review":
        return "border-sky-300 bg-sky-50 text-sky-800 shadow-sm dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200";
      default:
        return "border-brand-primary bg-brand-primary/10 text-brand-primary shadow-sm";
    }
  }

  switch (id) {
    case "ai-failed":
      return "border-red-200/80 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/20";
    case "never-captured":
    case "stale-capture":
    case "metadata-missing":
      return "border-amber-200/80 text-amber-800 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-950/20";
    case "updated-since-review":
      return "border-sky-200/80 text-sky-800 hover:bg-sky-50 dark:border-sky-900/50 dark:text-sky-200 dark:hover:bg-sky-950/20";
    default:
      return "border-black/10 text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-neutral-900/60";
  }
}

function faviconFor(u: string): string {
  const d = getDomain(u) || "example.com";
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(d)}`;
}

function isPdfUrlLike(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.pathname.toLowerCase().endsWith(".pdf") ||
      u.search.toLowerCase().includes(".pdf")
    );
  } catch {
    return String(raw || "").toLowerCase().includes(".pdf");
  }
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
    discoverySummary: (row as any).discoverySummary ?? null,
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
  const location = useLocation();
  const navigate = useNavigate();
  const purposeFromUrl =
    new URLSearchParams(location.search).get("collectorPurposeId") ?? "";
  const [collectorPurposes, setCollectorPurposes] = useState<CollectorPurpose[]>([]);
  const [activePurposeId, setActivePurposeId] = useState(purposeFromUrl);
  const [activePurpose, setActivePurpose] = useState<CollectorPurpose | null>(null);
  // Data
  const [urls, setUrls] = useState<UISavedUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActivePurposeId(purposeFromUrl);
  }, [purposeFromUrl]);

  useEffect(() => {
    void listCollectorPurposes().then(setCollectorPurposes).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activePurposeId) {
      setActivePurpose(null);
      return;
    }
    void getCollectorPurpose(activePurposeId)
      .then(setActivePurpose)
      .catch(() => setActivePurpose(null));
  }, [activePurposeId]);

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
    updatedSinceReview?: number;
  }>({
    all: 0,
    neverCaptured: 0,
    staleCapture: 0,
    aiFailed: 0,
    metadataMissing: 0,
    updatedSinceReview: 0,
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
      collectorPurposeId: activePurposeId || undefined,
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
    activePurposeId,
    serverDateFrom,
    serverDateTo,
    serverPublishedFrom,
    serverPublishedTo,
    year,
  ]);

  const baseServerQuery = useMemo<FetchSavedUrlsParams>(() => {
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
      collectorPurposeId: activePurposeId || undefined,
      favoritesOnly: filter.favoritesOnly || undefined,
      visibility: filter.visibility !== "all" ? filter.visibility : undefined,
      dateFrom: serverDateFrom,
      dateTo: serverDateTo,
      publishedFrom: serverPublishedFrom,
      publishedTo: serverPublishedTo,
      snapshotStatus,
      taggingStatus,
      metadataState,
      reviewStatus:
        activeQueueId === "updated-since-review"
          ? "updated-since-review"
          : undefined,
      sortKey,
      sortOrder,
      pageSize: PAGE_SIZE,
    };
  }, [
    activeServerQueue,
    activeQueueId,
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
    activePurposeId,
    serverDateFrom,
    serverDateTo,
    serverPublishedFrom,
    serverPublishedTo,
    sortKey,
    sortOrder,
    year,
  ]);

  const workspaceQueryParams = useMemo(
    () => ({
      ...baseServerQuery,
      queueId: activeQueueId,
      page,
    }),
    [activeQueueId, baseServerQuery, page],
  );
  const workspaceQuery = useSavedUrlsWorkspaceQuery(workspaceQueryParams);

  const visibleUrlIds = useMemo(
    () =>
      urls
        .map((url) => Number(url.id))
        .filter((id) => Number.isFinite(id)),
    [urls],
  );
  const savedUrlReviewState = useSavedUrlReviewState(visibleUrlIds);
  const savedUrlOperations = useSavedUrlOperationsQuery(20);
  const captureOperationLive = useMemo(
    () =>
      (savedUrlOperations.data?.items ?? []).some(
        (operation) =>
          (operation.status === "queued" || operation.status === "running") &&
          (operation.type === "saved_url_bulk_capture_text" ||
            operation.type === "saved_url_bulk_capture_pdf" ||
            operation.type === "saved_url_discovered_pdf_capture"),
      ),
    [savedUrlOperations.data?.items],
  );

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

  const [canUseRegistryView, setCanUseRegistryView] = useState(
    canUseSavedUrlsRegistryView,
  );
  const [viewMode, setViewMode] = useState<SavedUrlsViewMode>(
    getInitialSavedUrlsViewMode,
  );
  const effectiveViewMode: SavedUrlsViewMode = canUseRegistryView
    ? viewMode
    : "cards";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia(SAVED_URLS_REGISTRY_VIEW_QUERY);
    const apply = () => setCanUseRegistryView(media.matches);

    apply();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }

    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!canUseRegistryView) return;
    localStorage.setItem(SAVED_URLS_VIEW_KEY, viewMode);
  }, [canUseRegistryView, viewMode]);

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
  const [pdfDiscoveryTarget, setPdfDiscoveryTarget] =
    useState<UISavedUrl | null>(null);

  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [detailCaptureRefreshKey, setDetailCaptureRefreshKey] = useState(0);

  // Bulk snapshot enforcement
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkPickerMode, setBulkPickerMode] = useState<"text" | "pdf">("text");
  const [bulkTargets, setBulkTargets] = useState<UISavedUrl[]>([]);

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

  useEffect(() => {
    const data = workspaceQuery.data;
    if (!data) return;

    const requestedPage = workspaceQueryParams.page ?? 1;
    if (!data.urls.items.length && data.urls.total > 0 && requestedPage > 1) {
      setPage(Math.max(1, Math.ceil(data.urls.total / data.urls.pageSize)));
      return;
    }

    setUrls(data.urls.items.map(toUISaved));
    setTotalResults(data.urls.total);
    setFacetSummary(data.facets);
    setQueueSummary(data.queueSummary);
    setCollections(data.collections as Collection[]);
    setSavedSearches(data.savedSearches.map(toSavedUrlSearchPreset));
    setTagSummary(data.taggingSummary);
    setTagSummaryError(null);
    setLibraryTotalCount(data.libraryTotal);
    setError(null);
    setLoading(false);
  }, [workspaceQuery.data, workspaceQueryParams.page]);

  useEffect(() => {
    if (workspaceQuery.isLoading || (workspaceQuery.isFetching && !workspaceQuery.data)) {
      setLoading(true);
    }
  }, [workspaceQuery.data, workspaceQuery.isFetching, workspaceQuery.isLoading]);

  useEffect(() => {
    if (!workspaceQuery.error) return;
    setError(
      (workspaceQuery.error as any)?.message ??
        "Failed to load saved URLs workspace",
    );
    setLoading(false);
  }, [workspaceQuery.error]);

  const operationTerminalSignature = useMemo(
    () =>
      (savedUrlOperations.data?.items ?? [])
        .filter(
          (operation) =>
            operation.status === "success" ||
            operation.status === "failed" ||
            operation.status === "canceled",
        )
        .map((operation) => `${operation.id}:${operation.status}:${operation.updatedAt}`)
        .join("|"),
    [savedUrlOperations.data?.items],
  );

  useEffect(() => {
    if (!operationTerminalSignature) return;
    void Promise.all([
      refreshRowsAndFacetsAndQueue(),
      refreshTaggingSummary(),
      refreshCollectionsFromServer(),
    ]);
  }, [
    operationTerminalSignature,
    refreshCollectionsFromServer,
    refreshRowsAndFacetsAndQueue,
    refreshTaggingSummary,
  ]);

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

  const startBulkCapture = useCallback(
    async (
      mode: "text" | "pdf",
      targets: UISavedUrl[],
      folderId?: string | null,
    ) => {
      if (!targets.length) return;

      const operationUrlIds = targets
        .map((target) => Number(target.id))
        .filter((id) => Number.isFinite(id));
      if (!operationUrlIds.length) return;

      try {
        await savedUrlOperations.createOperation.mutateAsync({
          type:
            mode === "pdf"
              ? "saved_url_bulk_capture_pdf"
              : "saved_url_bulk_capture_text",
          urlIds: operationUrlIds,
          options: {
            folderId: folderId ?? null,
          },
        });

        notify({
          text:
            operationUrlIds.length === 1
              ? `Queued ${mode.toUpperCase()} capture for 1 URL.`
              : `Queued ${mode.toUpperCase()} capture for ${operationUrlIds.length} URLs.`,
          kind: "success",
        });
      } catch (e: any) {
        notify({
          text: e?.message ?? "Could not queue capture operation.",
          kind: "error",
        });
      }
      return;
    },
    [notify, savedUrlOperations.createOperation],
  );

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
                await refreshUrlMetadata(idNum).catch(() => null);
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
    () => queueSummary.updatedSinceReview ?? 0,
    [queueSummary.updatedSinceReview],
  );

  const isReviewQueueActive = activeQueueId === "updated-since-review";

  const queueFiltered = useMemo(() => {
    return urls;
  }, [urls]);

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
      help: "Server-backed review state for URLs updated after your last review",
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

  const markVisibleReviewed = useCallback(async () => {
    if (!sorted.length) return;
    const ids = sorted
      .map((u) => Number(u.id))
      .filter((id) => Number.isFinite(id));
    if (!ids.length) return;

    try {
      await savedUrlReviewState.markReviewed.mutateAsync(ids);
      await refreshRowsAndQueueSummary();
      notify({
        text:
          ids.length === 1
            ? "Marked 1 visible URL as reviewed."
            : `Marked ${ids.length} visible URLs as reviewed.`,
        kind: "success",
      });
    } catch (e: any) {
      notify({
        text: e?.message ?? "Failed to mark URLs reviewed.",
        kind: "error",
      });
    }
  }, [notify, refreshRowsAndQueueSummary, savedUrlReviewState.markReviewed, sorted]);

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
      if (mode === "pdf" && !isPdfUrlLike(url.url)) {
        setPdfDiscoveryTarget(url);
        return;
      }
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

      const urlIds = ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

      if (!urlIds.length) return;

      try {
        await savedUrlOperations.createOperation.mutateAsync({
          type: "saved_url_bulk_ai_tag",
          urlIds,
        });

        notify({
          text:
            urlIds.length === 1
              ? "Queued AI auto-tag for 1 selected row."
              : `Queued AI auto-tag for ${urlIds.length} selected rows.`,
          kind: "success",
        });
      } catch (e: any) {
        notify({
          text: e?.message ?? "Could not queue AI auto-tag operation.",
          kind: "error",
        });
      }
    },
    [notify, savedUrlOperations.createOperation],
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

    try {
      await savedUrlOperations.createOperation.mutateAsync({
        type: "saved_url_bulk_delete",
        urlIds: idsNum,
      });
      setSelection(new Set());
      notify({
        text:
          ids.length === 1
            ? "Queued deletion for 1 saved URL."
            : `Queued deletion for ${ids.length} saved URLs.`,
        kind: "success",
      });
      return;
    } catch (e: any) {
      notify({
        text: e?.message ?? "Could not queue delete operation.",
        kind: "error",
      });
      return;
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
        await savedUrlOperations.createOperation.mutateAsync({
          type: "saved_url_collection_assign",
          urlIds: items
            .map((item) => Number(item.id))
            .filter((id) => Number.isFinite(id)),
          options: {
            collectionId,
            collectionMode: mode,
          },
        });

        setCollPickerOpen(false);
        setMoveIds([]);

        notify({
          text:
            items.length === 1
              ? `Queued collection update for 1 URL into "${targetCollectionName}".`
              : `Queued collection update for ${items.length} URLs into "${targetCollectionName}".`,
          kind: "success",
        });
        return;

      } catch (e: any) {
        notify({
          text: e?.message ?? "Failed to update collection membership.",
          kind: "error",
        });
      }
    },
    [
      byIds,
      collections,
      notify,
      savedUrlOperations.createOperation,
    ],
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

  const activeReviewQueue =
    activeQueueId === localReviewQueue.id
      ? localReviewQueue
      : reviewQueues.find((queue) => queue.id === activeQueueId);

  const openBulkSnapshotPicker = (
    targets: UISavedUrl[],
    mode: "text" | "pdf",
  ) => {
    setBulkTargets(targets);
    setBulkPickerMode(mode);
    setBulkPickerOpen(true);
  };

  const snapshotPrimaryAction =
    snapshotHealth.missingCount > 0
      ? {
          label: "Capture missing text",
          title:
            "Capture text snapshots for missing URLs currently loaded on this page",
          targets: snapshotHealth.missing,
          mode: "text" as const,
        }
      : snapshotHealth.staleCount > 0
        ? {
            label: "Refresh stale text",
            title:
              "Refresh text snapshots for stale URLs currently loaded on this page",
            targets: snapshotHealth.stale,
            mode: "text" as const,
          }
        : null;

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
              {isReviewQueueActive ? "Review matches" : "Matches"}
            </span>
            <span className="page-header-pill-value">{totalResults}</span>
          </div>
          {selection.size > 0 && (
            <div className="page-header-pill page-header-pill--accent">
              <span className="page-header-pill-label">Selected on page</span>
              <span className="page-header-pill-value">{selection.size}</span>
            </div>
          )}
        </div>
      </header>

      <section className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-[240px]">
          <label htmlFor="saved-url-purpose-filter" className="text-xs font-semibold text-gray-600">
            Purpose intake
          </label>
          <select
            id="saved-url-purpose-filter"
            className="input mt-2 w-full max-w-sm"
            value={activePurposeId}
            onChange={(event) => {
              const nextId = event.target.value;
              const params = new URLSearchParams(location.search);
              if (nextId) params.set("collectorPurposeId", nextId);
              else params.delete("collectorPurposeId");
              navigate({ search: params.toString() ? `?${params.toString()}` : "" });
              setPage(1);
            }}
          >
            <option value="">All saved URLs</option>
            {collectorPurposes.map((purpose) => (
              <option key={purpose.id} value={purpose.id}>
                {purpose.title}
              </option>
            ))}
          </select>
        </div>

        {activePurpose && (
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <span className="rounded-full border border-gray-200 px-3 py-2 text-xs font-medium">
              {activePurpose.summary.savedUrlCount} saved sources
            </span>
            <span className="rounded-full border border-gray-200 px-3 py-2 text-xs font-medium">
              {activePurpose.summary.capturedEvidenceCount} captured artifacts
            </span>
            <span className="rounded-full border border-gray-200 px-3 py-2 text-xs font-medium">
              {activePurpose.summary.governanceReadyDocumentCount} ready documents
            </span>
            <button
              type="button"
              className="btn-ghost px-4 py-2"
              onClick={() =>
                navigate(
                  `/app/file-manager?collectorPurposeId=${encodeURIComponent(activePurpose.id)}`,
                )
              }
            >
              View captured evidence
            </button>
            <button
              type="button"
              className="btn-primary px-4 py-2 disabled:opacity-50"
              disabled={activePurpose.summary.governanceReadyDocumentCount === 0}
              title={
                activePurpose.summary.governanceReadyDocumentCount === 0
                  ? "Capture text or PDF evidence from a saved source first"
                  : "Ask questions using captured evidence from this purpose only"
              }
              onClick={() =>
                openGovernanceWorkspace({
                  origin: "collector-purpose",
                  collectorPurposeId: activePurpose.id,
                  collectorPurposeTitle: activePurpose.title,
                  title: activePurpose.title,
                  question: activePurpose.researchQuestion,
                  sourceScope: "all",
                })
              }
            >
              Ask in Governance Workspace
            </button>
          </div>
        )}
      </section>

      {(tagSummary && (tagSummary.inProgress > 0 || tagSummary.failed > 0)) ||
      snapshotHealth.missingCount > 0 ||
      snapshotHealth.staleCount > 0 ? (
        <div className="saved-urls-status-stack">
          {tagSummary &&
            (tagSummary.inProgress > 0 || tagSummary.failed > 0) && (
              <section
                className="saved-urls-status-card saved-urls-status-card--warning"
                aria-label="AI tagging queue status"
              >
                <div className="saved-urls-status-card__main">
                  <div className="saved-urls-status-card__headline">
                    <span className="saved-urls-status-card__dot" />
                    <div className="min-w-0">
                      <div className="saved-urls-status-card__title-row">
                        <h2 className="saved-urls-status-card__title">
                          AI tagging queue
                        </h2>
                        <span className="saved-urls-status-badge">
                          {tagSummary.queueMode === "sequential"
                            ? "Sequential"
                            : "Queue"}
                        </span>
                      </div>
                      <p className="saved-urls-status-card__copy">
                        {tagSummary.currentRunning ? (
                          <>
                            Processing{" "}
                            {shortQueueTitle(tagSummary.currentRunning, 72)}
                            {queueDomain(tagSummary.currentRunning)
                              ? ` from ${queueDomain(tagSummary.currentRunning)}`
                              : ""}
                          </>
                        ) : (
                          queueHealthLabel(tagSummary.queueHealth)
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="saved-urls-status-metrics">
                    <div className="saved-urls-status-metric">
                      <span>Pending</span>
                      <strong>{tagSummary.byStatus?.PENDING ?? 0}</strong>
                    </div>
                    <div className="saved-urls-status-metric">
                      <span>Running</span>
                      <strong>{tagSummary.byStatus?.RUNNING ?? 0}</strong>
                    </div>
                    <div className="saved-urls-status-metric saved-urls-status-metric--danger">
                      <span>Failed</span>
                      <strong>{tagSummary.failed}</strong>
                    </div>
                    {tagSummary.oldestPendingAt && (
                      <div className="saved-urls-status-metric">
                        <span>Oldest</span>
                        <strong>
                          {relativeQueueAge(tagSummary.oldestPendingAt)}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="saved-urls-status-card__actions">
                  {tagSummary.failed > 0 && (
                    <button
                      type="button"
                      className="saved-urls-status-action saved-urls-status-action--primary"
                      onClick={handleRetryFailedTagging}
                      disabled={tagSummaryLoading}
                      title="Re-run auto-tagging for failed URLs"
                    >
                      {tagSummaryLoading ? "Retrying..." : "Retry failed"}
                    </button>
                  )}

                  <details className="saved-urls-status-more">
                    <summary>More actions</summary>
                    <div className="saved-urls-status-more__panel">
                      <button
                        type="button"
                        className="saved-urls-status-action"
                        onClick={() => setActiveQueueId("ai-failed")}
                        disabled={tagSummary.failed === 0}
                      >
                        Show failed queue
                      </button>
                      <div className="saved-urls-status-more__note">
                        {queueHealthLabel(tagSummary.queueHealth)}
                        {(tagSummary.nextPending?.length ?? 0) > 0
                          ? ` · ${tagSummary.nextPending?.length} next`
                          : ""}
                        {tagSummaryError ? ` · ${tagSummaryError}` : ""}
                      </div>
                    </div>
                  </details>
                </div>
              </section>
            )}

          {(snapshotHealth.missingCount > 0 ||
            snapshotHealth.staleCount > 0) && (
            <section
              className="saved-urls-status-card saved-urls-status-card--info"
              aria-label="Snapshot coverage status"
            >
              <div className="saved-urls-status-card__main">
                <div className="saved-urls-status-card__headline">
                  <span className="saved-urls-status-card__dot" />
                  <div className="min-w-0">
                    <div className="saved-urls-status-card__title-row">
                      <h2 className="saved-urls-status-card__title">
                        Snapshot coverage
                      </h2>
                      <span className="saved-urls-status-badge">
                        Current page
                      </span>
                    </div>
                    <p className="saved-urls-status-card__copy">
                      Keep source captures evidence-ready before review,
                      Notebook use, or governance tracing.
                    </p>
                  </div>
                </div>

                <div className="saved-urls-status-metrics">
                  <div className="saved-urls-status-metric saved-urls-status-metric--warning">
                    <span>Missing</span>
                    <strong>{snapshotHealth.missingCount}</strong>
                  </div>
                  <div className="saved-urls-status-metric">
                    <span>Stale</span>
                    <strong>{snapshotHealth.staleCount}</strong>
                  </div>
                  {captureOperationLive && (
                    <div className="saved-urls-status-metric">
                      <span>Operation</span>
                      <strong>Active</strong>
                    </div>
                  )}
                </div>
              </div>

              <div className="saved-urls-status-card__actions">
                {snapshotPrimaryAction ? (
                  <button
                    type="button"
                    className="saved-urls-status-action saved-urls-status-action--primary"
                    onClick={() =>
                      openBulkSnapshotPicker(
                        snapshotPrimaryAction.targets,
                        snapshotPrimaryAction.mode,
                      )
                    }
                    disabled={captureOperationLive}
                    title={
                      captureOperationLive
                        ? "A capture operation is already running. Use Operations to cancel or retry."
                        : snapshotPrimaryAction.title
                    }
                  >
                    {snapshotPrimaryAction.label}
                  </button>
                ) : null}

                <details className="saved-urls-status-more">
                  <summary>More actions</summary>
                  <div className="saved-urls-status-more__panel">
                    <button
                      type="button"
                      className="saved-urls-status-action"
                      onClick={() =>
                        setFilter((f: any) => ({
                          ...f,
                          snapshotStatus: "missing",
                        }))
                      }
                      title="Filter the full result set to URLs with no active snapshots"
                    >
                      Show missing
                    </button>

                    <button
                      type="button"
                      className="saved-urls-status-action"
                      onClick={() =>
                        setFilter((f: any) => ({
                          ...f,
                          snapshotStatus: "stale",
                        }))
                      }
                      title={`Filter the full result set to URLs with snapshots older than ${SNAPSHOT_STALE_DAYS} days`}
                    >
                      Show stale
                    </button>

                    {snapshotHealth.missingCount > 0 && (
                      <>
                        <button
                          type="button"
                          className="saved-urls-status-action"
                          onClick={() =>
                            openBulkSnapshotPicker(snapshotHealth.missing, "pdf")
                          }
                          disabled={captureOperationLive}
                          title="Capture PDF snapshots for missing URLs currently loaded on this page"
                        >
                          Capture missing PDF
                        </button>
                        <button
                          type="button"
                          className="saved-urls-status-action"
                          onClick={() =>
                            openBulkSnapshotPicker(snapshotHealth.missing, "text")
                          }
                          disabled={captureOperationLive}
                          title="Capture text snapshots for missing URLs currently loaded on this page"
                        >
                          Capture missing text
                        </button>
                      </>
                    )}

                    {snapshotHealth.staleCount > 0 && (
                      <>
                        <button
                          type="button"
                          className="saved-urls-status-action"
                          onClick={() =>
                            openBulkSnapshotPicker(snapshotHealth.stale, "text")
                          }
                          disabled={captureOperationLive}
                          title="Refresh text snapshots for stale URLs currently loaded on this page"
                        >
                          Refresh stale text
                        </button>
                        <button
                          type="button"
                          className="saved-urls-status-action"
                          onClick={() =>
                            openBulkSnapshotPicker(snapshotHealth.stale, "pdf")
                          }
                          disabled={captureOperationLive}
                          title="Refresh PDF snapshots for stale URLs currently loaded on this page"
                        >
                          Refresh stale PDF
                        </button>
                      </>
                    )}
                  </div>
                </details>
              </div>
            </section>
          )}
        </div>
      ) : null}

      <SavedUrlsOperationsPanel
        operations={savedUrlOperations.data?.items ?? []}
        loading={savedUrlOperations.isLoading}
        onCancel={(id) => {
          savedUrlOperations.cancelOperation.mutate(id, {
            onSuccess: () => {
              notify({ text: "Operation cancellation requested.", kind: "info" });
              void refreshRowsAndQueueSummary();
            },
            onError: (e: any) =>
              notify({
                text: e?.message ?? "Could not cancel operation.",
                kind: "error",
              }),
          });
        }}
        onRetryFailed={(id) => {
          savedUrlOperations.retryFailedOperation.mutate(id, {
            onSuccess: () => {
              notify({ text: "Queued retry for failed operation items.", kind: "success" });
            },
            onError: (e: any) =>
              notify({
                text: e?.message ?? "Could not retry failed items.",
                kind: "error",
              }),
          });
        }}
      />

      <div className="saved-urls-panel saved-urls-command-center p-4 sm:p-5">
        <div className="saved-urls-command-head">
          <div className="min-w-0">
            <p className="page-header-kicker">Review operations</p>
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-100">
              Review command center
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">
              Pick the work queue, save repeatable review slices, and keep the
              current page state under control.
            </p>
          </div>

          <div className="saved-urls-command-actions">
            <span className="page-header-pill">
              <span className="page-header-pill-label">State</span>
              <span className="page-header-pill-value">
                {savedSearchStateLabel}
              </span>
            </span>

            <button
              type="button"
              className="saved-urls-command-button"
              onClick={markVisibleReviewed}
              disabled={sorted.length === 0}
              title="Mark every visible row on this page as reviewed right now"
            >
              Mark visible reviewed
            </button>

            <button
              type="button"
              className="saved-urls-command-button"
              onClick={resetReviewView}
              disabled={!hasActiveReviewView}
              title="Reset filters, selected collection, queue, saved-search context, year, and sort"
            >
              Reset review view
            </button>

            <button
              type="button"
              className="saved-urls-command-button saved-urls-command-button--primary"
              onClick={saveCurrentSearch}
              title="Save the current filter, sort, collection, and queue state"
            >
              Save current search
            </button>

            {displayedSavedSearch && (
              <button
                type="button"
                className="saved-urls-command-button saved-urls-command-button--danger"
                onClick={deleteActiveSavedSearch}
                title="Delete the active saved search"
              >
                Delete saved search
              </button>
            )}
          </div>
        </div>

        <div
          className="saved-urls-queue-row"
          role="group"
          aria-label="Saved URL review queues"
        >
          {[...reviewQueues, localReviewQueue].map((queue) => {
            const active = activeQueueId === queue.id;
            return (
              <button
                key={queue.id}
                type="button"
                onClick={() => setActiveQueueId(queue.id)}
                title={queue.help}
                aria-pressed={active}
                className={[
                  "saved-urls-queue-chip",
                  reviewQueueToneClass(queue.id, active),
                ].join(" ")}
              >
                <span className="saved-urls-queue-label">
                  {queue.label}
                  {queue.id === "updated-since-review" && (
                    <span className="saved-urls-queue-local">Server</span>
                  )}
                </span>
                <span className="saved-urls-queue-count">{queue.count}</span>
              </button>
            );
          })}
        </div>

        {activeReviewQueue && (
          <div className="saved-urls-active-queue-note">
            <span className="font-medium">{activeReviewQueue.label}:</span>{" "}
            {activeReviewQueue.help}
          </div>
        )}

        {savedSearches.length > 0 && (
          <div className="saved-urls-saved-searches">
            <div className="saved-urls-saved-searches-label">
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
                      "saved-urls-saved-search",
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

                  <div
                    className="inline-flex self-start xl:self-auto items-center rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/70 p-1 shadow-sm"
                    aria-label="Saved URLs view mode"
                  >
                    {canUseRegistryView && (
                      <button
                        type="button"
                        onClick={() => setViewMode("registry")}
                        className={[
                          "rounded-lg px-3 py-2 text-sm font-medium transition",
                          effectiveViewMode === "registry"
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white",
                        ].join(" ")}
                        title="Show dense source registry table"
                        aria-pressed={effectiveViewMode === "registry"}
                      >
                        Registry
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setViewMode("cards")}
                      className={[
                        "rounded-lg px-3 py-2 text-sm font-medium transition",
                        effectiveViewMode === "cards"
                          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                          : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white",
                      ].join(" ")}
                      title="Show card layout"
                      aria-pressed={effectiveViewMode === "cards"}
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
              <div className="relative z-10">
                <BulkActionBar
                  className="saved-urls-bulk-action-bar"
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
                  moveToTitle="Assign selected rows to a collection"
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
                      ? `Paste into "${selectedCollection.name}"`
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
              <SavedUrlsEmptyState
                libraryTotalCount={libraryTotalCount}
                isReviewQueueActive={isReviewQueueActive}
              />
            )}

            {!loading && !error && totalResults > 0 && (
              <SavedUrlsPagination
                isReviewQueueActive={isReviewQueueActive}
                page={page}
                pageSize={PAGE_SIZE}
                totalPages={totalPages}
                totalResults={totalResults}
                visibleCount={sorted.length}
                onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
            )}

            {/* Registry / Cards */}
            {effectiveViewMode === "registry" ? (
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
              <StaggerList className="saved-urls-card-grid grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6">
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

            <PdfDiscoveryDrawer
              open={!!pdfDiscoveryTarget}
              sourceUrlId={
                pdfDiscoveryTarget ? Number(pdfDiscoveryTarget.id) : null
              }
              sourceUrl={pdfDiscoveryTarget?.url ?? ""}
              sourceTitle={pdfDiscoveryTarget?.title ?? ""}
              autoDiscover
              onClose={() => setPdfDiscoveryTarget(null)}
              onAfterCapture={async () => {
                await refreshUrlsFromServer();
                await refreshRowsAndFacetsAndQueue();
                setDetailCaptureRefreshKey((key) => key + 1);
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
