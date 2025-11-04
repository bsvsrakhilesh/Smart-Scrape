import React, { useEffect, useMemo, useState } from 'react';

export type FilterState = {
  query: string;
  fileTypes: string[];        // e.g. "image/", "application/pdf"
  tags: string[];             // tag ids/labels
  dateFrom?: string;          // ISO yyyy-mm-dd
  dateTo?: string;            // ISO yyyy-mm-dd
  visibility: 'all' | 'private' | 'public';
  favoritesOnly: boolean;     // show only favorited files
};

type FileTypeOption = { mime: string; label: string };
type TagOption = { id: string; label: string } | string;

type Props = {
  initial: FilterState;
  availableFileTypes: FileTypeOption[];
  availableTags: TagOption[];
  onChange: (next: FilterState) => void;
  className?: string;
};

const isTagObj = (t: TagOption): t is { id: string; label: string } =>
  typeof t !== 'string';

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
    {children}
  </div>
);

const Help: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{children}</div>
);

const ChipToggle: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      'px-3 py-1.5 rounded-full text-[13px] transition w-fit',
      active
        ? 'bg-brand text-white'
        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-neutral-700',
    ].join(' ')}
  >
    {children}
  </button>
);

const SearchFilter: React.FC<Props> = ({
  initial,
  availableFileTypes,
  availableTags,
  onChange,
  className = '',
}) => {
  const [state, setState] = useState<FilterState>(initial);

  // Debounced emit
  useEffect(() => {
    const t = setTimeout(() => onChange(state), 150);
    return () => clearTimeout(t);
  }, [state, onChange]);

  const anyActive = useMemo(
    () =>
      !!state.query ||
      state.fileTypes.length > 0 ||
      state.tags.length > 0 ||
      !!state.dateFrom ||
      !!state.dateTo ||
      state.visibility !== 'all' ||
      state.favoritesOnly,
    [state]
  );

  const toggleFileType = (mime: string) =>
    setState((s) =>
      s.fileTypes.includes(mime)
        ? { ...s, fileTypes: s.fileTypes.filter((m) => m !== mime) }
        : { ...s, fileTypes: [...s.fileTypes, mime] }
    );

  const toggleTag = (id: string) =>
    setState((s) =>
      s.tags.includes(id)
        ? { ...s, tags: s.tags.filter((t) => t !== id) }
        : { ...s, tags: [...s.tags, id] }
    );

  const resetAll = () =>
    setState({
      query: '',
      fileTypes: [],
      tags: [],
      dateFrom: undefined,
      dateTo: undefined,
      visibility: 'all',
      favoritesOnly: false,
    });

  return (
    <div className={`card p-4 ${className}`}>
      {/* Search */}
      <label className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1 block" htmlFor="fm-search">
        Search
      </label>
      <input
        id="fm-search"
        className="input-pill w-full text-sm py-2 px-3"
        placeholder="Title, description, tag…"
        value={state.query}
        onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
      />
      <div className="mt-2 flex items-center gap-2 ">
        <button className="btn-primary flex-1" onClick={() => onChange(state)}>Search</button>
        <button className="btn-ghost" onClick={resetAll} disabled={!anyActive}>Reset</button>
      </div>

      {/* File Types */}
      <div className="mt-5">
        <SectionTitle>File Types</SectionTitle>
        <div className="mt-2 flex flex-wrap gap-2">
          {availableFileTypes.length ? (
            availableFileTypes.map((ft) => {
              const active = state.fileTypes.includes(ft.mime);
              return (
                <ChipToggle key={ft.mime} active={active} onClick={() => toggleFileType(ft.mime)}>
                  {ft.label}
                </ChipToggle>
              );
            })
          ) : (
            <Help>No file type filters available.</Help>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="mt-5">
        <SectionTitle>Tags</SectionTitle>
        <div className="mt-2 flex flex-wrap gap-2">
          {availableTags.length ? (
            availableTags.map((t) => {
              const id = isTagObj(t) ? t.id : t;
              const label = isTagObj(t) ? t.label : t;
              const active = state.tags.includes(id);
              return (
                <ChipToggle key={id} active={active} onClick={() => toggleTag(id)}>
                  {label}
                </ChipToggle>
              );
            })
          ) : (
            <Help>No tags defined.</Help>
          )}
        </div>
      </div>

      {/* Modified Date */}
      <div className="mt-5">
        <SectionTitle>Modified Date</SectionTitle>
        <div className="mt-2">
          <label className="text-[12px] text-neutral-500 mb-1 block" htmlFor="fm-date-from">From</label>
          <input
            id="fm-date-from"
            type="date"
            className="input-pill w-full text-sm py-2 px-3"
            value={state.dateFrom || ''}
            onChange={(e) => setState((s) => ({ ...s, dateFrom: e.target.value || undefined }))}
          />
        </div>
        <div className="mt-3">
          <label className="text-[12px] text-neutral-500 mb-1 block" htmlFor="fm-date-to">To</label>
          <input
            id="fm-date-to"
            type="date"
            className="input-pill w-full text-sm py-2 px-3"
            value={state.dateTo || ''}
            onChange={(e) => setState((s) => ({ ...s, dateTo: e.target.value || undefined }))}
          />
        </div>
        <Help>Filter by last modified date (inclusive).</Help>
      </div>

      {/* Visibility */}
      <div className="mt-5">
        <SectionTitle>Visibility</SectionTitle>
        <select
          className="input-pill w-full text-sm py-2 px-3 mt-2"
          value={state.visibility}
          onChange={(e) =>
            setState((s) => ({ ...s, visibility: e.target.value as FilterState['visibility'] }))
          }
        >
          <option value="all">All</option>
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
        <Help>Show files by visibility.</Help>
      </div>

      {/* Favorites */}
      <div className="mt-5">
        <SectionTitle>Favorites</SectionTitle>
        <label className="inline-flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={state.favoritesOnly}
            onChange={(e) =>
              setState((s) => ({ ...s, favoritesOnly: e.target.checked }))
            }
            className="rounded"
          />
          <span className="text-sm">Show favorites only</span>
        </label>
        <Help>Filter to show only favorited files.</Help>
      </div>

      {/* Active summary pills (wrap neatly in narrow width) */}
      {anyActive && (
        <div className="mt-5 flex flex-wrap gap-2">
          {state.query && <span className="badge">q: {state.query}</span>}
          {state.fileTypes.map((m) => <span key={m} className="badge">{m}</span>)}
          {state.tags.map((t) => <span key={t} className="badge">{t}</span>)}
          {(state.dateFrom || state.dateTo) && (
            <span className="badge">
              {state.dateFrom || '…'} → {state.dateTo || '…'}
            </span>
          )}
          {state.visibility !== 'all' && <span className="badge">vis: {state.visibility}</span>}
          {state.favoritesOnly && <span className="badge">favorites only</span>}
        </div>
      )}
    </div>
  );
};

export default SearchFilter;
