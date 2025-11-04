import React from 'react';

interface Props {
  className?: string;
  ariaLabel?: string;
}

const HomeIcon: React.FC<Props> = ({
  className = '',
  ariaLabel = 'home',
}) => (
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
    {/* Roof */}
    <path d="M3 12l9-9 9 9" />
    {/* Walls */}
    <path d="M9 21V12h6v9" />
  </svg>
);

export default HomeIcon;
