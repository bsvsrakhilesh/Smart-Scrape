import React from 'react';

interface Props {
  className?: string;
  ariaLabel?: string;
}

const DownloadIcon: React.FC<Props> = ({ className = '', ariaLabel = 'download' }) => (
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
    <path d="M4 17h16" />
    <path d="M12 3v12" />
    <polyline points="8 11 12 15 16 11" />
  </svg>
);

export default DownloadIcon;
