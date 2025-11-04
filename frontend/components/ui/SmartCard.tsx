// frontend/components/ui/SmartCard.tsx
"use client";
import * as React from "react";
import FadeIn from "../motion/FadeIn";
import { cn } from "../../lib/utils";

/** Polymorphic helpers (same pattern as FadeIn/StaggerList) */
type AsProp<E extends React.ElementType> = { as?: E };
type PropsToOmit<E extends React.ElementType, P> = keyof (AsProp<E> & P);
type PolymorphicComponentProps<E extends React.ElementType, P> =
  React.PropsWithChildren<P & AsProp<E>> &
  Omit<React.ComponentPropsWithoutRef<E>, PropsToOmit<E, P>>;

/** Own props */
type SmartCardOwnProps = {
  className?: string;
  /** Keep keyboard access without forcing tabindex everywhere */
  tabIndex?: number;
};

/** Public prop type */
export type SmartCardProps<E extends React.ElementType = "div"> =
  PolymorphicComponentProps<E, SmartCardOwnProps>;

/** Component signature */
type SmartCardComponent = <E extends React.ElementType = "div">(
  props: SmartCardProps<E> & { ref?: React.Ref<any> }
) => React.ReactElement | null;

const SmartCard = React.forwardRef(function SmartCardInner<
  E extends React.ElementType = "div"
>(
  {
    as,
    className,
    tabIndex = 0,
    children,
    ...rest
  }: SmartCardProps<E>,
  ref: React.Ref<any>
) {
  const Element = (as || "div") as React.ElementType;

  // We use FadeIn for entrance + non-animated fallback and forward all props to it.
  return (
    <FadeIn
      as={Element}
      ref={ref}
      className={cn(
        "group rounded-2xl border border-border bg-surface shadow-sm transition-all",
        "hover:shadow-lg hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]",
        className
      )}
      tabIndex={tabIndex}
      {...rest}  /* ← forward native handlers like onClick, onDoubleClick, onContextMenu, etc. */
    >
      <div className="rounded-2xl">{children}</div>
    </FadeIn>
  );
}) as SmartCardComponent;

export default SmartCard;
export { SmartCard };
