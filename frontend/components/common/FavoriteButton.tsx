import React, { useState } from "react";

type Size = "sm" | "md";
type Variant = "ghost" | "solid";

type Props = {
  /** current state from parent */
  isOn: boolean;
  /** show count to the right of the star */
  count?: number;
  /** parent toggler (may be async). Optimistic state is handled in parent;
   * this component just blocks repeats & shows a spinner while pending. */
  onToggle: () => void | Promise<void>;
  size?: Size;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
  /** Useful to override the default tooltip text */
  title?: string;
};

export default function FavoriteButton({
  isOn,
  count,
  onToggle,
  size = "md",
  variant = "ghost",
  className = "",
  disabled = false,
  title,
}: Props) {
  const [pending, setPending] = useState(false);

  const handle = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || pending) return;
    try {
      setPending(true);
      await onToggle();
    } finally {
      setPending(false);
    }
  };

  const base =
    "inline-flex items-center gap-1.5 rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
  const pad = size === "sm" ? "px-1.5 py-1" : "px-2 py-1.5";
  const ghost =
    "border border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const solid =
    isOn
      ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300"
      : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200";
  const cls =
    base +
    " " +
    pad +
    " " +
    (variant === "solid" ? solid : ghost) +
    (className ? " " + className : "");

  const sz = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const starCls = isOn
    ? "text-yellow-500"
    : "text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300";

  return (
    <button
      type="button"
      onClick={handle}
      aria-pressed={isOn}
      aria-label={isOn ? "Remove from favorites" : "Add to favorites"}
      title={
        title ?? (isOn ? "Remove from favorites (F)" : "Add to favorites (F)")
      }
      className={`group ${cls}`}
      disabled={disabled || pending}
    >
      {/* Star icon (filled when on) */}
      <svg
        className={`${sz} ${starCls} ${pending ? "opacity-60" : ""}`}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {isOn ? (
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
        ) : (
          <path d="M22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28L5.5 10.5l4.38-.38L12 6.1l2.12 4.02 4.38.38-3.74 2.89 1 4.28L12 15.4z" />
        )}
      </svg>

      {typeof count === "number" && (
        <span className="text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
          {count}
        </span>
      )}

      {pending && (
        <svg
          className={`animate-spin ${sz} text-neutral-400`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
