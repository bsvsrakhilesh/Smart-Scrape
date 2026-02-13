import React, { useCallback, useEffect, useRef, useState } from "react";
import SearchForm from "../components/urlcollector/SearchForm";
import ResultsTable from "../components/urlcollector/ResultsTable";
import Spinner from "../components/urlcollector/Spinner";
import { SearchResult } from "../lib/types";
import { searchWeb } from "../lib/api";
import { useLocation, useNavigate } from "react-router-dom";
import SmartCard from "../components/ui/SmartCard";

const LS_KEY = "uc:v1";

// UX targets
const RESULTS_PER_PAGE = 10;
const INITIAL_RESULTS_TARGET = 50; // fetch up to this many automatically on a single Search

type SortKey = "original" | "title" | "domain";

type PersistShape = {
  website: string;
  keywords: string;
  results: SearchResult[];
  selected: string[]; // persist Set<string> as array
  sortKey?: SortKey;
  lastRunAt?: string;

  lastQuery?: string;
  nextPage?: number | null;
  totalResults?: number | null;
};

const UrlCollectorPage: React.FC = () => {
  const navigate = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);

  const urlSite = params.get("site") ?? "";
  const urlKeywords = params.get("q") ?? "";

  const [website, setWebsite] = useState(urlSite);
  const [keywords, setKeywords] = useState(urlKeywords);

  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");

  // Auto-prefetch progress (so the UI can say "Loading 30/50 results…")
  const [prefetchCount, setPrefetchCount] = useState<number>(0);

  // Selection must be Set<string> for ResultsTable
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // Page-level controlled sort (passed to ResultsTable)
  const [sortKey, setSortKey] = useState<SortKey>("original");

  // Abort in-flight searches when a new one starts
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Scroll target for the results section
  const resultsSectionRef = useRef<HTMLElement | null>(null);

  /* ---------- Restore persisted state ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as PersistShape;

      if (p.website) setWebsite(p.website);
      if (p.keywords) setKeywords(p.keywords);
      if (p.results) setSearchResults(p.results);
      if (p.selected) setSelectedUrls(new Set(p.selected));
      if (p.sortKey) setSortKey(p.sortKey);
      if (typeof p.lastQuery === "string") setLastQuery(p.lastQuery);
      if (typeof p.nextPage !== "undefined") setNextPage(p.nextPage ?? null);
      if (typeof p.totalResults !== "undefined")
        setTotalResults(p.totalResults ?? null);
      if ((p.results && p.results.length > 0) || p.lastRunAt) {
        setHasSearched(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------- Persist state ---------- */
  useEffect(() => {
    const payload: PersistShape = {
      website,
      keywords,
      results: searchResults,
      selected: Array.from(selectedUrls),
      sortKey,
      lastRunAt: hasSearched ? new Date().toISOString() : undefined,

      lastQuery,
      nextPage,
      totalResults,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
  }, [
    website,
    keywords,
    searchResults,
    selectedUrls,
    sortKey,
    hasSearched,
    lastQuery,
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

  /* ---------- Search handler (working fetch + abort) ---------- */
  const handleSearch = useCallback(
    async (siteArg?: string, kwArg?: string) => {
      const site = (siteArg ?? website).trim();
      const kws = (kwArg ?? keywords).trim();

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

      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      // keep URL in sync
      navigate(
        {
          search: `?site=${encodeURIComponent(site)}&q=${encodeURIComponent(kws)}`,
        },
        { replace: true },
      );

      try {
        const q = `${site ? `site:${site} ` : ""}${kws}`.trim();

        // Helper to fetch a specific page from the backend
        const fetchPage = async (page: number) => {
          return await searchWeb(q, page, controller.signal);
        };

        setLastQuery(q);
        setPrefetchCount(0);

        // 1) Fetch page 1 immediately
        const p1 = await fetchPage(1);
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
            "No results found. Try different keywords or remove the site: filter.",
          );
          return;
        }

        // 2) Auto-prefetch up to 50 results (5 pages x 10 results)
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
          const pn = await fetchPage(np);
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
          setNextPage(pn.nextPage);
          if (typeof pn.totalResults === "number")
            setTotalResults(pn.totalResults);
          np = pn.nextPage;

          // If a page returns no rows, stop trying.
          if (pn.rows.length === 0) break;
        }
      } catch (e: any) {
        if (e?.name !== "AbortError" && e?.code !== "ERR_CANCELED") {
          if (e?.message === "RATE_LIMITED") {
            setError(
              "Too many searches too quickly. Please wait 60 seconds and try again.",
            );
          } else {
            const msg =
              typeof e?.message === "string" ? e.message : "Search failed";
            setError(
              msg.includes("Failed to fetch") || msg.includes("Network Error")
                ? "Network error. Is your server running and reachable?"
                : msg,
            );
          }
        }
      } finally {
        if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
        setIsLoading(false);
        setPrefetchCount(0);
      }
    },
    [navigate, website, keywords],
  );

  const handleLoadMore = useCallback(async () => {
    if (!nextPage || !lastQuery) return;

    setIsLoadingMore(true);
    setError(null);

    try {
      const {
        rows: newRows,
        nextPage: np,
        totalResults: tot,
      } = await searchWeb(lastQuery, nextPage);

      setSearchResults((prev) => {
        const seen = new Set(prev.map((r) => r.url));
        const merged = [...prev];
        for (const r of newRows) {
          if (r.url && !seen.has(r.url)) {
            seen.add(r.url);
            merged.push(r);
          }
        }
        return merged;
      });

      setNextPage(np);
      setTotalResults(tot);

      if (newRows.length === 0) setNextPage(null);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string" ? e.message : "Load more failed";
      setError(
        msg.includes("Failed to fetch") || msg.includes("Network Error")
          ? "Network error. Is your server running and reachable?"
          : msg,
      );
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextPage, lastQuery]);

  /* ---------- Selection handlers ---------- */
  const onToggleRow = useCallback((url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  // ResultsTable expects () => void
  const onToggleAll = useCallback(() => {
    setSelectedUrls((prev) => {
      if (searchResults.length === 0) return new Set();
      const allSelected = prev.size === searchResults.length;
      return allSelected ? new Set() : new Set(searchResults.map((r) => r.url));
    });
  }, [searchResults]);

  const handleClear = useCallback(() => {
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setError(null);
    setIsLoadingMore(false);
    setNextPage(null);
    setTotalResults(null);
    setLastQuery("");
    setWebsite("");
    setKeywords("");
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    navigate({ search: "" }, { replace: true });
  }, [navigate]);

  return (
    <main className="space-y-6 pt-6 md:pt-8 pb-8">
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
            <div className="page-header-pill">
              <span className="page-header-pill-label">Results</span>
              <span className="page-header-pill-value">
                {searchResults.length}
              </span>
            </div>
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
          className="fm-panel !bg-transparent !border-none !shadow-none p-4 sm:p-6"
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
          />
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
            {/* announce sort to screen readers */}
            <span className="sr-only">Sorted by {sortKey}</span>
          </div>
        </SmartCard>
      </section>

      {/* Results (sticky toolbar inside the card) */}
      <section
        ref={resultsSectionRef}
        aria-labelledby="results-title"
        className="space-y-4"
      >
        <SmartCard
          as="div"
          className="fm-panel !bg-transparent !border-none !shadow-none overflow-hidden"
        >
          {/* Sticky header row */}
          <div className="flex items-center sticky top-0 z-10 px-3 sm:px-4 py-3 backdrop-blur-sm">
            <h2
              id="results-title"
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              Results
            </h2>
          </div>

          {/* Results body */}
          <div className="p-2 sm:p-3">
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
                  onToggleAll={onToggleAll}
                  onClear={handleClear}
                  sortKey={sortKey}
                  onSortChange={(k) => setSortKey(k)}
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
