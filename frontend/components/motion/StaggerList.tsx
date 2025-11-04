// frontend/components/motion/StaggerList.tsx
"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

/**
 * Pragmatically typed polymorphic components.
 * We forward all props (including event handlers) and a ref,
 * but we do NOT use complex generic ref typing that breaks on some TS configs.
 */

type BaseProps = {
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
};

/** Container that staggers its direct children. Default element: div */
export const StaggerList = React.forwardRef(function StaggerList(
  { as: As = "div", className, children, ...rest }: BaseProps & Record<string, any>,
  ref: React.Ref<any>
) {
  const M: any = typeof As === "string" ? (motion as any)[As] ?? motion.div : (motion as any)(As);
  return (
    <M
      ref={ref}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      className={cn("m-0 p-0", className)}
      {...rest}
    >
      {children}
    </M>
  );
});

/** Child item that participates in the parent's stagger. Default element: div */
export const StaggerItem = React.forwardRef(function StaggerItem(
  { as: As = "div", className, children, ...rest }: BaseProps & Record<string, any>,
  ref: React.Ref<any>
) {
  const M: any = typeof As === "string" ? (motion as any)[As] ?? motion.div : (motion as any)(As);
  return (
    <M
      ref={ref}
      variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
      className={className}
      {...rest}
    >
      {children}
    </M>
  );
});
