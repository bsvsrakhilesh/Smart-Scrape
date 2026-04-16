import { navigateWithinApp } from "./navigation";

export type GovernanceWorkspaceOrigin =
  | "file-manager"
  | "saved-urls"
  | "manual"
  | "deep-link";

export type GovernanceWorkspaceMode =
  | "auto"
  | "landscape"
  | "case_trace"
  | "contradiction";

export type GovernanceWorkspaceSourceScope = "all" | "files" | "urls" | "mixed";

export type GovernanceWorkspaceIntent = {
  question?: string | null;
  anchorDocumentIds?: string[];
  anchorUrlIds?: number[];
  documentId?: string | null; // legacy compatibility
  urlId?: number | null; // legacy compatibility
  title?: string | null;
  sourceLabel?: string | null;
  preferredMode?: GovernanceWorkspaceMode | null;
  sourceScope?: GovernanceWorkspaceSourceScope | null;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
  origin?: GovernanceWorkspaceOrigin;
  ts: number;
};

const STORAGE_KEY = "governance-workspace:pending";

function canUseStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is number =>
          typeof entry === "number" && Number.isFinite(entry),
      ),
    ),
  );
}

function normalizePreferredMode(
  value: unknown,
): GovernanceWorkspaceMode | null {
  return value === "auto" ||
    value === "landscape" ||
    value === "case_trace" ||
    value === "contradiction"
    ? value
    : null;
}

function normalizeSourceScope(
  input: Partial<GovernanceWorkspaceIntent>,
  anchorDocumentIds: string[],
  anchorUrlIds: number[],
): GovernanceWorkspaceSourceScope {
  if (
    input.sourceScope === "all" ||
    input.sourceScope === "files" ||
    input.sourceScope === "urls" ||
    input.sourceScope === "mixed"
  ) {
    return input.sourceScope;
  }

  const hasDocumentAnchor =
    anchorDocumentIds.length > 0 ||
    (typeof input.documentId === "string" &&
      input.documentId.trim().length > 0);
  const hasUrlAnchor =
    anchorUrlIds.length > 0 ||
    (typeof input.urlId === "number" && Number.isFinite(input.urlId));

  if (hasDocumentAnchor && hasUrlAnchor) return "mixed";
  if (hasDocumentAnchor) return "files";
  if (hasUrlAnchor) return "urls";
  return "all";
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

  const legacyDocumentId =
    typeof input.documentId === "string" && input.documentId.trim().length > 0
      ? input.documentId.trim()
      : null;

  const legacyUrlId =
    typeof input.urlId === "number" && Number.isFinite(input.urlId)
      ? input.urlId
      : null;

  const anchorDocumentIds = normalizeStringArray(input.anchorDocumentIds);
  const anchorUrlIds = normalizeNumberArray(input.anchorUrlIds);

  if (legacyDocumentId && !anchorDocumentIds.includes(legacyDocumentId)) {
    anchorDocumentIds.unshift(legacyDocumentId);
  }

  if (legacyUrlId != null && !anchorUrlIds.includes(legacyUrlId)) {
    anchorUrlIds.unshift(legacyUrlId);
  }

  return {
    question: typeof input.question === "string" ? input.question : null,
    anchorDocumentIds,
    anchorUrlIds,
    documentId: legacyDocumentId,
    urlId: legacyUrlId,
    title: typeof input.title === "string" ? input.title : null,
    sourceLabel:
      typeof input.sourceLabel === "string" ? input.sourceLabel : null,
    preferredMode: normalizePreferredMode(input.preferredMode),
    sourceScope: normalizeSourceScope(input, anchorDocumentIds, anchorUrlIds),
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
  navigateWithinApp("/app/governance-workspace");
}
