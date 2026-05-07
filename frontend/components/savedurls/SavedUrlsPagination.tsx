import React from "react";

type Props = {
  isReviewQueueActive: boolean;
  page: number;
  pageSize: number;
  totalPages: number;
  totalResults: number;
  visibleCount: number;
  onPrevious: () => void;
  onNext: () => void;
};

const SavedUrlsPagination: React.FC<Props> = ({
  isReviewQueueActive,
  page,
  pageSize,
  totalPages,
  totalResults,
  visibleCount,
  onPrevious,
  onNext,
}) => {
  if (totalResults <= 0) return null;

  const firstRow = visibleCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalResults);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 px-4 py-3 md:flex-row md:items-center md:justify-between dark:border-white/10">
      <div className="text-sm text-neutral-600 dark:text-neutral-300">
        {isReviewQueueActive ? (
          <>
            Showing <span className="font-medium">{visibleCount}</span>{" "}
            updated-since-review URLs on this page out of{" "}
            <span className="font-medium">{totalResults}</span> across all
            pages.
          </>
        ) : (
          <>
            Showing <span className="font-medium">{firstRow}</span> -{" "}
            <span className="font-medium">{lastRow}</span> of{" "}
            <span className="font-medium">{totalResults}</span> matching URLs
            across all pages
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
          onClick={onPrevious}
          disabled={page <= 1}
        >
          Previous
        </button>

        <span className="text-sm text-neutral-600 dark:text-neutral-300">
          Page <span className="font-medium">{page}</span> of{" "}
          <span className="font-medium">{totalPages}</span>
        </span>

        <button
          type="button"
          className="rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
          onClick={onNext}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default SavedUrlsPagination;
