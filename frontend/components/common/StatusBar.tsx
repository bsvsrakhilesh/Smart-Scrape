import React from 'react';
import { formatBytes } from '../../utils/fileHelpers';

type StatusBarProps = {
  selectedCount: number;
  totalCount: number;
  totalSize: number;
};

const StatusBar: React.FC<StatusBarProps> = ({ selectedCount, totalCount, totalSize }) => {
  return (
    <div className="flex items-center justify-between p-3 bg-surface-elevated border-t border-border text-sm text-muted">
      <div>
        {selectedCount > 0
          ? `${selectedCount} item${selectedCount !== 1 ? 's' : ''} selected`
          : `${totalCount} item${totalCount !== 1 ? 's' : ''} total`}
      </div>
      <div>{formatBytes(totalSize)}</div>
    </div>
  );
};

export default StatusBar;
