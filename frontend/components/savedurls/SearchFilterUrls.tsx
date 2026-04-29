import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useDebounce } from "../../hooks/useDebounce";

export interface UrlFilterState {
  query: string;
  domains: string[];
  tags: string[];
  visibility: "all" | "public" | "private";
  dateFrom?: string;
  dateTo?: string;
  publishedFrom?: string;
  publishedTo?: string;
  favoritesOnly: boolean;
  snapshotStatus?: "all" | "missing" | "stale" | "fresh";
  taggingStatus?: "all" | "NONE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  metadataState?: "all" | "missing" | "complete";
}

interface SearchFilterUrlsProps {
  availableDomains: string[];
  availableTags: string[];
  initial?: Partial<UrlFilterState>;
  onChange: (state: UrlFilterState) => void;
  isLoading?: boolean;
}

const buildFilterState = (
  initial: Partial<UrlFilterState> = {},
): UrlFilterState => ({
  query: initial.query || "",
  domains: initial.domains || [],
  tags: initial.tags || [],
  visibility: initial.visibility || "all",
  dateFrom: initial.dateFrom,
  dateTo: initial.dateTo,
  publishedFrom: initial.publishedFrom,
  publishedTo: initial.publishedTo,
  favoritesOnly: initial.favoritesOnly || false,
  snapshotStatus: initial.snapshotStatus || "all",
  taggingStatus: initial.taggingStatus || "all",
  metadataState: initial.metadataState || "all",
});

const filterStateSignature = (state: UrlFilterState) =>
  JSON.stringify({
    ...state,
    domains: [...(state.domains || [])].sort(),
    tags: [...(state.tags || [])].sort(),
  });

const countActiveFilters = (state: UrlFilterState) => {
  let count = 0;

  if (state.query.trim()) count += 1;
  if (state.domains.length) count += 1;
  if (state.tags.length) count += 1;
  if (state.visibility !== "all") count += 1;
  if (state.dateFrom) count += 1;
  if (state.dateTo) count += 1;
  if (state.publishedFrom) count += 1;
  if (state.publishedTo) count += 1;
  if (state.favoritesOnly) count += 1;
  if ((state.snapshotStatus ?? "all") !== "all") count += 1;
  if ((state.taggingStatus ?? "all") !== "all") count += 1;
  if ((state.metadataState ?? "all") !== "all") count += 1;

  return count;
};

const countAdvancedFilters = (state: UrlFilterState) => {
  let count = 0;

  if (state.domains.length) count += 1;
  if (state.tags.length) count += 1;
  if (state.visibility !== "all") count += 1;
  if (state.dateFrom) count += 1;
  if (state.dateTo) count += 1;
  if (state.publishedFrom) count += 1;
  if (state.publishedTo) count += 1;
  if (state.favoritesOnly) count += 1;
  if ((state.snapshotStatus ?? "all") !== "all") count += 1;
  if ((state.taggingStatus ?? "all") !== "all") count += 1;
  if ((state.metadataState ?? "all") !== "all") count += 1;

  return count;
};

