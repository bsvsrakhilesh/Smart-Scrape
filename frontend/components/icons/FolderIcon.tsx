import React from 'react';

interface Props {
  className?: string;
  ariaLabel?: string;
}

const FolderIcon: React.FC<Props> = ({ className = '', ariaLabel = 'folder' }) => (
  <svg
    aria-label={ariaLabel}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7h5l2 3h11v9H3V7z" />
    <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2" />
  </svg>
);

export default FolderIcon;

