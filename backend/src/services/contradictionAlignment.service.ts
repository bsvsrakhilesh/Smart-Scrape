import { DocumentRelationType } from "../generated/prisma/client";

export type RelationLike = {
  id: string;
  relationType: DocumentRelationType | string;
  fromAgency?: { id?: string | null; name?: string | null } | null;
  toAgency?: { id?: string | null; name?: string | null } | null;
  fromClaim?: { scopeText?: string | null } | null;
  toClaim?: { scopeText?: string | null } | null;
  confidence?: number | null;
};

export type RelationAnalysis = {
  bucket:
    | "conflict"
    | "alignment"
    | "temporal_shift_candidate"
    | "scope_variant_candidate"
    | "reference";
  sameActor: boolean;
  scopeWarning: boolean;
  requiresAnalystReview: boolean;
  reason: string;
};

function cleanScope(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ALIGNMENT_RELATION_TYPES = new Set<DocumentRelationType>([
  DocumentRelationType.ALIGNMENT,
  DocumentRelationType.REINFORCEMENT,
  DocumentRelationType.DUPLICATION,
]);

const REFERENCE_RELATION_TYPES = new Set<DocumentRelationType>([
  DocumentRelationType.REFERENCE,
  DocumentRelationType.SUPERSEDES,
  DocumentRelationType.OTHER,
]);

function normalizeRelationType(
  value: RelationLike["relationType"],
): DocumentRelationType {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();

  return (Object.values(DocumentRelationType) as string[]).includes(raw)
    ? (raw as DocumentRelationType)
    : DocumentRelationType.OTHER;
}

export function analyzeRelation(row: RelationLike): RelationAnalysis {
  const relationType = normalizeRelationType(row.relationType);
  const sameActor = Boolean(
    row.fromAgency?.id &&
    row.toAgency?.id &&
    row.fromAgency.id === row.toAgency.id,
  );

  const fromScope = cleanScope(row.fromClaim?.scopeText);
  const toScope = cleanScope(row.toClaim?.scopeText);
  const scopeWarning = Boolean(fromScope && toScope && fromScope !== toScope);

  if (ALIGNMENT_RELATION_TYPES.has(relationType)) {
    return {
      bucket: "alignment",
      sameActor,
      scopeWarning,
      requiresAnalystReview: scopeWarning,
      reason: scopeWarning
        ? "Supporting relation, but claim scope differs and should be checked manually."
        : "Supporting or reinforcing relation.",
    };
  }

  if (REFERENCE_RELATION_TYPES.has(relationType)) {
    return {
      bucket: "reference",
      sameActor,
      scopeWarning,
      requiresAnalystReview: sameActor || scopeWarning,
      reason:
        relationType === DocumentRelationType.SUPERSEDES
          ? "Later document may supersede the earlier position."
          : "Reference-style relation without direct conflict semantics.",
    };
  }

  if (sameActor) {
    return {
      bucket: "temporal_shift_candidate",
      sameActor,
      scopeWarning,
      requiresAnalystReview: true,
      reason:
        "Same actor appears on both sides; treat as potential position shift before calling it a contradiction.",
    };
  }

  if (scopeWarning) {
    return {
      bucket: "scope_variant_candidate",
      sameActor,
      scopeWarning,
      requiresAnalystReview: true,
      reason:
        "Claims differ in scope/context; verify before escalating as a contradiction.",
    };
  }

  return {
    bucket: "conflict",
    sameActor,
    scopeWarning,
    requiresAnalystReview: (row.confidence ?? 0) < 0.75,
    reason:
      "Cross-document conflict/tension candidate with no obvious same-actor or scope mismatch warning.",
  };
}

export function summarizeRelationBuckets(rows: RelationLike[]) {
  const out: Record<RelationAnalysis["bucket"], number> = {
    conflict: 0,
    alignment: 0,
    temporal_shift_candidate: 0,
    scope_variant_candidate: 0,
    reference: 0,
  };

  for (const row of rows) {
    const bucket = analyzeRelation(row).bucket;
    out[bucket] += 1;
  }

  return out;
}
