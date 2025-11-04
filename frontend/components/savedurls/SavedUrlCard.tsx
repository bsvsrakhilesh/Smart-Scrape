import React from 'react';
import { SavedUrl } from '../../types';
import { formatDate } from '../../utils/fileHelpers';
import { BookmarkIcon } from '../icons';
import SmartCard from '../ui/SmartCard';


interface SavedUrlCardProps {
  url: SavedUrl;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onFavoriteToggle: (url: SavedUrl) => void;
  onOpenDetail: (url: SavedUrl) => void;
  onCapture?: (url: SavedUrl, mode: 'text' | 'pdf') => void;
}

/** Theme-friendly color for any tag (semantic rules + deterministic fallback). */
function chipClassForTag(tagRaw: string): string {
  const tag = (tagRaw || '').toLowerCase().trim();

  // semantic shortcuts
  if (/(urgent|important|priority|alert)/.test(tag)) return 'chip-rose';
  if (/(bug|error|failure|sev)/.test(tag)) return 'chip-red';
  if (/(todo|next|backlog|task)/.test(tag)) return 'chip-amber';
  if (/(ai|ml|nlp|llm|cv)/.test(tag)) return 'chip-violet';
  if (/(research|paper|study|literature)/.test(tag)) return 'chip-indigo';
  if (/(iaq|air|ventilation|co2|env|climate)/.test(tag)) return 'chip-emerald';
  if (/(dev|code|frontend|backend|api|build)/.test(tag)) return 'chip-blue';
  if (/(news|press|article|blog)/.test(tag)) return 'chip-sky';
  if (/(design|ux|ui)/.test(tag)) return 'chip-fuchsia';

  // deterministic fallback based on hash
  const palette = [
    'chip-green','chip-emerald','chip-lime','chip-yellow','chip-amber','chip-orange',
    'chip-red','chip-rose','chip-pink','chip-fuchsia','chip-purple','chip-violet',
    'chip-indigo','chip-blue','chip-sky','chip-cyan','chip-teal','chip-slate','chip-gray'
  ];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) - h) + tag.charCodeAt(i);
  const idx = Math.abs(h) % palette.length;
  return palette[idx];
}

const SavedUrlCard: React.FC<SavedUrlCardProps> = ({
  url,
  selected = false,
  onSelect,
  onFavoriteToggle,
  onOpenDetail,
  onCapture,
}) => {
  // Shared button shape: rectangular with rounded corners + consistent height
  const rectBtn = 'rounded-lg h-10 w-full flex items-center justify-center text-sm font-medium';

  const textBtn =
    'btn-ghost ' +
    'bg-violet-50 text-violet-700 hover:bg-violet-100 ' +
    'dark:bg-violet-900/30 dark:text-violet-200 dark:hover:bg-violet-800/40';

  const pdfBtn =
    'btn-ghost ' +
    'bg-rose-50 text-rose-700 hover:bg-rose-100 ' +
    'dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-800/40';

  const detailsBtn =
    'btn-ghost ' +
    'bg-slate-50 text-slate-700 hover:bg-slate-100 ' +
    'dark:bg-slate-900/30 dark:text-slate-200 dark:hover:bg-slate-800/40';

  return (
    <SmartCard
    as="article"
    className={[
      "p-6 relative",
      selected ? "ring-2 ring-[var(--color-accent)]" : "ring-0"
    ].join(" ")}
    >
      {/* Optional selection checkbox */}
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(url.id)}
          aria-label="Select saved URL"
          className="absolute top-3 left-3 h-4 w-4"
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        {url.faviconUrl ? (
          <img
            src={url.faviconUrl}
            alt=""
            className="mt-[2px] h-5 w-5 rounded-sm"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="mt-[2px] h-5 w-5 rounded-sm bg-gray-200" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <a
              href={url.url}
              target="_blank"
              rel="noreferrer"
              title={url.title}
              className="truncate text-lg font-semibold text-gray-900 hover:underline dark:text-white"
            >
              {url.title}
            </a>

            <div className="shrink-0 text-right">
              <button
                onClick={() => onFavoriteToggle(url)}
                aria-label={url.isFavorited ? 'Unfavorite' : 'Favorite'}
                className={`btn-ghost px-2 py-1 ${rectBtn}`}
                title={url.isFavorited ? 'Unfavorite' : 'Favorite'}
              >
                <BookmarkIcon
                  className={[
                    'h-5 w-5',
                    url.isFavorited ? 'text-yellow-400' : 'text-gray-400 dark:text-gray-500'
                  ].join(' ')}
                />
              </button>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formatDate(url.createdAt)}
              </div>
            </div>
          </div>

          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
            {url.domain}
          </div>

          {url.description ? (
            <p className="mt-2 line-clamp-3 text-sm text-gray-700 dark:text-gray-300">
              {url.description}
            </p>
          ) : (
            <p className="mt-2 text-sm text-gray-400 dark:text-gray-500 italic">
              No description.
            </p>
          )}
        </div>
      </div>

      {/* Tags */}
      {!!url.tags?.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {url.tags.map((t) => (
            <span key={t} className={`chip ${chipClassForTag(t)}`}>{t}</span>
          ))}
        </div>
      )}

      {/* Actions: rectangular, colored buttons */}
      <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {/* Open → brand primary (solid) */}
        <button
          onClick={() => window.open(url.url, '_blank', 'noopener,noreferrer')}
          className={`btn-primary w-full ${rectBtn}`}
          title="Open in new tab"
        >
          Open
        </button>

        {/* Text / PDF → soft tinted buttons */}
        {onCapture ? (
          <>
            <button
              onClick={() => onCapture(url, 'text')}
              className={`${textBtn} w-full ${rectBtn}`}
              title="Capture as clean .txt"
            >
              Text
            </button>
            <button
              onClick={() => onCapture(url, 'pdf')}
              className={`${pdfBtn} w-full ${rectBtn}`}
              title="Capture as PDF snapshot"
            >
              PDF
            </button>
          </>
        ) : (
          <>
            <div className={`invisible ${textBtn} w-full ${rectBtn}`}>Text</div>
            <div className={`invisible ${pdfBtn} w-full ${rectBtn}`}>PDF</div>
          </>
        )}

        {/* Details → neutral tinted button */}
        <button
          onClick={() => onOpenDetail(url)}
          className={`${detailsBtn} w-full ${rectBtn}`}
          title="Show details"
        >
           Details 
        </button>
      </div>
    </SmartCard>
  );
};

export default SavedUrlCard;