const SearchFilterUrls: React.FC<SearchFilterUrlsProps> = ({
  availableDomains,
  availableTags,
  initial = {},
  onChange,
  isLoading = false,
}) => {
  const [state, setState] = useState<UrlFilterState>(() =>
    buildFilterState(initial),
  );

  const debouncedState = useDebounce(state, 250);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    countAdvancedFilters(buildFilterState(initial)) > 0,
  );

  const activeFilterCount = useMemo(() => countActiveFilters(state), [state]);
  const advancedFilterCount = useMemo(
    () => countAdvancedFilters(state),
    [state],
  );

  const applyFiltersNow = useCallback(
    (next: UrlFilterState) => {
      onChange(next);
    },
    [onChange],
  );

  const clearAllFilters = useCallback(() => {
    const next = buildFilterState();
    setState(next);
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    const next = buildFilterState(initial);
    setState((prev) =>
      filterStateSignature(prev) === filterStateSignature(next) ? prev : next,
    );
    if (countAdvancedFilters(next) > 0) setAdvancedOpen(true);
  }, [initial]);

  useEffect(() => {
    const nextInitial = buildFilterState(initial);

    if (
      filterStateSignature(debouncedState) !== filterStateSignature(nextInitial)
    ) {
      onChange(debouncedState);
    }
  }, [debouncedState, initial, onChange]);

  const toggleDomain = (d: string) =>
    setState((s) => ({
      ...s,
      domains: s.domains.includes(d)
        ? s.domains.filter((x) => x !== d)
        : [...s.domains, d],
    }));

  const toggleTag = (t: string) =>
    setState((s) => ({
      ...s,
      tags: s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t],
    }));

  // small helper for selected chip styles (keeps theme)
  const chip = "chip chip-gray cursor-pointer select-none";
  const chipSelected = "ring-2 ring-brand-primary/40";

  return (
    <div className="saved-urls-filter space-y-4 min-w-0" data-search-filter>
      {/* Search row */}
      <div className="saved-urls-search-workbench">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="min-w-0">
            <label className="sr-only" htmlFor="saved-urls-query">
              Search saved URLs
            </label>

            <input
              id="saved-urls-query"
              name="saved_urls_query"
              aria-label="Search saved URLs"
              type="text"
              placeholder="Search title, URL, domain, notes, description, or exact tag"
              value={state.query}
              onChange={(e) =>
                setState((s) => ({ ...s, query: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyFiltersNow(state);
                }
              }}
              className="saved-urls-search-input input w-full min-w-0 rounded-2xl px-4 py-3 text-sm md:text-base shadow-sm focus:ring-2 focus:ring-brand-primary/40"
            />

            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              Searches title, URL, domain, description, notes, and exact user
              tags. Filters update automatically; press Enter to apply now.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5 xl:justify-end">
            <span className="rounded-full border border-black/10 dark:border-white/10 px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
              {activeFilterCount === 0
                ? "No active filters"
                : `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`}
            </span>

            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className={[
                "rounded-xl border px-4 py-3 text-sm font-medium transition hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap",
                advancedOpen || advancedFilterCount > 0
                  ? "border-brand-primary/40 bg-brand-primary/10 text-brand-primary"
                  : "border-black/10 dark:border-white/10",
              ].join(" ")}
              aria-expanded={advancedOpen}
              aria-controls="saved-urls-advanced-filters"
              title="Show or hide advanced filters"
            >
              {advancedOpen ? "Hide filters" : "Advanced filters"}
              {advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => applyFiltersNow(state)}
              className="btn-primary rounded-xl px-5 py-3 disabled:opacity-60 whitespace-nowrap"
              aria-label="Apply filters now"
              title="Apply filters now"
            >
              {isLoading ? "Applying…" : "Apply now"}
            </button>

            <button
              type="button"
              disabled={activeFilterCount === 0}
              onClick={clearAllFilters}
              className="rounded-xl border px-5 py-3 text-sm font-medium transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800 whitespace-nowrap"
              aria-label="Clear all search filters"
              title="Clear all search filters"
            >
              Reset filters
            </button>
          </div>
        </div>
      </div>

      {/* Filters grid */}
      <div
        id="saved-urls-advanced-filters"
        hidden={!advancedOpen}
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(18rem,0.95fr)] gap-4 text-sm min-w-0"
      >
        {/* Domains */}
        <div className="saved-urls-section-card min-h-[14rem] p-4">
          <div className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Domains
          </div>
          <div className="flex max-h-40 flex-wrap content-start gap-2 overflow-auto pr-1 min-w-0">
            {availableDomains.map((d) => {
              const selected = state.domains.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDomain(d)}
                  aria-pressed={selected}
                  title={d}
                  className={[
                    chip,
                    "max-w-full truncate",
                    selected
                      ? "chip-indigo text-indigo-800 dark:text-indigo-100"
                      : "",
                    selected ? chipSelected : "",
                  ].join(" ")}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tags */}
        <div className="saved-urls-section-card min-h-[14rem] p-4">
          <div className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Tags
          </div>
          <div className="flex max-h-40 flex-wrap content-start gap-2 overflow-auto pr-1 min-w-0">
            {availableTags.map((t) => {
              const selected = state.tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  aria-pressed={selected}
                  title={t}
                  className={[
                    chip,
                    "max-w-full truncate",
                    selected
                      ? "chip-emerald text-emerald-800 dark:text-emerald-100"
                      : "",
                    selected ? chipSelected : "",
                  ].join(" ")}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dates & status */}
        <div className="saved-urls-section-card min-h-[14rem] p-4">
          <div className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Dates & status
          </div>
          <div className="flex flex-col gap-3.5">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Saved date
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <label
                    className="block text-xs mb-1"
                    htmlFor="saved-urls-date-from"
                  >
                    Saved from
                  </label>
                  <input
                    id="saved-urls-date-from"
                    name="saved_urls_date_from"
                    type="date"
                    value={state.dateFrom || ""}
                    onChange={(e) =>
                      setState((s) => ({ ...s, dateFrom: e.target.value }))
                    }
                    className="input w-full rounded-lg px-3 py-2"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label
                    className="block text-xs mb-1"
                    htmlFor="saved-urls-date-to"
                  >
                    Saved to
                  </label>
                  <input
                    id="saved-urls-date-to"
                    name="saved_urls_date_to"
                    type="date"
                    value={state.dateTo || ""}
                    onChange={(e) =>
                      setState((s) => ({ ...s, dateTo: e.target.value }))
                    }
                    className="input w-full rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Published date
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <label
                    className="block text-xs mb-1"
                    htmlFor="saved-urls-published-from"
                  >
                    Published from
                  </label>
                  <input
                    id="saved-urls-published-from"
                    name="saved_urls_published_from"
                    type="date"
                    value={state.publishedFrom || ""}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        publishedFrom: e.target.value,
                      }))
                    }
                    className="input w-full rounded-lg px-3 py-2"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label
                    className="block text-xs mb-1"
                    htmlFor="saved-urls-published-to"
                  >
                    Published to
                  </label>
                  <input
                    id="saved-urls-published-to"
                    name="saved_urls_published_to"
                    type="date"
                    value={state.publishedTo || ""}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        publishedTo: e.target.value,
                      }))
                    }
                    className="input w-full rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Saved date uses when the URL entered your library. Published date
              uses the source metadata and may be missing for some URLs.
            </p>

            <label className="inline-flex items-center gap-2">
              <input
                id="saved-urls-favorites-only"
                name="saved_urls_favorites_only"
                type="checkbox"
                checked={state.favoritesOnly}
                onChange={(e) =>
                  setState((s) => ({ ...s, favoritesOnly: e.target.checked }))
                }
              />
              Favorites only
            </label>

            <div>
              <label
                className="block text-xs mb-1"
                htmlFor="saved-urls-snapshot-status"
              >
                Snapshots
              </label>
              <select
                id="saved-urls-snapshot-status"
                name="saved_urls_snapshot_status"
                value={state.snapshotStatus || "all"}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    snapshotStatus: e.target.value as any,
                  }))
                }
                className="input w-full rounded-lg px-3 py-2"
              >
                <option value="all">All snapshots</option>
                <option value="missing">Missing snapshot</option>
                <option value="stale">Stale snapshot (&gt;30d)</option>
                <option value="fresh">Fresh snapshot (≤30d)</option>
              </select>

              <p className="mt-1 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
                Fresh means a URL snapshot captured within the last 30 days.
              </p>
            </div>

            <div>
              <label
                className="block text-xs mb-1"
                htmlFor="saved-urls-tagging-status"
              >
                AI tagging
              </label>
              <select
                id="saved-urls-tagging-status"
                name="saved_urls_tagging_status"
                value={state.taggingStatus || "all"}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    taggingStatus: e.target
                      .value as UrlFilterState["taggingStatus"],
                  }))
                }
                className="input w-full rounded-lg px-3 py-2"
              >
                <option value="all">All statuses</option>
                <option value="NONE">Not started</option>
                <option value="PENDING">Queued</option>
                <option value="RUNNING">Running</option>
                <option value="SUCCESS">Succeeded</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>

            <div>
              <label
                className="block text-xs mb-1"
                htmlFor="saved-urls-metadata-state"
              >
                Metadata
              </label>
              <select
                id="saved-urls-metadata-state"
                name="saved_urls_metadata_state"
                value={state.metadataState || "all"}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    metadataState: e.target
                      .value as UrlFilterState["metadataState"],
                  }))
                }
                className="input w-full rounded-lg px-3 py-2"
              >
                <option value="all">All metadata</option>
                <option value="missing">Missing key metadata</option>
                <option value="complete">Metadata complete</option>
              </select>
            </div>

            <div>
              <label
                className="block text-xs mb-1"
                htmlFor="saved-urls-visibility"
              >
                Access
              </label>
              <select
                id="saved-urls-visibility"
                name="saved_urls_visibility"
                value={state.visibility}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    visibility: e.target.value as UrlFilterState["visibility"],
                  }))
                }
                className="input w-full rounded-lg px-3 py-2"
              >
                <option value="all">All access levels</option>
                <option value="private">Private only</option>
                <option value="public">Public only</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchFilterUrls;
