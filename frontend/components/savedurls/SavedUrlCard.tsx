import React from "react";
import { SavedUrl } from "../../lib/types";
import { recordUrlVisit } from "../../lib/api";
import { formatDate } from "../../utils/fileHelpers";
import { BookmarkIcon } from "../icons";
import SmartCard from "../ui/SmartCard";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SavedUrlCardProps {
  url: SavedUrl;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onFavoriteToggle: (url: SavedUrl) => void;
  onOpenDetail: (url: SavedUrl) => void;
  onCapture?: (url: SavedUrl, mode: "text" | "pdf") => void;
}

// Heuristic: treat as PDF if URL path ends with .pdf OR query contains ".pdf"
function isPdfUrlLike(raw: string): boolean {
  try {
    const u = new URL(raw);
    const path = (u.pathname || "").toLowerCase();
    const q = (u.search || "").toLowerCase();
    return path.endsWith(".pdf") || q.includes(".pdf");
  } catch {
    // fallback: very light heuristic
    const s = (raw || "").toLowerCase();
    return s.includes(".pdf");
  }
}

function trackSavedUrlVisit(urlId: string) {
  const numericId = Number(urlId);
  if (!Number.isFinite(numericId)) return;
  void recordUrlVisit(numericId).catch(() => {});
}

function openSavedUrlInNewTab(url: SavedUrl) {
  trackSavedUrlVisit(url.id);
  window.open(url.url, "_blank", "noopener,noreferrer");
}

/** Theme-friendly color for any tag (semantic rules + deterministic fallback). */
function chipClassForTag(tagRaw: string): string {
  const tag = (tagRaw || "").toLowerCase().trim();

  // semantic shortcuts
  if (/(urgent|important|priority|alert)/.test(tag)) return "chip-rose";
  if (/(bug|error|failure|sev)/.test(tag)) return "chip-red";
  if (/(todo|next|backlog|task)/.test(tag)) return "chip-amber";
  if (/(ai|ml|nlp|llm|cv)/.test(tag)) return "chip-violet";
  if (/(research|paper|study|literature)/.test(tag)) return "chip-indigo";
  if (/(iaq|air|ventilation|co2|env|climate)/.test(tag)) return "chip-emerald";
  if (/(dev|code|frontend|backend|api|build)/.test(tag)) return "chip-blue";
  if (/(news|press|article|blog)/.test(tag)) return "chip-sky";
  if (/(design|ux|ui)/.test(tag)) return "chip-fuchsia";

  // deterministic fallback based on hash
  const palette = [
    "chip-green",
    "chip-emerald",
    "chip-lime",
    "chip-yellow",
    "chip-amber",
    "chip-orange",
    "chip-red",
    "chip-rose",
    "chip-pink",
    "chip-fuchsia",
    "chip-purple",
    "chip-violet",
    "chip-indigo",
    "chip-blue",
    "chip-sky",
    "chip-cyan",
    "chip-teal",
    "chip-slate",
    "chip-gray",
  ];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h << 5) - h + tag.charCodeAt(i);
  const idx = Math.abs(h) % palette.length;
  return palette[idx];
}

function freshnessChip(u: SavedUrl) {
  const s = (u as any).latestSnapshot as any | null | undefined;

  if (!s?.createdAt) {
    return {
      label: "No snapshot",
      cls: "chip-amber",
      title: "No snapshot captured yet",
    };
  }

  const ageMs = Date.now() - new Date(s.createdAt).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));

  if (ageMs > SNAPSHOT_STALE_DAYS * DAY_MS) {
    return {
      label: `Stale ${ageDays}d`,
      cls: "chip-rose",
      title: `Snapshot is older than ${SNAPSHOT_STALE_DAYS} days`,
    };
  }

  return {
    label: `Fresh ${ageDays}d`,
    cls: "chip-emerald",
    title: "Snapshot is recent",
  };
}

function aiStatusChip(u: SavedUrl) {
  const s = (u as any).taggingStatus as string | undefined;

  if (!s || s === "NONE") {
    return {
      label: "Not tagged",
      cls: "chip-gray",
      title: "No AI tags yet",
    };
  }

  if (s === "SUCCESS") {
    return {
      label: "Tagged",
      cls: "chip-emerald",
      title: "AI tagging complete",
    };
  }

  if (s === "PENDING") {
    return {
      label: "Queued",
      cls: "chip-slate",
      title: "Queued for AI tagging",
    };
  }

  if (s === "RUNNING") {
    return {
      label: "Running",
      cls: "chip-sky",
      title: "AI tagging in progress",
    };
  }

  if (s === "FAILED") {
    return {
      label: "Failed",
      cls: "chip-red",
      title: (u as any).taggingError || "AI tagging failed",
    };
  }

  return {
    label: s,
    cls: "chip-gray",
    title: s,
  };
}

function snapshotChip(u: SavedUrl) {
  const s = (u as any).latestSnapshot as any | null | undefined;
  if (!s) return null;

  const kind =
    s.captureType === "URL_PDF"
      ? "PDF"
      : s.captureType === "URL_TEXT"
        ? "Text"
        : "Upload";

  return {
    label: `Snapshot: ${kind} • ${formatDate(s.createdAt)}`,
    cls:
      s.captureType === "URL_PDF"
        ? "chip-rose"
        : s.captureType === "URL_TEXT"
          ? "chip-violet"
          : "chip-slate",
    title: s.fileName,
  };
}

