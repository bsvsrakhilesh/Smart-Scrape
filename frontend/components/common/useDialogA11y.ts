"use client";

import { RefObject, useEffect } from "react";

type Options = {
  isOpen: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEsc?: boolean; // default true
  closeOnOutsideClick?: boolean; // default true
};

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
      "summary",
    ].join(","),
  );
  return Array.from(nodes).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

export function useDialogA11y({
  isOpen,
  onClose,
  dialogRef,
  initialFocusRef,
  closeOnEsc = true,
  closeOnOutsideClick = true,
}: Options) {
  useEffect(() => {
    if (!isOpen) return;

    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    // 1) scroll lock (restore on cleanup)
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 2) restore focus on close
    const prevActive = document.activeElement as HTMLElement | null;

    // 3) initial focus
    const focusTarget =
      initialFocusRef?.current ?? getFocusable(dialogEl)[0] ?? dialogEl;

    // ensure dialog itself can be focused
    if (!dialogEl.hasAttribute("tabindex")) {
      dialogEl.setAttribute("tabindex", "-1");
    }

    const t = window.setTimeout(() => {
      focusTarget?.focus?.();
    }, 0);

    // 4) key handling (Esc + focus trap)
    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const focusables = getFocusable(dialogEl);
      if (!focusables.length) {
        e.preventDefault();
        dialogEl.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // if focus somehow escaped, pull it back in
      if (active && !dialogEl.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (!active || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // 5) outside click
    const onMouseDown = (e: MouseEvent) => {
      if (!closeOnOutsideClick) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.body.style.overflow = prevOverflow;

      // restore focus safely
      window.setTimeout(() => prevActive?.focus?.(), 0);
    };
  }, [
    isOpen,
    onClose,
    dialogRef,
    initialFocusRef,
    closeOnEsc,
    closeOnOutsideClick,
  ]);
}
