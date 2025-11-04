import React from 'react';
import { formatBytes } from '../../utils/fileHelpers';

type StatusBarProps = {
  selectedCount: number;
  totalCount: number;
  totalSize: number;
  /** number of items currently visible after filters/search/pagination */
  filteredCount?: number;
  /** total byte size of selected items */
  selectedSize?: number;
};

const StatusBar: React.FC<StatusBarProps> = ({
  selectedCount,
  totalCount,
  totalSize,
  filteredCount,
  selectedSize,
}) => {
  const left = selectedCount > 0
    ? `${selectedCount} item${selectedCount !== 1 ? 's' : ''} selected` +
      (selectedSize ? ` • ${formatBytes(selectedSize)}` : '')
    : (filteredCount != null && filteredCount !== totalCount)
      ? `${filteredCount} visible • ${totalCount} total`
      : `${totalCount} item${totalCount !== 1 ? 's' : ''} total`;

  return (
    <div className="flex items-center justify-between p-3 bg-surface-elevated border-t border-border text-sm text-muted">
      <div>{left}</div>
      <div>{formatBytes(totalSize)}</div>
    </div>
  );
};

export default StatusBar;
