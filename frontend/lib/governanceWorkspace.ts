export type GovernanceWorkspaceOrigin =
  | "file-manager"
  | "saved-urls"
  | "manual"
  | "deep-link";

export type GovernanceWorkspaceIntent = {
  documentId?: string | null;
  urlId?: number | null;
  title?: string | null;
  sourceLabel?: string | null;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
  origin?: GovernanceWorkspaceOrigin;
  ts: number;
};

const STORAGE_KEY = "governance-workspace:pending";

function canUseStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function normalizeIntent(
  input: Partial<GovernanceWorkspaceIntent>,
): GovernanceWorkspaceIntent {
  const origin =
    input.origin === "file-manager" ||
    input.origin === "saved-urls" ||
    input.origin === "manual" ||
    input.origin === "deep-link"
      ? input.origin
      : "manual";

  return {
    documentId: typeof input.documentId === "string" ? input.documentId : null,
    urlId: typeof input.urlId === "number" ? input.urlId : null,
    title: typeof input.title === "string" ? input.title : null,
    sourceLabel:
      typeof input.sourceLabel === "string" ? input.sourceLabel : null,
    selectedIssueId:
      typeof input.selectedIssueId === "string" ? input.selectedIssueId : null,
    selectedAgencyId:
      typeof input.selectedAgencyId === "string"
        ? input.selectedAgencyId
        : null,
    origin,
    ts: typeof input.ts === "number" ? input.ts : Date.now(),
  };
}

export function queueGovernanceWorkspaceIntent(
  intent: Omit<GovernanceWorkspaceIntent, "ts">,
) {
  if (!canUseStorage()) return;
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...intent,
      ts: Date.now(),
    }),
  );
}

export function consumeGovernanceWorkspaceIntent(): GovernanceWorkspaceIntent | null {
  if (!canUseStorage()) return null;

  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  sessionStorage.removeItem(STORAGE_KEY);

  try {
    return normalizeIntent(
      JSON.parse(raw) as Partial<GovernanceWorkspaceIntent>,
    );
  } catch {
    return null;
  }
}

export function openGovernanceWorkspace(
  intent: Omit<GovernanceWorkspaceIntent, "ts">,
) {
  queueGovernanceWorkspaceIntent(intent);

  if (typeof window !== "undefined") {
    window.location.href = "/app#governance-workspace";
  }
}
