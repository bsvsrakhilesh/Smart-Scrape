import React, { useCallback, useEffect, useRef, useState } from "react";
import SearchForm from "../components/urlcollector/SearchForm";
import ResultsTable from "../components/urlcollector/ResultsTable";
import Spinner from "../components/urlcollector/Spinner";
import { SearchResult } from "../lib/types";
import {
  planCollectorQuery,
  rerankSearchResults,
  searchWeb,
  type SearchWebOptions,
} from "../lib/api";
import { useLocation, useNavigate } from "react-router-dom";
import SmartCard from "../components/ui/SmartCard";
import CollectorJobConsole from "../components/urlcollector/CollectorJobConsole";
import { useCollectorJobs } from "../hooks/useCollectorJobs";
import {
  buildCollectorSearchQuery,
  formatAppliedCollectorSearchPlan,
  normalizeCollectorKeywords,
} from "../utils/urlCollector";

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

function toYYYY(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  // allow user to type 2024, or 2024-xx (we’ll take first 4 digits)
  const m = t.match(/^(\d{4})/);
  return m ? m[1] : "";
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
  const params = new URLSearchParams(loc.search);
  const {
    jobs: collectorJobs,
    actions: collectorJobActions,
  } = useCollectorJobs();
  const searchRetryRef = useRef<(site?: string, keywords?: string) => void>(
    () => {},
  );
  const loadMoreRetryRef = useRef<() => void>(() => {});

  const urlSite = params.get("site") ?? "";
  const urlKeywords = params.get("q") ?? "";

  // Optional filter params (shareable links)
  const urlYearFrom = params.get("yearFrom") ?? "";
  const urlYearTo = params.get("yearTo") ?? "";
  const urlJurisdiction = params.get("jurisdiction") ?? "";
  const urlRegion = params.get("region") ?? "";
  const urlFormat = (params.get("format") ?? "any") as CollectorScope["format"];

  const hasUrlParams =
    !!urlSite ||
    !!urlKeywords ||
    !!urlYearFrom ||
    !!urlYearTo ||
    !!urlJurisdiction ||
    !!urlRegion ||
    (urlFormat && urlFormat !== "any");

  const [website, setWebsite] = useState(urlSite);
  const [keywords, setKeywords] = useState(urlKeywords);

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

  // Abort in-flight searches when a new one starts
  const fetchAbortRef = useRef<AbortController | null>(null);
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

  /* ---------- Restore persisted state ---------- */
  useEffect(() => {
    // If URL includes params, treat it as authoritative (shareable links should win)
    if (hasUrlParams) return;

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as PersistShape;

      if (p.website) setWebsite(p.website);
      if (p.keywords) setKeywords(p.keywords);
      if (p.scope) setScope((prev) => ({ ...prev, ...p.scope }));
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
    } catch {
      /* ignore */
    }
  }, [hasUrlParams]);

  /* ---------- Persist state (quota-safe) ---------- */
  useEffect(() => {
    // store capped + minified results for a good UX on refresh
    const full: PersistShape = {
      website,
      keywords,
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
      scope,
      selected: [],
      sortKey,
      lastRunAt: hasSearched ? new Date().toISOString() : undefined,
    };

    if (safeLocalStorageSet(LS_KEY, full)) return;
    if (safeLocalStorageSet(LS_KEY, noResults)) return;
    safeLocalStorageSet(LS_KEY, minimal);
  }, [
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
    async (siteArg?: string, kwArg?: string) => {
      const site = (siteArg ?? website).trim();
      const kws = normalizeCollectorKeywords(kwArg ?? keywords);

      const yFrom = toYYYY(scope.yearFrom);
      const yTo = toYYYY(scope.yearTo);
      if (yFrom && yTo && Number(yFrom) > Number(yTo)) {
        setError("Year from must be ≤ Year to.");
        setHasSearched(true);
        return;
      }

      const now = Date.now();
      if (now < rateLimitUntilRef.current) {
        const secs = Math.ceil((rateLimitUntilRef.current - now) / 1000);
        setError(`Rate limit hit. Please wait ${secs}s and try again.`);
        setHasSearched(true);
        return;
      }

      if (!site && !kws) {
        setError("Enter a website and/or keywords to search.");
        setHasSearched(false);
        setIsLoadingMore(false);
        setNextPage(null);
        setTotalResults(null);
        return;
      }

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
          scope,
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

      // keep URL in sync (shareable)
      syncUrl(site, kws, scope);

      try {
        const q = buildCollectorSearchQuery(kws);
        const searchOpts = buildSearchOpts(site, scope);
        setLastSearchOpts(searchOpts);

        // Helper to fetch a specific page from the backend
        const fetchPage = async (page: number) => {
          return await searchWeb(q, page, controller.signal, searchOpts);
        };

        setLastQuery(q);
        setPrefetchCount(0);

        // Fetch page 1 immediately
        const p1 = await fetchPage(1);
        collectorJobActions.updateJob(jobId, {
          stage: "page-1",
          message: `Loaded first ${p1.rows.length} result${p1.rows.length === 1 ? "" : "s"}`,
          progressPct: 22,
        });
        setSearchResults(p1.rows);
        setSelectedUrls(new Set());
        setNextPage(p1.nextPage);
        setTotalResults(p1.totalResults);
        setPrefetchCount(p1.rows.length);

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
        const seen = new Set(p1.rows.map((r) => r.url));
        let merged = [...p1.rows];
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

          for (const r of pn.rows) {
            if (r.url && !seen.has(r.url)) {
              seen.add(r.url);
              merged.push(r);
              if (merged.length >= INITIAL_RESULTS_TARGET) break;
            }
          }

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
    [navigate, website, keywords, scope, collectorJobActions, applyMergedRerank],
  );

  useEffect(() => {
    searchRetryRef.current = (siteArg?: string, kwArg?: string) => {
      void handleSearch(siteArg, kwArg);
    };
  }, [handleSearch]);

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
      } catch (e: any) {
        setError(e?.message || "AI assist failed");
      } finally {
        setAiAssistLoading(false);
      }
    },
    [],
  );

  const handleLoadMore = useCallback(async () => {
    if (!nextPage || !lastQuery) return;

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

      collectorJobActions.updateJob(jobId, {
        stage: "merging",
        message: `Merging ${newRows.length} new result${newRows.length === 1 ? "" : "s"}`,
        progressPct: 52,
      });

      const seen = new Set(searchResults.map((r) => r.url));
      const merged = [...searchResults];

      for (const r of newRows) {
        if (r.url && !seen.has(r.url)) {
          seen.add(r.url);
          merged.push(r);
        }
      }

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
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setError(null);
    setIsLoadingMore(false);
    setIsReranking(false);
    setAiRerankedCount(0);
    setNextPage(null);
    setTotalResults(null);
    setLastQuery("");
    setLastSearchOpts(null);
  }, []);

  // Full reset — wipes the form inputs, scope filters, URL params, and localStorage.
  const handleReset = useCallback(() => {
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setError(null);
    setIsLoadingMore(false);
    setIsReranking(false);
    setAiRerankedCount(0);
    setNextPage(null);
    setTotalResults(null);
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
                  searchQuery={lastQuery || keywords}
                  jobs={collectorJobActions}
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
