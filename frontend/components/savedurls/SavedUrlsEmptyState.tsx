import React from "react";

type Props = {
  libraryTotalCount: number;
  isReviewQueueActive: boolean;
};

const SavedUrlsEmptyState: React.FC<Props> = ({
  libraryTotalCount,
  isReviewQueueActive,
}) => {
  let title = "No rows on this page match the current filters.";
  let body =
    "Try clearing filters, switching queues, or choosing a different collection.";

  if (libraryTotalCount === 0) {
    title = "No saved URLs yet.";
    body = "Paste a URL above and press Enter to save your first one.";
  } else if (isReviewQueueActive) {
    title = "No URLs in this scope have changed since your review stamp.";
    body =
      "Change filters, switch queues, or mark this page as reviewed again after new changes land.";
  }

  return (
    <div className="card p-10 text-center text-gray-600 dark:text-gray-300">
      <div className="space-y-2">
        <div className="font-medium text-gray-800 dark:text-gray-100">
          {title}
        </div>
        <div>{body}</div>
      </div>
    </div>
  );
};

export default SavedUrlsEmptyState;
