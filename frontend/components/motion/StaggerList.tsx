// frontend/components/motion/StaggerList.tsx
"use client";
import * as React from "react";
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
  const Comp: any = As;
  return (
    <Comp ref={ref} className={cn("m-0 p-0", className)} {...rest}>
      {children}
    </Comp>
  );
});

/** Child item that participates in the parent's stagger. Default element: div */
export const StaggerItem = React.forwardRef(function StaggerItem(
  { as: As = "div", className, children, ...rest }: BaseProps & Record<string, any>,
  ref: React.Ref<any>
) {
  const Comp: any = As;
  return (
    <Comp ref={ref} className={className} {...rest}>
      {children}
    </Comp>
  );
});
