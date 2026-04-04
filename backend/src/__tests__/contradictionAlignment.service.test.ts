import test from "node:test";
import assert from "node:assert/strict";

import { DocumentRelationType } from "../generated/prisma/client";
import {
  analyzeRelation,
  summarizeRelationBuckets,
} from "../services/contradictionAlignment.service";

test("analyzeRelation marks same-actor contradiction as temporal shift candidate", () => {
  const out = analyzeRelation({
    id: "r1",
    relationType: DocumentRelationType.CONTRADICTION,
    fromAgency: { id: "a1", name: "CPCB" },
    toAgency: { id: "a1", name: "CPCB" },
    fromClaim: { scopeText: "Delhi NCR" },
    toClaim: { scopeText: "Delhi NCR" },
    confidence: 0.92,
  });

  assert.equal(out.bucket, "temporal_shift_candidate");
  assert.equal(out.sameActor, true);
  assert.equal(out.requiresAnalystReview, true);
});

test("analyzeRelation marks cross-actor scope mismatch as scope variant candidate", () => {
  const out = analyzeRelation({
    id: "r2",
    relationType: DocumentRelationType.TENSION,
    fromAgency: { id: "a1", name: "CPCB" },
    toAgency: { id: "a2", name: "DPCC" },
    fromClaim: { scopeText: "Delhi NCR seasonal restrictions" },
    toClaim: { scopeText: "Punjab stubble enforcement" },
    confidence: 0.88,
  });

  assert.equal(out.bucket, "scope_variant_candidate");
  assert.equal(out.sameActor, false);
  assert.equal(out.scopeWarning, true);
  assert.equal(out.requiresAnalystReview, true);
});

test("analyzeRelation keeps clean cross-actor contradiction in conflict bucket", () => {
  const out = analyzeRelation({
    id: "r3",
    relationType: DocumentRelationType.CONTRADICTION,
    fromAgency: { id: "a1", name: "CPCB" },
    toAgency: { id: "a2", name: "DPCC" },
    fromClaim: { scopeText: "Delhi NCR" },
    toClaim: { scopeText: "Delhi NCR" },
    confidence: 0.91,
  });

  assert.equal(out.bucket, "conflict");
  assert.equal(out.sameActor, false);
  assert.equal(out.scopeWarning, false);
  assert.equal(out.requiresAnalystReview, false);
});

test("summarizeRelationBuckets counts buckets correctly", () => {
  const out = summarizeRelationBuckets([
    {
      id: "r1",
      relationType: DocumentRelationType.CONTRADICTION,
      fromAgency: { id: "a1" },
      toAgency: { id: "a1" },
    },
    {
      id: "r2",
      relationType: DocumentRelationType.ALIGNMENT,
      fromAgency: { id: "a1" },
      toAgency: { id: "a2" },
    },
    {
      id: "r3",
      relationType: DocumentRelationType.REFERENCE,
      fromAgency: { id: "a1" },
      toAgency: { id: "a2" },
    },
  ]);

  assert.equal(out.temporal_shift_candidate, 1);
  assert.equal(out.alignment, 1);
  assert.equal(out.reference, 1);
  assert.equal(out.conflict, 0);
  assert.equal(out.scope_variant_candidate, 0);
});
