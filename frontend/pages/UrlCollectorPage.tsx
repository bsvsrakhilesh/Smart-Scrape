import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import SearchForm from "../components/urlcollector/SearchForm";
import ResultsTable from "../components/urlcollector/ResultsTable";
import Spinner from "../components/urlcollector/Spinner";
import { SearchResult } from "../lib/types";
import {
  createCollectorPurpose,
  deleteCollectorPurpose,
  listCollectorPurposes,
  planPurposeSearch,
  planCollectorQuery,
  rerankSearchResults,
  searchWeb,
  type CollectorAuthoritySource,
  type CollectorPurpose,
  type CollectorPurposeLane,
  type SearchWebOptions,
} from "../lib/api";
import { useLocation, useNavigate } from "react-router-dom";
import SmartCard from "../components/ui/SmartCard";
import CollectorJobConsole from "../components/urlcollector/CollectorJobConsole";
import { useCollectorJobs } from "../hooks/useCollectorJobs";
import {
  buildCollectorSearchQuery,
  formatAppliedCollectorSearchPlan,
  mergeCollectorSearchResults,
  normalizeCollectorKeywords,
  normalizeCollectorWebsite,
} from "../utils/urlCollector";
import {
  summarizeCollectorAuthorityCoverage,
  type CollectorAuthorityCoverageRow,
} from "../utils/collectorAuthorityCoverage";
import { useConfirm } from "../components/providers/Confirm";
import { useToast } from "../components/providers/Toast";

const LS_KEY = "uc:v1";

// UX targets
const RESULTS_PER_PAGE = 10;
const INITIAL_RESULTS_TARGET = 50; // fetch up to this many automatically on a single Search

// Rate-limit hardening
const RATE_LIMIT_COOLDOWN_MS = 60_000; // match backend window
const PREFETCH_DELAY_MS = 650; // small pacing to avoid bursty requests

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortLike(error: any) {
  return (
    error?.name === "AbortError" ||
    error?.name === "CanceledError" ||
    error?.code === "ERR_CANCELED"
  );
}

function userSearchErrorMessage(error: any, fallback: string) {
  const msg = typeof error?.message === "string" ? error.message : fallback;
  return msg.includes("Failed to fetch") || msg.includes("Network Error")
    ? "Network error. Is your server running and reachable?"
    : msg;
}

type SortKey = "original" | "title" | "domain" | "year";

// Collector "scope" filters. These are sent as structured backend params so
// the keyword query stays clean and filters have a single source of truth.
type CollectorScope = {
  yearFrom: string; // YYYY
  yearTo: string; // YYYY
  jurisdiction: string; // free text (e.g. IN / India / California)
  region: string; // free text (e.g. Delhi / EU / South Asia)
  format: "any" | "pdfOnly" | "excludePdf";
};

type PersistShape = {
  website: string;
  keywords: string;
  activePurposeId?: string;
  scope?: CollectorScope;

  results?: SearchResult[];
  selected: string[]; // persist Set<string> as array
  sortKey?: SortKey;
  lastRunAt?: string;

  lastQuery?: string;
  lastSearchOpts?: SearchWebOptions;
  nextPage?: number | null;
  totalResults?: number | null;
};

function normalizePersistScope(scope?: Partial<CollectorScope>): CollectorScope {
  return {
    yearFrom: toYYYY(scope?.yearFrom ?? ""),
    yearTo: toYYYY(scope?.yearTo ?? ""),
    jurisdiction: String(scope?.jurisdiction ?? "").trim(),
    region: String(scope?.region ?? "").trim(),
    format:
      scope?.format === "pdfOnly" || scope?.format === "excludePdf"
        ? scope.format
        : "any",
  };
}

function sameCollectorRefreshState(
  persisted: PersistShape,
  current: {
    website: string;
    keywords: string;
    scope: CollectorScope;
    activePurposeId: string;
    hasUrlSearchParams: boolean;
  },
) {
  if (current.activePurposeId && persisted.activePurposeId !== current.activePurposeId) {
    return false;
  }

  if (!current.hasUrlSearchParams) return true;

  const persistedScope = normalizePersistScope(persisted.scope);
  const currentScope = normalizePersistScope(current.scope);

  return (
    normalizeCollectorWebsite(persisted.website) ===
      normalizeCollectorWebsite(current.website) &&
    normalizeCollectorKeywords(persisted.keywords) ===
      normalizeCollectorKeywords(current.keywords) &&
    persistedScope.yearFrom === currentScope.yearFrom &&
    persistedScope.yearTo === currentScope.yearTo &&
    persistedScope.jurisdiction === currentScope.jurisdiction &&
    persistedScope.region === currentScope.region &&
    persistedScope.format === currentScope.format
  );
}

function toYYYY(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  // allow user to type 2024, or 2024-xx (we’ll take first 4 digits)
  const m = t.match(/^(\d{4})/);
  return m ? m[1] : "";
}

