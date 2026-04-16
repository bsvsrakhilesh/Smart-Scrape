import type { NavigateFunction } from "react-router-dom";

let navigateRef: NavigateFunction | null = null;

export function registerAppNavigate(navigate: NavigateFunction | null) {
  navigateRef = navigate;
}

export function navigateWithinApp(
  to: string,
  options?: { replace?: boolean },
): boolean {
  if (navigateRef) {
    navigateRef(to, { replace: options?.replace });
    return true;
  }

  if (typeof window !== "undefined") {
    const method = options?.replace ? "replaceState" : "pushState";
    window.history[method](window.history.state, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  }

  return false;
}