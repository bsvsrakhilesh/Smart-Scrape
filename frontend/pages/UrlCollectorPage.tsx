import React, { useCallback, useEffect, useRef, useState } from 'react';
import SearchForm from '../components/urlcollector/SearchForm';
import ResultsTable from '../components/urlcollector/ResultsTable';
import Spinner from '../components/urlcollector/Spinner';
import { SearchResult } from '../types';
import { useLocation, useNavigate } from 'react-router-dom';
import SmartCard  from '../components/ui/SmartCard';

const LS_KEY = 'uc:v1';

type SortKey = 'original' | 'title' | 'domain';

type PersistShape = {
  website: string;
  keywords: string;
  results: SearchResult[];
  selected: string[];         // persist Set<string> as array
  sortKey?: SortKey;
  lastRunAt?: string;
};

const UrlCollectorPage: React.FC = () => {
  const navigate = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);

  const urlSite = params.get('site') ?? '';
  const urlKeywords = params.get('q') ?? '';

  const [website, setWebsite] = useState(urlSite);
  const [keywords, setKeywords] = useState(urlKeywords);

  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Selection must be Set<string> for ResultsTable
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // Page-level controlled sort (passed to ResultsTable)
  const [sortKey, setSortKey] = useState<SortKey>('original');

  // Abort in-flight searches when a new one starts
  const fetchAbortRef = useRef<AbortController | null>(null);

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
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch {}
  }, [website, keywords, searchResults, selectedUrls, sortKey, hasSearched]);

  /* ---------- Global shortcuts (without touching SearchForm.tsx) ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const metaK = (e.key.toLowerCase() === 'k') && (e.metaKey || e.ctrlKey);
      const isSlash = e.key === '/';
      if (metaK || isSlash) {
        e.preventDefault();
        (document.getElementById('sf-keywords') as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- Search handler (working fetch + abort) ---------- */
  const handleSearch = useCallback(async (siteArg?: string, kwArg?: string) => {
    const site = (siteArg ?? website).trim();
    const kws  = (kwArg ?? keywords).trim();

    if (!site && !kws) {
      setError('Enter a website and/or keywords to search.');
      setHasSearched(false);
      return;
    }

    // Cancel any previous request
    try { fetchAbortRef.current?.abort(); } catch {}
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    // keep URL in sync
    navigate({ search: `?site=${encodeURIComponent(site)}&q=${encodeURIComponent(kws)}` }, { replace: true });

    try {
      const q = `${site ? `site:${site} ` : ''}${kws}`.trim();
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Proxy error ${res.status}: ${text || res.statusText}`);
      }

      const data = (await res.json()) as SearchResult[];
      const results: SearchResult[] = Array.isArray(data)
        ? data.map(it => ({
            title: it.title ?? '(no title)',
            url: it.url ?? '',
            snippet: it.snippet ?? '',
          }))
        : [];

      setSearchResults(results);
      setSelectedUrls(new Set());

      if (results.length === 0) {
        setError('No results found. Try different keywords or remove the site: filter.');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        const msg = typeof e?.message === 'string' ? e.message : 'Search failed';
        setError(msg.includes('Failed to fetch')
          ? 'Network error. Is your server running and reachable?'
          : msg);
      }
    } finally {
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
      setIsLoading(false);
    }
  }, [navigate, website, keywords]);

  /* ---------- Selection handlers ---------- */
  const onToggleRow = useCallback((url: string) => {
    setSelectedUrls(prev => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  // ResultsTable expects () => void
  const onToggleAll = useCallback(() => {
    setSelectedUrls(prev => {
      if (searchResults.length === 0) return new Set();
      const allSelected = prev.size === searchResults.length;
      return allSelected ? new Set() : new Set(searchResults.map(r => r.url));
    });
  }, [searchResults]);

  const handleClear = useCallback(() => {
    setSearchResults([]);
    setSelectedUrls(new Set());
    setHasSearched(false);
    setError(null);
    setWebsite('');
    setKeywords('');
    try { localStorage.removeItem(LS_KEY); } catch {}
    navigate({ search: '' }, { replace: true });
  }, [navigate]);

  return (
    <main className="space-y-6">
      {/* Top loading bar (micro-feedback) */}
      {isLoading && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40 h-1 overflow-hidden">
          <div className="loading-bar" />
        </div>
      )}

      <header className="rounded-2xl p-5 bg-landing-gradient shadow-soft mb-4 text-center">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">URL Collector</h1>
        <p className="text-gray-700 dark:text-gray-300">Search the web and save relevant sources to your workspace.</p>
      </header>

      {/* Search card */}
      <section className="glass-card rounded-2xl p-5 sm:p-6 elevate-on-hover" aria-labelledby="search-section-title">
        <h2 id="search-section-title" className="sr-only">Search</h2>
        <SmartCard as="section" className="p-4 sm:p-6">
        <SearchForm
          isLoading={isLoading}
          onSearch={(site, kw) => { setWebsite(site); setKeywords(kw); return handleSearch(site, kw); }}
          initialWebsite={website}
          initialKeywords={keywords}
          onWebsiteChange={setWebsite}
          onKeywordsChange={setKeywords}
        />
        <div className="mt-3 flex items-center gap-3" role="status" aria-live="polite">
          {isLoading && <Spinner />}
          {error && <span className="text-red-700 dark:text-red-300 text-sm">{error}</span>}
          {!isLoading && hasSearched && (
            <span className="text-gray-600 dark:text-gray-300 text-sm">
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
            </span>
          )}
          {/* announce sort to screen readers */}
          <span className="sr-only">Sorted by {sortKey}</span>
        </div>
        </SmartCard>
      </section>

      {/* Results (sticky toolbar inside the card) */}
      <section aria-labelledby="results-title" className="space-y-4">
         <SmartCard as="div" className="overflow-hidden">
          {/* Sticky header row */}
          <div className="flex items-center justify-between sticky top-0 z-10 px-3 sm:px-4 py-3 backdrop-blur-sm">
            <h2 id="results-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Results
            </h2>
            <div className="sort-toolbar flex items-center gap-2">
              <label
                htmlFor="sortKey"
                className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap"
              >
                Sort by
              </label>

              <select
                id="sortKey"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="select-pill"
                aria-label="Sort results"
              >
                <option value="original">Original</option>
                <option value="title">Title</option>
                <option value="domain">Domain</option>
              </select>
            </div>
          </div>

          {/* Results body */}
          <div className="p-2 sm:p-3">
            {(!hasSearched && searchResults.length === 0) ? (
              <div className="py-12 text-center text-gray-600 dark:text-gray-300">
                Start by entering a website and keywords above.
              </div>
            ) : (
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
            )}
          </div>
        </SmartCard>
      </section>
    </main>
  );
};

export default UrlCollectorPage;