const SavedUrlCard: React.FC<SavedUrlCardProps> = ({
  url,
  selected = false,
  onSelect,
  onFavoriteToggle,
  onOpenDetail,
  onCapture,
}) => {
  const isPdf = isPdfUrlLike(url.url);
  const freshness = freshnessChip(url);
  const ai = aiStatusChip(url);
  const publishedLabel = url.publishedAt
    ? formatDate(url.publishedAt)
    : "Not set";

  const visibleTags = url.tags?.slice(0, 6) ?? [];
  const hiddenTagCount = Math.max(
    0,
    (url.tags?.length ?? 0) - visibleTags.length,
  );

  // Shared button shape: rectangular with rounded corners + consistent height
  const rectBtn =
    "rounded-lg h-10 w-full min-w-0 flex items-center justify-center text-sm font-medium";

  const textBtn =
    "btn-ghost " +
    "bg-violet-50 text-violet-700 hover:bg-violet-100 " +
    "dark:bg-violet-900/30 dark:text-violet-200 dark:hover:bg-violet-800/40";

  const pdfBtn =
    "btn-ghost " +
    "bg-rose-50 text-rose-700 hover:bg-rose-100 " +
    "dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-800/40";

  const detailsBtn =
    "btn-ghost " +
    "bg-slate-50 text-slate-700 hover:bg-slate-100 " +
    "dark:bg-slate-900/30 dark:text-slate-200 dark:hover:bg-slate-800/40";

  return (
    <SmartCard
      as="article"
      className={[
        "p-6 relative",
        selected ? "ring-2 ring-[var(--color-accent)]" : "ring-0",
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
              rel="noopener noreferrer"
              onClick={() => trackSavedUrlVisit(url.id)}
              title={url.title}
              className="truncate text-lg font-semibold text-gray-900 hover:underline dark:text-white"
            >
              {url.title}
            </a>

            <div className="shrink-0 text-right">
              <button
                onClick={() => onFavoriteToggle(url)}
                aria-label={url.isFavorited ? "Unfavorite" : "Favorite"}
                className={`btn-ghost px-2 py-1 ${rectBtn}`}
                title={url.isFavorited ? "Unfavorite" : "Favorite"}
              >
                <BookmarkIcon
                  className={[
                    "h-5 w-5",
                    url.isFavorited
                      ? "text-yellow-400"
                      : "text-gray-400 dark:text-gray-500",
                  ].join(" ")}
                />
              </button>
              <div
                className="mt-1 text-xs text-gray-500 dark:text-gray-400"
                title={url.createdAt}
              >
                Saved {formatDate(url.createdAt)}
              </div>
            </div>
          </div>

          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
            {url.domain}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className="chip chip-slate"
              title={url.publishedAt || "No published date"}
            >
              Published: {publishedLabel}
            </span>

            <span className={`chip ${freshness.cls}`} title={freshness.title}>
              {freshness.label}
            </span>

            <span className={`chip ${ai.cls}`} title={ai.title}>
              AI: {ai.label}
            </span>
          </div>

          {(() => {
            const chip = snapshotChip(url);
            if (!chip) {
              return (
                <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  No snapshot yet
                </div>
              );
            }
            return (
              <div className="mt-2">
                <span className={`chip ${chip.cls}`} title={chip.title}>
                  {chip.label}
                </span>
              </div>
            );
          })()}

          {url.description ? (
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-gray-700 dark:text-gray-300">
              {url.description}
            </p>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-gray-500 italic">
              No description.
            </p>
          )}
        </div>
      </div>

      {/* Tags */}
      {!!visibleTags.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {visibleTags.map((t) => (
            <span key={t} className={`chip ${chipClassForTag(t)}`}>
              {t}
            </span>
          ))}
          {hiddenTagCount > 0 && (
            <span
              className="chip chip-gray"
              title={`${hiddenTagCount} more tag${hiddenTagCount === 1 ? "" : "s"}`}
            >
              +{hiddenTagCount} more
            </span>
          )}
        </div>
      )}

      {/* Actions: rectangular, colored buttons */}
      <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {/* Open → brand primary (solid) */}
        <button
          onClick={() => openSavedUrlInNewTab(url)}
          className={`btn-primary w-full ${rectBtn}`}
          title="Open in new tab"
        >
          Open
        </button>

        {/* Text / PDF → soft tinted buttons */}
        {onCapture ? (
          <>
            <button
              onClick={() => {
                if (isPdf) return;
                onCapture(url, "text");
              }}
              disabled={isPdf}
              aria-disabled={isPdf}
              className={[
                `${textBtn} w-full ${rectBtn}`,
                isPdf ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
              title={
                isPdf
                  ? "Text capture disabled for PDF links"
                  : "Capture as clean .txt"
              }
            >
              Text
            </button>

            <button
              onClick={() => onCapture(url, "pdf")}
              className={`${pdfBtn} w-full ${rectBtn}`}
              title={
                isPdf ? "Download original PDF" : "Capture as PDF snapshot"
              }
            >
              {isPdf ? "PDF" : "PDF"}
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
