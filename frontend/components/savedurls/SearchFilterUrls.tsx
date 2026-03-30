import React, { useState, useEffect } from "react";

export interface UrlFilterState {
  query: string;
  domains: string[];
  tags: string[];
  visibility: "all" | "public" | "private" | "shared";
  dateFrom?: string;
  dateTo?: string;
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

  useEffect(() => {
    const next = buildFilterState(initial);
    if (filterStateSignature(next) !== filterStateSignature(state)) {
      setState(next);
    }
  }, [initial, state]);

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
    <div className="space-y-4">
      {/* Search row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <label className="sr-only" htmlFor="saved-urls-query">
          Search saved URLs
        </label>
        <input
          id="saved-urls-query"
          name="saved_urls_query"
          aria-label="Search saved URLs"
          type="text"
          placeholder=" Search by title, URL, tags..."
          value={state.query}
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
          className="input flex-1 rounded-lg shadow-sm focus:ring-2 focus:ring-brand-primary/40"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            disabled={isLoading}
            onClick={() => onChange(state)}
            className="btn-primary rounded-lg px-4 py-2 disabled:opacity-60"
            aria-label="Search"
            title="Search"
          >
            {isLoading ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {/* Filters grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
        {/* Domains */}
        <div className="card p-3">
          <div className="font-semibold mb-2">Domains</div>
          <div className="flex flex-wrap gap-2 min-w-0">
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
        <div className="card p-3">
          <div className="font-semibold mb-2">Tags</div>
          <div className="flex flex-wrap gap-2 min-w-0">
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

        {/* Other */}
        <div className="card p-3">
          <div className="font-semibold mb-2">Other</div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
                <label
                  className="block text-xs mb-1"
                  htmlFor="saved-urls-date-from"
                >
                  From
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
                  To
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
                <option value="all">All</option>
                <option value="missing">Missing</option>
                <option value="stale">Stale</option>
                <option value="fresh">Has snapshot</option>
              </select>
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
                Visibility
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
                <option value="all">All</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="shared">Shared</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchFilterUrls;
