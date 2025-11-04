// frontend/components/ui/PlusButton.tsx
"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

type Variant = "solid" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

export type PlusButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

/** Additive-only button. No breaking props. */
export const PlusButton = React.forwardRef<HTMLButtonElement, PlusButtonProps>(
  (
    {
      className,
      children,
      loading,
      disabled,
      variant = "solid",
      size = "md",
      fullWidth,
      ...rest
    },
    ref
  ) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-xl transition-all select-none " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] " +
      "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)] " +
      "active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed";

    const variants: Record<Variant, string> = {
      solid:
        "bg-[var(--color-accent)] text-[var(--color-accent-foreground)] " +
        "hover:brightness-95 border border-transparent",
      outline:
        "bg-transparent text-[var(--color-foreground)] border border-border " +
        "hover:bg-[color-mix(in_oklab,var(--color-foreground),transparent_96%)]",
      ghost:
        "bg-transparent text-[var(--color-foreground)] border border-transparent " +
        "hover:bg-[color-mix(in_oklab,var(--color-foreground),transparent_96%)]",
    };

    const sizes: Record<Size, string> = {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-11 px-5 text-base",
    };

    return (
      <button
        ref={ref}
        className={cn(
          base,
          variants[variant],
          sizes[size],
          fullWidth && "w-full",
          "relative",
          className
        )}
        disabled={disabled || !!loading}
        {...rest}
      >
        {/* Keep layout stable while loading */}
        <span className={cn("inline-flex items-center gap-2", loading && "opacity-0")}>
          {children}
        </span>
        {loading && (
          <Loader2
            className="absolute h-4 w-4 animate-spin"
            aria-hidden
            focusable="false"
          />
        )}
      </button>
    );
  }
);
PlusButton.displayName = "PlusButton";