function splitPurposeList(value: string): string[] {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

const UrlCollectorPage: React.FC = () => {
  // ---------- Persistence guardrails (avoid localStorage quota issues) ----------
  const MAX_PERSIST_RESULTS = 100; // cap stored results
  const MAX_PERSIST_SNIPPET = 240; // trim large snippets

  function minifyResults(rows: SearchResult[]): SearchResult[] {
    return rows.slice(0, MAX_PERSIST_RESULTS).map((r) => ({
      ...r,
      // keep UI useful but prevent huge payloads
      title: (r.title ?? "").slice(0, 300),
      snippet: (r.snippet ?? "").slice(0, MAX_PERSIST_SNIPPET),
    }));
  }

  function safeLocalStorageSet(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  const navigate = useNavigate();
  const loc = useLocation();
  const { confirm } = useConfirm();
  const { notify } = useToast();
  const params = new URLSearchParams(loc.search);
  const {
    jobs: collectorJobs,
    actions: collectorJobActions,
  } = useCollectorJobs();
  const searchRetryRef = useRef<(site?: string, keywords?: string) => void>(
    () => {},
  );
  const loadMoreRetryRef = useRef<() => void>(() => {});
  const persistHydratedRef = useRef(false);

  const urlSite = params.get("site") ?? "";
  const urlKeywords = params.get("q") ?? "";

  // Optional filter params (shareable links)
  const urlYearFrom = params.get("yearFrom") ?? "";
  const urlYearTo = params.get("yearTo") ?? "";
  const urlJurisdiction = params.get("jurisdiction") ?? "";
  const urlRegion = params.get("region") ?? "";
  const urlFormat = (params.get("format") ?? "any") as CollectorScope["format"];
  const urlPurposeId = params.get("purposeId") ?? "";

  const hasUrlParams =
    !!urlSite ||
    !!urlKeywords ||
    !!urlYearFrom ||
    !!urlYearTo ||
    !!urlJurisdiction ||
    !!urlRegion ||
    (urlFormat && urlFormat !== "any");
  const hasUrlSearchParams = hasUrlParams;

  const [website, setWebsite] = useState(urlSite);
  const [keywords, setKeywords] = useState(urlKeywords);
  const [purposes, setPurposes] = useState<CollectorPurpose[]>([]);
  const [activePurposeId, setActivePurposeId] = useState(urlPurposeId);
  const [purposeBusy, setPurposeBusy] = useState(false);
  const [purposeDeleting, setPurposeDeleting] = useState(false);
  const [purposeLanes, setPurposeLanes] = useState<CollectorPurposeLane[]>([]);
  const [activeLaneKey, setActiveLaneKey] = useState("");
  const [collectorSearchId, setCollectorSearchId] = useState<string | null>(null);
  const [purposeDraft, setPurposeDraft] = useState({
    title: "",
    researchQuestion: "",
    jurisdiction: "",
    region: "",
    outputGoal: "",
    sourcePreferences: "",
    targetActors: "",
  });
  const [purposeMenuOpen, setPurposeMenuOpen] = useState(false);
  const purposeSelectRef = useRef<HTMLDivElement>(null);
  const activePurpose = purposes.find((purpose) => purpose.id === activePurposeId) ?? null;

  useEffect(() => {
    let live = true;
    void listCollectorPurposes()
      .then((rows) => {
        if (live) setPurposes(rows);
      })
      .catch((reason) => {
        if (live) setError(reason?.message ?? "Could not load research purposes.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!purposeMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!purposeSelectRef.current?.contains(event.target as Node)) {
        setPurposeMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPurposeMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [purposeMenuOpen]);

  const [scope, setScope] = useState<CollectorScope>({
    yearFrom: urlYearFrom,
    yearTo: urlYearTo,
    jurisdiction: urlJurisdiction,
    region: urlRegion,
    format: urlFormat,
  });

  const hasActiveScopeFilters =
    !!scope.yearFrom ||
    !!scope.yearTo ||
    !!scope.jurisdiction.trim() ||
    !!scope.region.trim() ||
    scope.format !== "any";

  const [isLoading, setIsLoading] = useState(false);
  const [aiAssistLoading, setAiAssistLoading] = useState(false);
  const [isRecoveringSources, setIsRecoveringSources] = useState(false);
  const [aiAssistRationale, setAiAssistRationale] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");
  const [lastSearchOpts, setLastSearchOpts] = useState<SearchWebOptions | null>(
    null,
  );

  // Auto-prefetch progress (so the UI can say "Loading 30/50 results…")
  const [prefetchCount, setPrefetchCount] = useState<number>(0);

  const [isReranking, setIsReranking] = useState(false);
  const [aiRerankedCount, setAiRerankedCount] = useState(0);

  // Selection must be Set<string> for ResultsTable
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // Page-level controlled sort (passed to ResultsTable)
  const [sortKey, setSortKey] = useState<SortKey>("original");

  const authorityCoverageSummary = useMemo(
    () =>
      summarizeCollectorAuthorityCoverage(
        activePurpose?.authoritySources ?? [],
        searchResults,
      ),
    [activePurpose?.authoritySources, searchResults],
  );
  const authorityCoverage = authorityCoverageSummary.coverage;
  const missingAuthorityCount = authorityCoverageSummary.missingCount;
  const criticalMissingAuthorityCount = authorityCoverageSummary.criticalMissingCount;
  const authorityCoverageScore = authorityCoverageSummary.score;
  const authorityCoverageRisk = authorityCoverageSummary.risk;
  const authorityCoverageRiskLabel = authorityCoverageSummary.riskLabel;
  const missingAuthoritySources = authorityCoverageSummary.missingSources;
  const evidenceRoleCoverage = authorityCoverageSummary.roleCoverage;
  const missingEvidenceRoles = authorityCoverageSummary.missingRoles;

  // Abort in-flight searches when a new one starts
  const fetchAbortRef = useRef<AbortController | null>(null);
  const resultsRequestEpochRef = useRef(0);
  // After a 429, we pause further search calls for a short cooldown
  const rateLimitUntilRef = useRef<number>(0);

  // Abort any in-flight requests when leaving the page
  useEffect(() => {
    return () => {
      try {
        fetchAbortRef.current?.abort();
      } catch {}
    };
  }, []);

  // Scroll target for the results section
  const resultsSectionRef = useRef<HTMLElement | null>(null);

  const clearSearchOutcome = useCallback(() => {
    resultsRequestEpochRef.current += 1;
    fetchAbortRef.current?.abort();
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setIsLoading(false);
    setIsLoadingMore(false);
    setIsReranking(false);
    setAiRerankedCount(0);
    setPrefetchCount(0);
    setNextPage(null);
    setTotalResults(null);
    setCollectorSearchId(null);
    setLastQuery("");
    setLastSearchOpts(null);
  }, []);

  type AuthoritySearchSource = CollectorAuthoritySource | CollectorAuthorityCoverageRow;

  /* ---------- Restore persisted state ---------- */
  useEffect(() => {
    if (persistHydratedRef.current) return;

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        persistHydratedRef.current = true;
        return;
      }
      const p = JSON.parse(raw) as PersistShape;
      const restoredScope = normalizePersistScope(p.scope);
      const urlScope = normalizePersistScope({
        yearFrom: urlYearFrom,
        yearTo: urlYearTo,
        jurisdiction: urlJurisdiction,
        region: urlRegion,
        format: urlFormat,
      });
      const cacheMatchesRefresh = sameCollectorRefreshState(p, {
        website: urlSite,
        keywords: urlKeywords,
        scope: urlScope,
        activePurposeId: urlPurposeId,
        hasUrlSearchParams,
      });

      if (!hasUrlSearchParams) {
        if (p.website) setWebsite(p.website);
        if (p.keywords) setKeywords(p.keywords);
        if (p.activePurposeId && !urlPurposeId) setActivePurposeId(p.activePurposeId);
        if (p.scope) setScope((prev) => ({ ...prev, ...restoredScope }));
      }

      if (cacheMatchesRefresh) {
        if (p.results) setSearchResults(p.results);
        if (p.selected) setSelectedUrls(new Set(p.selected));
        if (p.sortKey) setSortKey(p.sortKey);
        if (typeof p.lastQuery === "string") setLastQuery(p.lastQuery);
        if (p.lastSearchOpts && typeof p.lastSearchOpts === "object") {
          setLastSearchOpts(p.lastSearchOpts);
        }
        if (typeof p.nextPage !== "undefined") setNextPage(p.nextPage ?? null);
        if (typeof p.totalResults !== "undefined")
          setTotalResults(p.totalResults ?? null);
        if ((p.results && p.results.length > 0) || p.lastRunAt) {
          setHasSearched(true);
        }
      }
    } catch {
      /* ignore */
    } finally {
      persistHydratedRef.current = true;
    }
  }, [
    hasUrlSearchParams,
    urlFormat,
    urlJurisdiction,
    urlKeywords,
    urlPurposeId,
    urlRegion,
    urlSite,
    urlYearFrom,
    urlYearTo,
  ]);

  /* ---------- Persist state (quota-safe) ---------- */
  useEffect(() => {
    if (!persistHydratedRef.current) return undefined;

    // store capped + minified results for a good UX on refresh
    const full: PersistShape = {
      website,
      keywords,
      activePurposeId,
      scope,
      results: minifyResults(searchResults),
      selected: Array.from(selectedUrls),
      sortKey,
      lastRunAt: hasSearched ? new Date().toISOString() : undefined,
      lastQuery,
      lastSearchOpts: lastSearchOpts ?? undefined,
      nextPage,
      totalResults,
    };

    // Fallback: if quota exceeded, store everything except results
    const noResults: PersistShape = {
      website,
      keywords,
      activePurposeId,
      scope,
      selected: Array.from(selectedUrls),
      sortKey,
      lastRunAt: hasSearched ? new Date().toISOString() : undefined,
      lastQuery,
      lastSearchOpts: lastSearchOpts ?? undefined,
      nextPage,
      totalResults,
    };

    // Minimal fallback: just restore the user’s inputs and sort
    const minimal: PersistShape = {
      website,
      keywords,
      activePurposeId,
      scope,
      selected: [],
      sortKey,
      lastRunAt: hasSearched ? new Date().toISOString() : undefined,
    };

    const timer = window.setTimeout(() => {
      if (safeLocalStorageSet(LS_KEY, full)) return;
      if (safeLocalStorageSet(LS_KEY, noResults)) return;
      safeLocalStorageSet(LS_KEY, minimal);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    activePurposeId,
    website,
    keywords,
    scope,
    searchResults,
    selectedUrls,
    sortKey,
    hasSearched,
    lastQuery,
    lastSearchOpts,
    nextPage,
    totalResults,
  ]);

  /* ---------- Global shortcuts (without touching SearchForm.tsx) ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const metaK = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey);
      const isSlash = e.key === "/";
      if (metaK || isSlash) {
        e.preventDefault();
        (
          document.getElementById("sf-keywords") as HTMLInputElement | null
        )?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function syncUrl(site: string, kws: string, sc: CollectorScope) {
    const sp = new URLSearchParams();
    if (site) sp.set("site", site);
    if (kws) sp.set("q", kws);

    const yFrom = toYYYY(sc.yearFrom);
    const yTo = toYYYY(sc.yearTo);
    if (yFrom) sp.set("yearFrom", yFrom);
    if (yTo) sp.set("yearTo", yTo);
    if (sc.jurisdiction.trim()) sp.set("jurisdiction", sc.jurisdiction.trim());
    if (sc.region.trim()) sp.set("region", sc.region.trim());
    if (sc.format !== "any") sp.set("format", sc.format);
    if (activePurposeId) sp.set("purposeId", activePurposeId);

    navigate(
      { search: sp.toString() ? `?${sp.toString()}` : "" },
      { replace: true },
    );
  }

  function buildSearchOpts(site: string, sc: CollectorScope): SearchWebOptions {
    const yFrom = toYYYY(sc.yearFrom);
    const yTo = toYYYY(sc.yearTo);

    return {
      site: site.trim() || undefined,
      yearFrom: yFrom ? Number(yFrom) : undefined,
      yearTo: yTo ? Number(yTo) : undefined,
      jurisdiction: sc.jurisdiction.trim() || undefined,
      region: sc.region.trim() || undefined,
      fileType:
        sc.format === "pdfOnly" ? "pdf" : undefined,
      excludeFileType: sc.format === "excludePdf" ? "pdf" : undefined,
      collectorPurposeId: activePurposeId || undefined,
      laneKey: activeLaneKey || undefined,
    };
  }

  const applyMergedRerank = useCallback(
    async (
      query: string,
      rows: SearchResult[],
      opts?: SearchWebOptions,
      signal?: AbortSignal,
    ) => {
      if (!rows.length) {
        setAiRerankedCount(0);
        return rows;
      }

      if (rows.length === 1) {
        setAiRerankedCount(0);
        return rows;
      }

      setIsReranking(true);

      try {
        const reranked = await rerankSearchResults(
          {
            q: query,
            results: rows,
            opts,
          },
          signal,
        );

        const finalRows =
          Array.isArray(reranked) && reranked.length ? reranked : rows;

        const rankedCount = finalRows.filter(
          (r) => r.ranking && Number.isFinite(r.ranking.score),
        ).length;

        setAiRerankedCount(rankedCount);
        return finalRows;
      } catch (e: any) {
        if (e?.code === "ERR_CANCELED" || e?.name === "AbortError") {
          return rows;
        }

        console.warn("AI rerank failed; keeping current order.", e);
        setAiRerankedCount(0);
        return rows;
      } finally {
        setIsReranking(false);
      }
    },
    [],
  );

  /* ---------- Search handler (working fetch + abort) ---------- */
  const handleSearch = useCallback(
    async (siteArg?: string, kwArg?: string, scopeArg?: CollectorScope) => {
      if (!activePurpose) {
        clearSearchOutcome();
        setError("Select or create a purpose before searching.");
        return;
      }
      const site = (siteArg ?? website).trim();
      const kws = normalizeCollectorKeywords(kwArg ?? keywords);
      const effectiveScope = scopeArg ?? scope;

      const yFrom = toYYYY(effectiveScope.yearFrom);
      const yTo = toYYYY(effectiveScope.yearTo);
      if (yFrom && yTo && Number(yFrom) > Number(yTo)) {
        clearSearchOutcome();
        setError("Year from must be ≤ Year to.");
        return;
      }

      const now = Date.now();
      if (now < rateLimitUntilRef.current) {
        clearSearchOutcome();
        const secs = Math.ceil((rateLimitUntilRef.current - now) / 1000);
        setError(`Rate limit hit. Please wait ${secs}s and try again.`);
        return;
      }

      if (!site && !kws) {
        clearSearchOutcome();
        setError("Enter a website and/or keywords to search.");
        return;
      }

      const requestEpoch = ++resultsRequestEpochRef.current;
      const assertCurrentResultsRequest = () => {
        if (requestEpoch !== resultsRequestEpochRef.current) {
          throw Object.assign(new Error("AbortError"), { name: "AbortError" });
        }
      };

      // Cancel any previous request
      try {
        fetchAbortRef.current?.abort();
      } catch {}
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      const jobLabel = [site || "Whole web", kws || "(site scan)"].join(" · ");
      const jobId = collectorJobActions.startJob({
        kind: "search",
        title: "Collector search",
        targetLabel: jobLabel,
        stage: "queued",
        message: "Preparing search",
        progressPct: 0,
        retryable: true,
        cancelable: true,
        onRetry: () => searchRetryRef.current(site, kws),
        onCancel: () => controller.abort(),
        meta: {
          site,
          keywords: kws,
          scope: effectiveScope,
        },
      });
      collectorJobActions.updateJob(jobId, {
        status: "running",
        stage: "searching",
        message: "Fetching first page",
        progressPct: 6,
        startedAt: new Date().toISOString(),
      });

      setIsLoading(true);
      setError(null);
      setHasSearched(true);
      setAiRerankedCount(0);
      setCollectorSearchId(null);
      setSearchResults([]);
      setSelectedUrls(new Set());
      setNextPage(null);
      setTotalResults(null);

      // keep URL in sync (shareable)
      syncUrl(site, kws, effectiveScope);

      try {
        const q = buildCollectorSearchQuery(kws);
        const searchOpts = buildSearchOpts(site, effectiveScope);
        setLastSearchOpts(searchOpts);

        // Helper to fetch a specific page from the backend
        const fetchPage = async (page: number) => {
          return await searchWeb(q, page, controller.signal, searchOpts);
        };

        setLastQuery(q);
        setPrefetchCount(0);

        // Fetch page 1 immediately
        const p1 = await fetchPage(1);
        assertCurrentResultsRequest();
        setCollectorSearchId(p1.collectorSearchId);
        collectorJobActions.updateJob(jobId, {
          stage: "page-1",
          message: `Loaded first ${p1.rows.length} result${p1.rows.length === 1 ? "" : "s"}`,
          progressPct: 22,
        });
        const initialMerge = mergeCollectorSearchResults([], p1.rows, {
          limit: INITIAL_RESULTS_TARGET,
        });
        let merged = initialMerge.rows;

        setSearchResults(merged);
        setSelectedUrls(new Set());
        setNextPage(p1.nextPage);
        setTotalResults(p1.totalResults);
        setPrefetchCount(merged.length);

        // Scroll the results into view once we have something to show
        requestAnimationFrame(() => {
          resultsSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });

        if (p1.rows.length === 0) {
          setError(
            "No results found. Try different keywords, widen filters, or remove the site filter.",
          );
          collectorJobActions.succeedJob(jobId, "Search completed with no results", {
            stage: "empty",
            progressPct: 100,
          });
          return;
        }

        // Auto-prefetch up to 50 results (5 pages x 10 results)
        let np = p1.nextPage;
        const maxPages = Math.ceil(INITIAL_RESULTS_TARGET / RESULTS_PER_PAGE);
        let pagesFetched = 1;

        while (
          !controller.signal.aborted &&
          np &&
          merged.length < INITIAL_RESULTS_TARGET &&
          pagesFetched < maxPages
        ) {
          // Pace requests to avoid bursty 429s
          await sleep(PREFETCH_DELAY_MS, controller.signal);
          assertCurrentResultsRequest();
          collectorJobActions.updateJob(jobId, {
            stage: `page-${np}`,
            message: `Fetching page ${np}`,
            progressPct: Math.min(
              68,
              22 + Math.round((pagesFetched / maxPages) * 42),
            ),
          });

          let pn;
          try {
            pn = await fetchPage(np);
            assertCurrentResultsRequest();
          } catch (e: any) {
            if (e?.message === "RATE_LIMITED") {
              rateLimitUntilRef.current = Date.now() + RATE_LIMIT_COOLDOWN_MS;
              setError(
                `Rate limit reached. Showing the first ${merged.length} results. Try again in ~60s.`,
              );
              collectorJobActions.updateJob(jobId, {
                stage: "rate-limited",
                message: `Rate limited after ${merged.length} results`,
                progressPct: 72,
              });
              break; // stop auto-prefetch, keep what we already have
            }
            throw e;
          }

          pagesFetched += 1;

          merged = mergeCollectorSearchResults(merged, pn.rows, {
            limit: INITIAL_RESULTS_TARGET,
          }).rows;

          setSearchResults([...merged]);
          setPrefetchCount(merged.length);
          collectorJobActions.updateJob(jobId, {
            stage: `loaded-${merged.length}`,
            message: `Loaded ${merged.length}/${INITIAL_RESULTS_TARGET} target results`,
            progressPct: Math.min(
              72,
              30 + Math.round((merged.length / INITIAL_RESULTS_TARGET) * 40),
            ),
          });
          setNextPage(pn.nextPage);
          if (typeof pn.totalResults === "number")
            setTotalResults(pn.totalResults);
          np = pn.nextPage;

          // If a page returns no rows, stop trying.
          if (pn.rows.length === 0) break;
        }

        if (!controller.signal.aborted && merged.length > 1) {
          collectorJobActions.updateJob(jobId, {
            stage: "reranking",
            message: "AI reranking loaded results",
            progressPct: 82,
          });
          const reranked = await applyMergedRerank(
            q,
            merged,
            searchOpts,
            controller.signal,
          );

          assertCurrentResultsRequest();
          if (!controller.signal.aborted) {
            setSearchResults(reranked);
          }
        }
        if (!controller.signal.aborted) {
          collectorJobActions.succeedJob(
            jobId,
            `Loaded ${merged.length} result${merged.length === 1 ? "" : "s"}`,
            {
              meta: {
                site,
                keywords: kws,
                totalResults: totalResults ?? undefined,
              },
            },
          );
        }
      } catch (e: any) {
        if (isAbortLike(e)) {
          collectorJobActions.cancelJob(jobId, "Search canceled");
        } else {
          if (e?.message === "RATE_LIMITED") {
            rateLimitUntilRef.current = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            setError(
              "Too many searches too quickly. Please wait ~60 seconds and try again.",
            );
            collectorJobActions.failJob(jobId, "Rate limit reached", {
              stage: "rate-limited",
              message: "Too many searches too quickly",
            });
          } else {
            const msg = userSearchErrorMessage(e, "Search failed");
            setError(msg);
            collectorJobActions.failJob(jobId, msg);
          }
        }
      } finally {
        if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
        setIsLoading(false);
        setPrefetchCount(0);
      }
    },
    [
      navigate,
      website,
      keywords,
      scope,
      collectorJobActions,
      applyMergedRerank,
      activePurpose,
      activePurposeId,
      activeLaneKey,
    ],
  );

  useEffect(() => {
    searchRetryRef.current = (siteArg?: string, kwArg?: string) => {
      void handleSearch(siteArg, kwArg);
    };
  }, [handleSearch]);

  const buildAuthorityKeywords = useCallback(
    (source: AuthoritySearchSource) => {
      const queryHints =
        "queryHints" in source ? source.queryHints.slice(0, 4).join(" | ") : "";
      const documentTerms =
        "documentTerms" in source ? source.documentTerms.slice(0, 4).join(" | ") : "";

      return [
        activePurpose?.researchQuestion ?? "",
        source.label,
        source.domain,
        source.evidenceRole,
        queryHints,
        documentTerms,
        "official source",
      ]
        .filter(Boolean)
        .join(", ");
    },
    [activePurpose?.researchQuestion],
  );

  const searchAuthoritySource = useCallback(
    (source: AuthoritySearchSource) => {
      const nextKeywords = buildAuthorityKeywords(source);
      const nextScope: CollectorScope = { ...scope, format: "pdfOnly" };
      setWebsite(source.domain);
      setKeywords(nextKeywords);
      setScope(nextScope);
      setActiveLaneKey("");
      void handleSearch(source.domain, nextKeywords, nextScope);
    },
    [buildAuthorityKeywords, handleSearch, scope],
  );

  const recoverMissingAuthoritySources = useCallback(async () => {
    const targets = missingAuthoritySources.slice(0, 3);
    if (!activePurpose || targets.length === 0) return;

    const now = Date.now();
    if (now < rateLimitUntilRef.current) {
      const secs = Math.ceil((rateLimitUntilRef.current - now) / 1000);
      setError(`Rate limit hit. Please wait ${secs}s and try again.`);
      return;
    }

    try {
      fetchAbortRef.current?.abort();
    } catch {}
    const requestEpoch = ++resultsRequestEpochRef.current;
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const assertCurrentResultsRequest = () => {
      if (requestEpoch !== resultsRequestEpochRef.current) {
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });
      }
    };

    const jobId = collectorJobActions.startJob({
      kind: "search",
      title: "Official source recovery",
      targetLabel: targets.map((source) => source.label).join(", "),
      stage: "queued",
      message: `Preparing ${targets.length} missing source search${
        targets.length === 1 ? "" : "es"
      }`,
      progressPct: 0,
      retryable: true,
      cancelable: true,
      onRetry: () => void recoverMissingAuthoritySources(),
      onCancel: () => controller.abort(),
      meta: {
        sources: targets.map((source) => source.domain),
      },
    });

    setIsRecoveringSources(true);
    setError(null);

    try {
      let merged = searchResults;
      let added = 0;

      for (let index = 0; index < targets.length; index += 1) {
        const source = targets[index];
        const nextScope: CollectorScope = { ...scope, format: "pdfOnly" };
        const query = buildCollectorSearchQuery(buildAuthorityKeywords(source));
        const opts = {
          ...buildSearchOpts(source.domain, nextScope),
          laneKey: `recover-${source.key}`.slice(0, 40),
        };

        collectorJobActions.updateJob(jobId, {
          status: "running",
          stage: `source-${index + 1}`,
          message: `Searching ${source.domain}`,
          progressPct: Math.max(8, Math.round((index / targets.length) * 58)),
          startedAt: new Date().toISOString(),
        });

        const response = await searchWeb(query, 1, controller.signal, opts);
        assertCurrentResultsRequest();
        added += response.rows.length;
        merged = mergeCollectorSearchResults(merged, response.rows, {
          limit: INITIAL_RESULTS_TARGET,
        }).rows;
        setSearchResults([...merged]);
      }

      collectorJobActions.updateJob(jobId, {
        stage: "reranking",
        message: "Reranking recovered official-source results",
        progressPct: 82,
      });

      const reranked = await applyMergedRerank(
        lastQuery || activePurpose.researchQuestion,
        merged,
        lastSearchOpts ?? undefined,
        controller.signal,
      );
      assertCurrentResultsRequest();
      setSearchResults(reranked);
      setHasSearched(true);
      setSelectedUrls(new Set());
      setNextPage(null);

      collectorJobActions.succeedJob(
        jobId,
        added
          ? `Recovered ${added} official-source result${added === 1 ? "" : "s"}`
          : "No additional official-source results returned",
      );
    } catch (e: any) {
      if (isAbortLike(e)) {
        collectorJobActions.cancelJob(jobId, "Official source recovery canceled");
      } else if (e?.message === "RATE_LIMITED") {
        rateLimitUntilRef.current = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        setError(
          "Rate limit reached during official source recovery. Please wait ~60 seconds and try again.",
        );
        collectorJobActions.failJob(jobId, "Rate limit reached", {
          stage: "rate-limited",
        });
      } else {
        const msg = userSearchErrorMessage(e, "Official source recovery failed");
        setError(msg);
        collectorJobActions.failJob(jobId, msg);
      }
    } finally {
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
      setIsRecoveringSources(false);
    }
  }, [
    activePurpose,
    applyMergedRerank,
    buildAuthorityKeywords,
    collectorJobActions,
    lastQuery,
    lastSearchOpts,
    missingAuthoritySources,
    scope,
    searchResults,
  ]);

  const handleAiAssist = useCallback(
    async (draft: {
      website: string;
      keywords: string;
      scope: CollectorScope;
    }) => {
      setAiAssistLoading(true);
      setError(null);

      try {
        const plan = await planCollectorQuery({
          website: draft.website,
          keywords: draft.keywords,
          yearFrom: draft.scope.yearFrom,
          yearTo: draft.scope.yearTo,
          jurisdiction: draft.scope.jurisdiction,
          region: draft.scope.region,
          format: draft.scope.format,
        });

        setWebsite(plan.website || draft.website);
        setKeywords(plan.keywords || draft.keywords);
        setScope({
          yearFrom: plan.yearFrom || draft.scope.yearFrom,
          yearTo: plan.yearTo || draft.scope.yearTo,
          jurisdiction: plan.jurisdiction || draft.scope.jurisdiction,
          region: plan.region || draft.scope.region,
          format: plan.format || draft.scope.format,
        });
        setAiAssistRationale(
          plan.rationale || "AI assist updated the search plan.",
        );
        clearSearchOutcome();
      } catch (e: any) {
        setError(e?.message || "AI assist failed");
      } finally {
        setAiAssistLoading(false);
      }
    },
    [clearSearchOutcome],
  );

  const handleLoadMore = useCallback(async () => {
    if (!nextPage || !lastQuery) return;

    const requestEpoch = resultsRequestEpochRef.current;
    const assertCurrentResultsRequest = () => {
      if (requestEpoch !== resultsRequestEpochRef.current) {
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });
      }
    };
    const controller = new AbortController();
    const jobId = collectorJobActions.startJob({
      kind: "load_more",
      title: "Load more results",
      targetLabel: formatAppliedCollectorSearchPlan(
        lastQuery,
        lastSearchOpts,
      ),
      stage: "queued",
      message: `Preparing page ${nextPage}`,
      progressPct: 0,
      retryable: true,
      cancelable: true,
      onRetry: () => loadMoreRetryRef.current(),
      onCancel: () => controller.abort(),
    });

    setIsLoadingMore(true);
    setError(null);
    collectorJobActions.updateJob(jobId, {
      status: "running",
      stage: `page-${nextPage}`,
      message: `Fetching page ${nextPage}`,
      progressPct: 15,
      startedAt: new Date().toISOString(),
    });

    try {
      const {
        rows: newRows,
        nextPage: np,
        totalResults: tot,
      } = await searchWeb(
        lastQuery,
        nextPage,
        controller.signal,
        lastSearchOpts ?? undefined,
      );
      assertCurrentResultsRequest();

      collectorJobActions.updateJob(jobId, {
        stage: "merging",
        message: `Merging ${newRows.length} new result${newRows.length === 1 ? "" : "s"}`,
        progressPct: 52,
      });

      const merged = mergeCollectorSearchResults(searchResults, newRows).rows;

      setSearchResults(merged);

      collectorJobActions.updateJob(jobId, {
        stage: "reranking",
        message: "Reranking merged result set",
        progressPct: 78,
      });
      const reranked = await applyMergedRerank(
        lastQuery,
        merged,
        lastSearchOpts ?? undefined,
        controller.signal,
      );

      assertCurrentResultsRequest();
      if (controller.signal.aborted) {
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });
      }

      setSearchResults(reranked);

      setNextPage(np);
      setTotalResults(tot);

      if (newRows.length === 0) setNextPage(null);
      collectorJobActions.succeedJob(
        jobId,
        newRows.length
          ? `Loaded ${newRows.length} more result${newRows.length === 1 ? "" : "s"}`
          : "No additional results returned",
      );
    } catch (e: any) {
      if (isAbortLike(e)) {
        collectorJobActions.cancelJob(jobId, "Load more canceled");
      } else if (e?.message === "RATE_LIMITED") {
        rateLimitUntilRef.current = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        setError(
          "Rate limit reached. Please wait ~60 seconds, then try Load more again.",
        );
        collectorJobActions.failJob(jobId, "Rate limit reached", {
          stage: "rate-limited",
          message: "Try again after the cooldown",
        });
      } else {
        const msg = userSearchErrorMessage(e, "Load more failed");
        setError(msg);
        collectorJobActions.failJob(jobId, msg);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    nextPage,
    lastQuery,
    lastSearchOpts,
    searchResults,
    applyMergedRerank,
    collectorJobActions,
  ]);

  useEffect(() => {
    loadMoreRetryRef.current = () => {
      void handleLoadMore();
    };
  }, [handleLoadMore]);

  /* ---------- Selection handlers ---------- */
  const onToggleRow = useCallback((url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  const onTogglePage = useCallback((urls: string[], select: boolean) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      for (const u of urls) {
        if (select) next.add(u);
        else next.delete(u);
      }
      return next;
    });
  }, []);

  const onClearSelection = useCallback(() => {
    setSelectedUrls(new Set());
  }, []);

  // Clears only results and selection — keeps website, keywords, and scope
  // intact so the researcher can tweak the query and re-run without retyping.
  const handleClearResults = useCallback(() => {
    resultsRequestEpochRef.current += 1;
    fetchAbortRef.current?.abort();
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setError(null);
    setIsLoadingMore(false);
    setIsReranking(false);
    setAiRerankedCount(0);
    setNextPage(null);
    setTotalResults(null);
    setCollectorSearchId(null);
    setLastQuery("");
    setLastSearchOpts(null);
  }, []);

  // Full reset — wipes the form inputs, scope filters, URL params, and localStorage.
  const handleReset = useCallback(() => {
    resultsRequestEpochRef.current += 1;
    fetchAbortRef.current?.abort();
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setError(null);
    setIsLoadingMore(false);
    setIsReranking(false);
    setAiRerankedCount(0);
    setNextPage(null);
    setTotalResults(null);
    setCollectorSearchId(null);
    setLastQuery("");
    setLastSearchOpts(null);
    setWebsite("");
    setKeywords("");
    setScope({
      yearFrom: "",
      yearTo: "",
      jurisdiction: "",
      region: "",
      format: "any",
    });

    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    navigate({ search: "" }, { replace: true });
  }, [navigate]);

  const selectPurpose = useCallback(
    (purposeId: string) => {
      if (purposeId !== activePurposeId) {
        resultsRequestEpochRef.current += 1;
        fetchAbortRef.current?.abort();
        setSearchResults([]);
        setSelectedUrls(new Set());
        setCollectorSearchId(null);
        setHasSearched(false);
        setError(null);
        setIsLoading(false);
        setIsLoadingMore(false);
        setIsReranking(false);
        setPrefetchCount(0);
        setAiRerankedCount(0);
        setNextPage(null);
        setTotalResults(null);
        setLastQuery("");
        setLastSearchOpts(null);
      }
      setActivePurposeId(purposeId);
      setPurposeLanes([]);
      setActiveLaneKey("");
      const next = new URLSearchParams(loc.search);
      if (purposeId) next.set("purposeId", purposeId);
      else next.delete("purposeId");
      navigate({ search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });
    },
    [activePurposeId, loc.search, navigate],
  );

  const createPurpose = useCallback(async () => {
    if (!purposeDraft.title.trim() || !purposeDraft.researchQuestion.trim()) {
      setError("Give the purpose a title and research question first.");
      return;
    }
    setPurposeBusy(true);
    setError(null);
    try {
      const created = await createCollectorPurpose({
        title: purposeDraft.title,
        researchQuestion: purposeDraft.researchQuestion,
        jurisdiction: purposeDraft.jurisdiction || null,
        region: purposeDraft.region || null,
        outputGoal: purposeDraft.outputGoal || null,
        sourcePreferences: splitPurposeList(purposeDraft.sourcePreferences),
        targetActors: splitPurposeList(purposeDraft.targetActors),
      });
      setPurposes((current) => [created, ...current]);
      selectPurpose(created.id);
      setPurposeDraft({
        title: "",
        researchQuestion: "",
        jurisdiction: "",
        region: "",
        outputGoal: "",
        sourcePreferences: "",
        targetActors: "",
      });
      const plan = await planPurposeSearch(created.id);
      setPurposeLanes(plan.lanes);
    } catch (reason: any) {
      setError(reason?.message ?? "Could not create the purpose.");
    } finally {
      setPurposeBusy(false);
    }
  }, [purposeDraft, selectPurpose]);

  const generatePurposeLanes = useCallback(async () => {
    if (!activePurposeId) return;
    setPurposeBusy(true);
    setError(null);
    try {
      const plan = await planPurposeSearch(activePurposeId);
      setPurposeLanes(plan.lanes);
    } catch (reason: any) {
      setError(reason?.message ?? "Could not create search lanes.");
    } finally {
      setPurposeBusy(false);
    }
  }, [activePurposeId]);

  const deleteActivePurpose = useCallback(async () => {
    if (!activePurpose) return;

    const ok = await confirm({
      title: "Delete research purpose?",
      description:
        `This removes "${activePurpose.title}" and its purpose search history. ` +
        "Saved URLs, captured evidence, and files will not be deleted.",
      confirmText: "Delete purpose",
      cancelText: "Keep purpose",
      danger: true,
    });
    if (!ok) return;

    setPurposeDeleting(true);
    setError(null);
    try {
      await deleteCollectorPurpose(activePurpose.id);
      setPurposes((current) =>
        current.filter((purpose) => purpose.id !== activePurpose.id),
      );
      setActivePurposeId("");
      clearSearchOutcome();
      setPurposeLanes([]);
      setActiveLaneKey("");

      const next = new URLSearchParams(loc.search);
      next.delete("purposeId");
      navigate({ search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });

      notify("Research purpose deleted. Saved URLs and evidence were kept.", "success");
    } catch (reason: any) {
      const message = reason?.message ?? "Could not delete the purpose.";
      setError(message);
      notify(message, "error");
    } finally {
      setPurposeDeleting(false);
    }
  }, [activePurpose, clearSearchOutcome, confirm, loc.search, navigate, notify]);

  const applyPurposeLane = useCallback((lane: CollectorPurposeLane) => {
    setActiveLaneKey(lane.key);
    setWebsite(lane.website);
    setKeywords(lane.keywords);
    setScope({
      jurisdiction: lane.jurisdiction,
      region: lane.region,
      yearFrom: lane.yearFrom,
      yearTo: lane.yearTo,
      format: lane.format,
    });
    setAiAssistRationale(lane.rationale);
    setError(null);
    clearSearchOutcome();
  }, [clearSearchOutcome]);

  return (
    <main className="uc-page space-y-6 pt-6 md:pt-8 pb-8">
      {/* Top loading bar (micro-feedback) */}
      {isLoading && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-40 h-1 overflow-hidden"
        >
          <div className="loading-bar" />
        </div>
      )}

      <header className="page-header">
        <div className="page-header-main">
          <p className="page-header-kicker">Discovery</p>
          <h1 className="page-header-title">URL Collector</h1>
          <p className="page-header-subtitle">
            Search the web, review results, and send the best links straight
            into your Saved URLs library.
          </p>
        </div>

        <div className="page-header-meta">
          {hasSearched && (
            <>
              <div className="page-header-pill">
                <span className="page-header-pill-label">Results</span>
                <span className="page-header-pill-value">
                  {searchResults.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200 transition-colors"
                title="Clear everything and start a new search"
              >
                New search
              </button>
            </>
          )}
        </div>
      </header>

      <SmartCard as="section" className="uc-panel uc-purpose-panel p-4 sm:p-6">
        <div className="uc-purpose-toolbar">
          <div className="uc-filters-copy">
            <label className="uc-filters-kicker" htmlFor="collector-purpose">
              Research purpose
            </label>
            <h2 className="uc-filters-title">
              {activePurpose ? activePurpose.title : "Select or create a purpose"}
            </h2>
            <p className="uc-filters-subtitle">
              Keep searches, captures, and saved links tied to the same research thread.
            </p>
          </div>

          <div
            className={`uc-purpose-select-wrap ${purposeMenuOpen ? "is-open" : ""}`}
            ref={purposeSelectRef}
          >
            <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px] uc-purpose-select-shell">
              <button
                type="button"
                id="collector-purpose"
                className="md3-input input-pill uc-purpose-select w-full"
                aria-haspopup="listbox"
                aria-expanded={purposeMenuOpen}
                onClick={() => setPurposeMenuOpen((open) => !open)}
              >
                {activePurpose ? activePurpose.title : "Select a purpose before searching"}
              </button>
            </div>

            <div
              className={`uc-purpose-menu ${purposeMenuOpen ? "is-open" : ""}`}
              role="listbox"
              aria-labelledby="collector-purpose"
            >
              <button
                type="button"
                className={`uc-purpose-menu-option ${!activePurposeId ? "is-selected" : ""}`}
                role="option"
                aria-selected={!activePurposeId}
                onClick={() => {
                  selectPurpose("");
                  setPurposeMenuOpen(false);
                }}
              >
                Select a purpose before searching
              </button>

              {purposes.length > 0 && <div className="uc-purpose-menu-divider" />}

              {purposes.map((purpose) => (
                <button
                  key={purpose.id}
                  type="button"
                  className={`uc-purpose-menu-option ${
                    activePurposeId === purpose.id ? "is-selected" : ""
                  }`}
                  role="option"
                  aria-selected={activePurposeId === purpose.id}
                  onClick={() => {
                    selectPurpose(purpose.id);
                    setPurposeMenuOpen(false);
                  }}
                >
                  {purpose.title}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!activePurpose && (
          <div className="uc-purpose-create">
            <div className="uc-purpose-create-grid">
              <div className="uc-filter-item uc-purpose-field--title">
                <label className="uc-filter-label" htmlFor="collector-purpose-title">
                  Purpose title
                </label>
                <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
                  <input
                    id="collector-purpose-title"
                    className="md3-input input-pill uc-purpose-input w-full"
                    placeholder="e.g. Delhi water governance"
                    value={purposeDraft.title}
                    onChange={(event) =>
                      setPurposeDraft((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="uc-filter-item uc-purpose-field--area">
                <label className="uc-filter-label" htmlFor="collector-purpose-jurisdiction">
                  Jurisdiction or area
                </label>
                <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
                  <input
                    id="collector-purpose-jurisdiction"
                    className="md3-input input-pill uc-purpose-input w-full"
                    placeholder="India, EU, California..."
                    value={purposeDraft.jurisdiction}
                    onChange={(event) =>
                      setPurposeDraft((current) => ({
                        ...current,
                        jurisdiction: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="uc-filter-item uc-purpose-field--question">
                <label className="uc-filter-label" htmlFor="collector-purpose-question">
                  Research question
                </label>
                <div className="input-gradient-shell bg-landing-gradient uc-purpose-textarea-shell p-[1.5px]">
                  <textarea
                    id="collector-purpose-question"
                    className="md3-input uc-purpose-textarea w-full"
                    placeholder="What decision, risk, or claim needs evidence?"
                    value={purposeDraft.researchQuestion}
                    onChange={(event) =>
                      setPurposeDraft((current) => ({
                        ...current,
                        researchQuestion: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="uc-filter-item uc-purpose-field--output">
                <label className="uc-filter-label" htmlFor="collector-purpose-output">
                  Desired output
                </label>
                <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
                  <input
                    id="collector-purpose-output"
                    className="md3-input input-pill uc-purpose-input w-full"
                    placeholder="Brief, memo, review..."
                    value={purposeDraft.outputGoal}
                    onChange={(event) =>
                      setPurposeDraft((current) => ({
                        ...current,
                        outputGoal: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="uc-filter-item uc-purpose-field--sources">
                <label className="uc-filter-label" htmlFor="collector-purpose-sources">
                  Official sources or domains
                </label>
                <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
                  <input
                    id="collector-purpose-sources"
                    className="md3-input input-pill uc-purpose-input w-full"
                    placeholder="caqm.nic.in, CPCB, DPCC..."
                    value={purposeDraft.sourcePreferences}
                    onChange={(event) =>
                      setPurposeDraft((current) => ({
                        ...current,
                        sourcePreferences: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="uc-filter-item uc-purpose-field--actors">
                <label className="uc-filter-label" htmlFor="collector-purpose-actors">
                  Agencies, actors, or institutions
                </label>
                <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
                  <input
                    id="collector-purpose-actors"
                    className="md3-input input-pill uc-purpose-input w-full"
                    placeholder="CAQM, Delhi Environment Department..."
                    value={purposeDraft.targetActors}
                    onChange={(event) =>
                      setPurposeDraft((current) => ({
                        ...current,
                        targetActors: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="uc-purpose-create-actions">
              <button
                type="button"
                onClick={() => void createPurpose()}
                disabled={purposeBusy || purposeDeleting}
                className="btn-primary min-h-[40px] px-4 py-2"
              >
                {purposeBusy ? "Creating..." : "Create purpose"}
              </button>
            </div>
          </div>
        )}

        {activePurpose && (
          <div className="uc-purpose-summary">
            <div className="uc-purpose-summary-main">
              <p className="uc-purpose-question">{activePurpose.researchQuestion}</p>
              {(activePurpose.jurisdiction || activePurpose.outputGoal) && (
                <div className="uc-purpose-meta-row">
                  {[activePurpose.jurisdiction, activePurpose.outputGoal]
                    .filter(Boolean)
                    .map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                </div>
              )}
              {activePurpose.authoritySources?.length ? (
                <div className="uc-authority-sources" aria-label="Suggested official source coverage">
                  <div className="uc-authority-sources-head">
                    <span className="uc-authority-sources-kicker">Suggested official domains</span>
                    <span className="uc-authority-sources-copy">
                      Matched from the question, jurisdiction, actors, and seeded sources.
                    </span>
                  </div>
                  <div className="uc-authority-source-grid">
                    {activePurpose.authoritySources.slice(0, 6).map((source) => (
                      <button
                        key={source.key}
                        type="button"
                        className="uc-authority-source"
                        onClick={() => searchAuthoritySource(source)}
                        title={source.reason}
                      >
                        <span className="uc-authority-source-main">
                          <strong>{source.label}</strong>
                          <span>{source.domain}</span>
                          <em>{source.evidenceRole}</em>
                        </span>
                        <span className="uc-authority-source-score">
                          {source.confidence}% match
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="uc-purpose-summary-side">
              <div className="uc-purpose-stats" aria-label="Purpose summary">
                <span className="uc-purpose-stat">
                  <strong>{activePurpose.summary.savedUrlCount}</strong> saved URLs
                </span>
                <span className="uc-purpose-stat">
                  <strong>{activePurpose.summary.capturedEvidenceCount}</strong> captures
                </span>
              </div>

              <div className="uc-purpose-actions">
                <button
                  type="button"
                  className="uc-filters-reset is-active"
                  onClick={() =>
                    navigate(
                      `/app/saved-urls?collectorPurposeId=${encodeURIComponent(activePurpose.id)}`,
                    )
                  }
                >
                  Open Saved URLs
                </button>
                <button
                  type="button"
                  className="btn-primary min-h-[40px] px-4 py-2"
                  disabled={purposeBusy || purposeDeleting}
                  onClick={() => void generatePurposeLanes()}
                >
                  {purposeBusy ? "Generating..." : "Generate search lanes"}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/50"
                  disabled={purposeBusy || purposeDeleting}
                  onClick={() => void deleteActivePurpose()}
                  title="Delete this research purpose"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {purposeDeleting ? "Deleting..." : "Delete purpose"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activePurpose && purposeLanes.length > 0 && (
          <div className="uc-purpose-lanes">
            {purposeLanes.map((lane) => (
              <button
                key={lane.key}
                type="button"
                onClick={() => applyPurposeLane(lane)}
                className={`uc-purpose-lane ${activeLaneKey === lane.key ? "is-active" : ""}`}
              >
                <span className="uc-purpose-lane-title">{lane.label}</span>
                <span className="uc-purpose-lane-copy">{lane.rationale}</span>
              </button>
            ))}
          </div>
        )}
      </SmartCard>

      {/* Search card */}
      <section aria-labelledby="search-section-title">
        <h2 id="search-section-title" className="sr-only">
          Search
        </h2>
        <SmartCard
          as="section"
          className="uc-panel uc-panel--search p-4 sm:p-6"
        >
          <SearchForm
            isLoading={isLoading}
            onSearch={(site, kw) => {
              setWebsite(site);
              setKeywords(kw);
              return handleSearch(site, kw);
            }}
            initialWebsite={website}
            initialKeywords={keywords}
            onWebsiteChange={setWebsite}
            onKeywordsChange={setKeywords}
            searchPreview={
              hasSearched
                ? formatAppliedCollectorSearchPlan(lastQuery, lastSearchOpts)
                : undefined
            }
            currentScope={scope}
            onAiAssist={handleAiAssist}
            aiAssistLoading={aiAssistLoading}
            aiAssistRationale={aiAssistRationale}
            searchDisabled={!activePurpose}
          />

          {/* Scope filters */}
          <div className="uc-filters">
            <div className="uc-filters-head">
              <div className="uc-filters-copy">
                <p className="uc-filters-kicker">Search scope</p>
                <h3 className="uc-filters-title">
                  Refine by time, geography, and format
                </h3>
                <p className="uc-filters-subtitle">
                  Focus the result set without rewriting your search query.
                </p>
              </div>

              <button
                type="button"
                className={`uc-filters-reset ${hasActiveScopeFilters ? "is-active" : ""}`}
                onClick={() =>
                  setScope({
                    yearFrom: "",
                    yearTo: "",
                    jurisdiction: "",
                    region: "",
                    format: "any",
                  })
                }
                disabled={!hasActiveScopeFilters}
                title="Clear all scope filters"
              >
                Clear all
              </button>
            </div>

            <div className="uc-filters-grid">
              <div className="uc-filter-item uc-filter-item--sm">
                <label htmlFor="uc-year-from" className="uc-filter-label">
                  Year from
                </label>
                <input
                  id="uc-year-from"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 2015"
                  className="input uc-filter-control w-full"
                  value={scope.yearFrom}
                  onChange={(e) =>
                    setScope((p) => ({ ...p, yearFrom: e.target.value }))
                  }
                />
              </div>

              <div className="uc-filter-item uc-filter-item--sm">
                <label htmlFor="uc-year-to" className="uc-filter-label">
                  Year to
                </label>
                <input
                  id="uc-year-to"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 2024"
                  className="input uc-filter-control w-full"
                  value={scope.yearTo}
                  onChange={(e) =>
                    setScope((p) => ({ ...p, yearTo: e.target.value }))
                  }
                />
              </div>

              <div className="uc-filter-item uc-filter-item--lg">
                <label htmlFor="uc-jurisdiction" className="uc-filter-label">
                  Jurisdiction
                </label>
                <input
                  id="uc-jurisdiction"
                  type="text"
                  placeholder="e.g. IN / India / California"
                  className="input uc-filter-control w-full"
                  value={scope.jurisdiction}
                  onChange={(e) =>
                    setScope((p) => ({ ...p, jurisdiction: e.target.value }))
                  }
                />
              </div>

              <div className="uc-filter-item uc-filter-item--lg">
                <label htmlFor="uc-region" className="uc-filter-label">
                  Area / region
                </label>
                <input
                  id="uc-region"
                  type="text"
                  placeholder="e.g. Delhi / EU / South Asia"
                  className="input uc-filter-control w-full"
                  value={scope.region}
                  onChange={(e) =>
                    setScope((p) => ({ ...p, region: e.target.value }))
                  }
                />
              </div>

              <div className="uc-filter-item uc-filter-item--md">
                <label htmlFor="uc-format" className="uc-filter-label">
                  Document format
                </label>
                <select
                  id="uc-format"
                  className="input uc-filter-control w-full"
                  value={scope.format}
                  onChange={(e) =>
                    setScope((p) => ({
                      ...p,
                      format: e.target.value as CollectorScope["format"],
                    }))
                  }
                >
                  <option value="any">Any</option>
                  <option value="pdfOnly">PDF only</option>
                  <option value="excludePdf">Exclude PDFs</option>
                </select>
              </div>
            </div>

            <div className="uc-filters-footnote" role="note">
              <span className="uc-filters-footnote-dot" aria-hidden="true" />
              <span>
                These filters are applied as structured search parameters, so
                the keyword query stays clean and the backend owns filter
                behavior.
              </span>
            </div>
          </div>

          <div
            className="mt-3 flex flex-wrap items-center gap-3"
            role="status"
            aria-live="polite"
          >
            {isLoading && <Spinner />}
            {error && (
              <span className="text-red-700 dark:text-red-300 text-sm">
                {error}
              </span>
            )}

            {isLoading && !error && hasSearched && (
              <span className="text-gray-600 dark:text-gray-300 text-sm">
                Loading{" "}
                {prefetchCount ||
                  Math.min(searchResults.length, INITIAL_RESULTS_TARGET)}
                /{INITIAL_RESULTS_TARGET} results…
              </span>
            )}

            {!isLoading && hasSearched && (
              <span className="text-gray-600 dark:text-gray-300 text-sm">
                {searchResults.length} result
                {searchResults.length === 1 ? "" : "s"}
              </span>
            )}

            {isReranking && hasSearched && (
              <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                AI reranking loaded results…
              </span>
            )}

            {!isLoading &&
              !isReranking &&
              hasSearched &&
              aiRerankedCount > 0 && (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  AI-reranked {aiRerankedCount} result
                  {aiRerankedCount === 1 ? "" : "s"}
                </span>
            )}
            {/* announce sort to screen readers */}
            <span className="sr-only">Sorted by {sortKey}</span>
          </div>

          {activePurpose && hasSearched && authorityCoverage.length > 0 && (
            <div className="uc-source-coverage" aria-label="Official source coverage after search">
              <div className="uc-source-coverage-head">
                <div>
                  <p className="uc-filters-kicker">Coverage check</p>
                  <h3 className="uc-source-coverage-title">
                    {missingAuthorityCount === 0
                      ? "All suggested official sources appeared in results"
                      : criticalMissingAuthorityCount > 0
                        ? `${criticalMissingAuthorityCount} critical official-source gap${
                            criticalMissingAuthorityCount === 1 ? "" : "s"
                          } in results`
                        : `${missingAuthorityCount} suggested official source${
                            missingAuthorityCount === 1 ? "" : "s"
                          } missing from results`}
                  </h3>
                </div>
                <div className="uc-source-coverage-head-actions">
                  <div
                    className={`uc-source-coverage-score is-${authorityCoverageRisk}`}
                    aria-label={`Official source coverage score ${authorityCoverageScore} percent, ${authorityCoverageRiskLabel}`}
                  >
                    <span>{authorityCoverageScore}%</span>
                    <strong>{authorityCoverageRiskLabel}</strong>
                  </div>
                  {missingAuthorityCount > 0 && (
                    <button
                      type="button"
                      className="uc-source-coverage-action"
                      onClick={() => void recoverMissingAuthoritySources()}
                      disabled={isLoading || isRecoveringSources}
                    >
                      {isRecoveringSources ? "Recovering..." : "Search missing sources"}
                    </button>
                  )}
                  <span className="uc-source-coverage-count">
                    {authorityCoverage.length - missingAuthorityCount}/{authorityCoverage.length} covered
                  </span>
                </div>
              </div>

              {evidenceRoleCoverage.length > 0 && (
                <div className="uc-source-role-grid" aria-label="Evidence role completeness">
                  {evidenceRoleCoverage.slice(0, 6).map((role) => (
                    <div
                      key={role.role}
                      className={`uc-source-role ${
                        role.covered > 0 ? "is-covered" : "is-missing"
                      }`}
                    >
                      <span>{role.covered > 0 ? "Role covered" : "Role missing"}</span>
                      <strong>{role.role}</strong>
                      <em>
                        {role.covered}/{role.total} source
                        {role.total === 1 ? "" : "s"}
                      </em>
                    </div>
                  ))}
                </div>
              )}

              <div className="uc-source-coverage-grid">
                {authorityCoverage.slice(0, 8).map((source) => (
                  <div
                    key={source.key}
                    className={`uc-source-coverage-item ${
                      source.covered
                        ? "is-covered"
                        : source.gapSeverity === "critical"
                          ? "is-critical"
                          : "is-missing"
                    }`}
                  >
                    <div className="uc-source-coverage-main">
                      <span className="uc-source-coverage-status">
                        {source.covered
                          ? "Found"
                          : source.gapSeverity === "critical"
                            ? "Critical gap"
                            : source.gapSeverity === "important"
                              ? "Important gap"
                              : "Missing"}
                      </span>
                      <strong>{source.label}</strong>
                      <span>{source.domain}</span>
                      <em>{source.evidenceRole}</em>
                    </div>
                    <div className="uc-source-coverage-side">
                      {source.covered ? (
                        <span className="uc-source-coverage-result">
                          {source.resultCount} result{source.resultCount === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="uc-source-coverage-action"
                          onClick={() => searchAuthoritySource(source)}
                          disabled={isLoading || isRecoveringSources}
                        >
                          Search source
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SmartCard>
      </section>

      <CollectorJobConsole
        jobs={collectorJobs}
        actions={collectorJobActions}
      />

      {/* Results (sticky toolbar inside the card) */}
      <section
        ref={resultsSectionRef}
        aria-labelledby="results-title"
        className="space-y-4"
      >
        <SmartCard
          as="div"
          className="uc-panel uc-panel--results overflow-hidden"
        >
          {/* Sticky header row */}
          <div className="uc-panel-head">
            <h2
              id="results-title"
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              Results
            </h2>
          </div>

          {/* Results body */}
          <div className="uc-panel-scroll">
            {!hasSearched && searchResults.length === 0 ? (
              <div className="py-12 text-center text-gray-600 dark:text-gray-300">
                Start by entering a website and keywords above.
              </div>
            ) : (
              <>
                <ResultsTable
                  results={searchResults}
                  selectable
                  selectedUrls={selectedUrls}
                  onToggleRow={onToggleRow}
                  onTogglePage={onTogglePage}
                  onToggleFiltered={onTogglePage}
                  onClearSelection={onClearSelection}
                  onClear={handleClearResults}
                  sortKey={sortKey}
                  onSortChange={(k) => setSortKey(k)}
                  collectorPurposeId={activePurposeId}
                  collectorPurposeTitle={activePurpose?.title ?? "selected purpose"}
                  collectorSearchId={collectorSearchId}
                  authorityCoverageRisk={authorityCoverageRisk}
                  authorityCoverageScore={authorityCoverageScore}
                  criticalMissingAuthorityCount={criticalMissingAuthorityCount}
                  missingEvidenceRoles={missingEvidenceRoles}
                />

                {hasSearched && searchResults.length > 0 && (
                  <div className="mt-4 flex flex-col items-center gap-2 pb-2">
                    {typeof totalResults === "number" &&
                      !Number.isNaN(totalResults) && (
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          Showing {searchResults.length} of{" "}
                          {totalResults.toLocaleString()} results
                        </div>
                      )}

                    {nextPage ? (
                      <button
                        type="button"
                        onClick={handleLoadMore}
                        disabled={isLoading || isLoadingMore}
                        className="btn-primary rounded-full px-5 py-2 disabled:opacity-60"
                        title="Load more results"
                      >
                        {isLoadingMore ? "Loading…" : "Load more"}
                      </button>
                    ) : (
                      <div className="text-xs text-gray-500">
                        No more results
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </SmartCard>
      </section>
    </main>
  );
};

export default UrlCollectorPage;
