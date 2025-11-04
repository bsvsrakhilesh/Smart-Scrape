import React from 'react';

type SpinnerProps = {
  size?: number;          // optional (backwards-compatible)
  className?: string;     // optional (backwards-compatible)
};

const Spinner: React.FC<SpinnerProps> = ({ size = 16, className }) => {
  const s = Math.max(12, size);
  const r = s / 2 - 2; // radius with stroke padding

  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center ${className || ''}`}>
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        className="uc-spin"
        aria-hidden="true"
      >
        <circle
          cx={s / 2}
          cy={s / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="2"
        />
        <circle
          cx={s / 2}
          cy={s / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${Math.PI * r}, ${Math.PI * r}`}
          strokeDashoffset={Math.PI * r * 0.75}
        />
      </svg>
      <span className="sr-only">Loading…</span>
    </span>
  );
};

export default Spinner;
