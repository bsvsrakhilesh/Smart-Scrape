import React from 'react';

interface Props {
  className?: string;
  ariaLabel?: string;
}

const BookmarkIcon: React.FC<Props> = ({ className = '', ariaLabel = 'bookmark' }) => (
  <svg
    aria-label={ariaLabel}
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M6 4a2 2 0 0 0-2 2v16l8-5.333L20 22V6a2 2 0 0 0-2-2H6z" />
  </svg>
);

export default BookmarkIcon;

