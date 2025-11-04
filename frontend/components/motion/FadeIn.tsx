// frontend/components/motion/FadeIn.tsx
"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

/** === Polymorphic helpers (same pattern as StaggerList) === */
type AsProp<E extends React.ElementType> = { as?: E };
type PropsToOmit<E extends React.ElementType, P> = keyof (AsProp<E> & P);
type PolymorphicComponentProps<E extends React.ElementType, P> =
  React.PropsWithChildren<P & AsProp<E>> &
  Omit<React.ComponentPropsWithoutRef<E>, PropsToOmit<E, P>>;

/** === Own props === */
type FadeInOwnProps = {
  /** Intrinsic tag or any React component. Default: 'div' */
  as?: React.ElementType;
  /** Entrance delay (seconds) */
  delay?: number;
  /** Initial translateY (px). Default: 6 */
  y?: number;
  className?: string;
};

/** Public prop type */
export type FadeInProps<E extends React.ElementType = "div"> =
  PolymorphicComponentProps<E, FadeInOwnProps>;

/** Make the component generic + ref-forwarding with correct prop forwarding */
type FadeInComponent = <E extends React.ElementType = "div">(
  props: FadeInProps<E> & { ref?: React.Ref<any> }
) => React.ReactElement | null;

const FadeIn = React.forwardRef(function FadeInInner<
  E extends React.ElementType = "div"
>(
  {
    as,
    delay = 0,
    y = 6,
    className,
    children,
    ...rest
  }: FadeInProps<E>,
  ref: React.Ref<any>
) {
  const Element = (as || "div") as React.ElementType;

  // Respect reduced motion
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReduced) {
    // Render plain element with all forwarded props (no animation)
    return React.createElement(Element, { className, ref, ...rest }, children);
  }

  // motion wrapper for intrinsic or custom components
  const M: any =
    typeof Element === "string" ? (motion as any)[Element] ?? motion.div : (motion as any)(Element);

  return (
    <M
      ref={ref}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut", delay }}
      className={cn(className)}
      {...rest}
    >
      {children}
    </M>
  );
}) as FadeInComponent;

export default FadeIn;
