import test from "node:test";
import assert from "node:assert/strict";

async function loadAnswerScopeHelpers() {
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
  return import("../services/governanceWorkspaceAnswer.service");
}

test("purpose evidence hides relation endpoint claim text from documents outside scope", async () => {
  const { claimTextWithinEvidenceScope } = await loadAnswerScopeHelpers();
  const allowed = new Set(["doc-in-scope"]);

  assert.equal(
    claimTextWithinEvidenceScope(
      { claimText: "Permitted evidence", trace: { sourceDocumentId: "doc-in-scope" } },
      allowed,
    ),
    "Permitted evidence",
  );
  assert.equal(
    claimTextWithinEvidenceScope(
      { claimText: "External claim", trace: { sourceDocumentId: "doc-outside" } },
      allowed,
    ),
    null,
  );
  assert.equal(
    claimTextWithinEvidenceScope(
      { claimText: "Normal cross-library evidence", trace: { sourceDocumentId: "doc-outside" } },
      null,
    ),
    "Normal cross-library evidence",
  );
});

test("purpose evidence generation fails when any final card escapes the allowlist", async () => {
  const { assertEvidenceCardsWithinPurposeScope } = await loadAnswerScopeHelpers();

  assert.doesNotThrow(() =>
    assertEvidenceCardsWithinPurposeScope(
      [{ evidenceId: "chunk:1", documentId: "doc-in-scope" }],
      ["doc-in-scope"],
    ),
  );
  assert.throws(
    () =>
      assertEvidenceCardsWithinPurposeScope(
        [{ evidenceId: "relation:2", documentId: "doc-outside" }],
        ["doc-in-scope"],
      ),
    /Purpose evidence boundary violation/,
  );
  assert.doesNotThrow(() =>
    assertEvidenceCardsWithinPurposeScope(
      [{ evidenceId: "relation:2", documentId: "doc-outside" }],
      null,
    ),
  );
});

test("answer quality summary marks verified cited answers as strong", async () => {
  const { buildGovernanceAnswerQualitySummary } = await loadAnswerScopeHelpers();

  assert.deepEqual(
    buildGovernanceAnswerQualitySummary({
      status: "verified",
      validCitationCount: 3,
      invalidCitationCount: 0,
      repaired: false,
      droppedClaims: [],
      supportedClaimCount: 2,
      evidenceCardCount: 2,
    }),
    {
      supportedClaimCount: 2,
      citationCount: 3,
      evidenceCardCount: 2,
      droppedClaimCount: 0,
      invalidCitationCount: 0,
      repaired: false,
      qualityBand: "strong",
      recommendedAction: "use",
    },
  );
});

test("answer quality summary routes partial repaired answers to inspection", async () => {
  const { buildGovernanceAnswerQualitySummary } = await loadAnswerScopeHelpers();

  const summary = buildGovernanceAnswerQualitySummary({
    status: "partially_supported",
    validCitationCount: 3,
    invalidCitationCount: 1,
    repaired: true,
    droppedClaims: ["Unsupported claim"],
    supportedClaimCount: 2,
    evidenceCardCount: 1,
  });

  assert.equal(summary.qualityBand, "usable");
  assert.equal(summary.recommendedAction, "inspect");
  assert.equal(summary.droppedClaimCount, 1);
  assert.equal(summary.repaired, true);
});

test("answer quality summary marks unsupported answers as unsafe", async () => {
  const { buildGovernanceAnswerQualitySummary } = await loadAnswerScopeHelpers();

  const summary = buildGovernanceAnswerQualitySummary({
    status: "unsupported",
    validCitationCount: 0,
    invalidCitationCount: 0,
    repaired: false,
    droppedClaims: [],
    supportedClaimCount: 0,
    evidenceCardCount: 0,
  });

  assert.equal(summary.qualityBand, "unsafe");
  assert.equal(summary.recommendedAction, "broaden_evidence");
});

test("answer session summary maps latest quality and recovery counts", async () => {
  const { mapGovernanceAnswerSessionSummary } = await loadAnswerScopeHelpers();

  const summary = mapGovernanceAnswerSessionSummary({
    id: "session-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdBy: null,
    requestId: null,
    title: "Air quality directions",
    question: "What happened?",
    anchorDocumentIds: ["doc-1", "doc-2"],
    anchorUrlIds: [10],
    sourceScope: "files",
    requestedWorkflowMode: "auto",
    resolvedWorkflowMode: "question_review",
    selectedIssueId: null,
    selectedAgencyId: null,
    collectorPurposeId: "purpose-1",
    metadata: null,
    runCount: BigInt(3),
    latestRunId: "run-3",
    latestRunStatus: "SUCCEEDED",
    latestRunQuestion: "What changed?",
    latestRunCreatedAt: new Date("2026-01-02T00:00:00.000Z"),
    latestGroundingStatus: "verified",
    latestValidation: {
      qualityBand: "strong",
      recommendedAction: "use",
    },
  });

  assert.equal(summary.id, "session-1");
  assert.equal(summary.anchorDocumentCount, 2);
  assert.equal(summary.anchorUrlCount, 1);
  assert.equal(summary.runCount, 3);
  assert.equal(summary.latestRunId, "run-3");
  assert.equal(summary.qualityBand, "strong");
  assert.equal(summary.recommendedAction, "use");
  assert.equal(summary.collectorPurposeId, "purpose-1");
});

test("air quality query profile detects officer workflow and domain signals", async () => {
  const { buildAirQualityQueryProfile } = await loadAnswerScopeHelpers();

  const profile = buildAirQualityQueryProfile(
    "Which agency is responsible for PM2.5 GRAP inspection follow-up in Delhi NCR since 2024?",
  );

  assert.equal(profile.domain, "air_quality_governance");
  assert.equal(profile.queryType, "agency_responsibility");
  assert.equal(profile.jurisdiction, "Delhi NCR");
  assert.deepEqual(profile.pollutants, ["PM2.5"]);
  assert.ok(profile.orderTypes.includes("GRAP"));
  assert.ok(profile.enforcementSignals.includes("Inspection"));
  assert.ok(profile.sourcePriorities.includes("Official orders and directions"));
});

test("air quality query profile merges structured officer filters", async () => {
  const { buildAirQualityQueryProfile } = await loadAnswerScopeHelpers();

  const profile = buildAirQualityQueryProfile("What should I review?", {
    questionType: "Field prep",
    issueHint: "PM2.5",
    jurisdiction: "Delhi NCR",
    timeRange: "Current",
    pollutants: ["PM2.5"],
    agencies: ["CAQM"],
  });

  assert.equal(profile.jurisdiction, "Delhi NCR");
  assert.equal(profile.timeRange, "Current");
  assert.ok(profile.pollutants.includes("PM2.5"));
  assert.ok(profile.agencies.includes("CAQM"));
});

test("multi-step research planner decomposes complex officer questions", async () => {
  const { buildAirQualityQueryProfile, buildMultiStepResearchPlan } =
    await loadAnswerScopeHelpers();
  const question =
    "Which agency is responsible, what is the timeline, and where do orders contradict each other on PM2.5 GRAP enforcement in Delhi NCR since 2024?";
  const profile = buildAirQualityQueryProfile(question);

  const plan = buildMultiStepResearchPlan({
    question,
    profile,
    deepReview: true,
  });

  assert.equal(plan.enabled, true);
  assert.ok(plan.steps.some((step: any) => step.id === "agency_responsibility"));
  assert.ok(plan.steps.some((step: any) => step.id === "timeline"));
  assert.ok(plan.steps.some((step: any) => step.id === "conflicts"));
  assert.ok(plan.steps.length <= 5);
});

test("multi-step research planner keeps narrow questions single pass", async () => {
  const { buildAirQualityQueryProfile, buildMultiStepResearchPlan } =
    await loadAnswerScopeHelpers();
  const question = "What does this CPCB order say about PM10?";
  const profile = buildAirQualityQueryProfile(question);

  const plan = buildMultiStepResearchPlan({
    question,
    profile,
    deepReview: false,
  });

  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.steps, []);
});

test("answer run evaluation scores retrieval, citations, coverage, and feedback", async () => {
  const { buildAnswerEvaluationFromRun } = await loadAnswerScopeHelpers();

  const evaluation = buildAnswerEvaluationFromRun({
    id: "run-1",
    sessionId: "session-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:10:00.000Z"),
    createdBy: null,
    requestId: null,
    status: "SUCCEEDED",
    question: "Which agency is responsible?",
    answer: "Answer",
    citations: [{ evidenceId: "chunk:1", quote: "Official quote" }],
    evidence: [{ evidenceId: "chunk:1" }],
    caveats: [],
    openQuestions: [],
    suggestedFollowUps: [],
    structuredAnswer: {
      claimCitations: [{ claim: "CPCB issued a direction", citations: [] }],
      evidenceGaps: [],
      conflicts: [{ title: "Tension", finding: "Two sources differ", citations: [] }],
    },
    model: "model",
    assistModel: "assist",
    openaiResponseId: null,
    previousResponseId: null,
    previousRunId: null,
    anchorDocumentIds: [],
    anchorUrlIds: [],
    sourceScope: "all",
    requestedWorkflowMode: "question_review",
    resolvedWorkflowMode: "question_review",
    selectedIssueId: null,
    selectedAgencyId: null,
    collectorPurposeId: null,
    candidateDocumentIds: ["doc-1", "doc-2"],
    finalEvidenceChunkIds: ["chunk-1"],
    sourceRevisionIds: [],
    documentRevisionIds: [],
    pipelineConfigIds: [],
    retrievalMetadata: {
      totalCandidates: 8,
      retrievalDecision: { confidence: "high" },
    },
    groundingStatus: "verified",
    validation: {
      status: "verified",
      qualityBand: "strong",
      recommendedAction: "use",
      validCitationCount: 4,
      invalidCitationCount: 0,
      supportedClaimCount: 3,
      evidenceCardCount: 2,
      officerFeedback: [{ id: "feedback-1" }],
    },
    error: null,
    latencyMs: 1234,
  } as any);

  assert.equal(evaluation.runId, "run-1");
  assert.equal(evaluation.qualityBand, "strong");
  assert.equal(evaluation.recommendedAction, "use");
  assert.equal(evaluation.officerFeedbackCount, 1);
  assert.ok(evaluation.scores.overall >= 70);
  assert.equal(evaluation.checks.find((item) => item.key === "citations")?.status, "pass");
});

test("graph rag summary extracts relationship paths and officer warnings", async () => {
  const { buildGraphRagSummary } = await loadAnswerScopeHelpers();

  const summary = buildGraphRagSummary({
    candidates: [
      {
        coverageFamilies: ["graph", "chunk"],
        retrievalLanes: ["relation_graph", "semantic_chunk"],
      },
    ],
    contradictionFoundation: {
      summary: { contradictionCount: 2, reviewCount: 1 },
    },
    overrideChainFoundation: {
      chains: [
        {
          chainKey: "chain-1",
          title: "Later CAQM order supersedes earlier direction",
          basis: "Supersedes-style relation indicates displacement.",
          documentIds: ["doc-a", "doc-b"],
        },
      ],
    },
    comparisonSurface: {
      comparisons: [
        {
          comparisonKey: "doc-a::doc-b",
          changeSummary: "Position shift from earlier to later order.",
          strongestReason: "Later order overrides earlier record.",
          documentIds: ["doc-a", "doc-b"],
          relationTypes: ["OVERRIDE"],
          issueTitle: "GRAP enforcement",
        },
      ],
    },
    caseTrailFoundation: {
      events: [
        {
          eventId: "event-1",
          title: "Inspection completed",
          detail: "Inspection report added to the record.",
          documentIds: ["doc-c"],
          issueTitle: "Industrial emissions",
        },
      ],
    },
    questionReviewSurface: {
      actorInputs: [
        {
          actorName: "CAQM",
          strongestSignal: {
            detail: "CAQM direction is the strongest actor signal.",
            documentIds: ["doc-b"],
          },
        },
      ],
      openQuestions: ["Verify follow-up status."],
    },
  });

  assert.equal(summary.active, true);
  assert.equal(summary.summary.graphCandidateCount, 1);
  assert.equal(summary.summary.relationLaneCount, 1);
  assert.equal(summary.summary.contradictionCount, 2);
  assert.equal(summary.summary.overrideChainCount, 1);
  assert.ok(summary.relationshipPaths.some((item: any) => item.kind === "comparison"));
  assert.ok(summary.relationshipPaths.some((item: any) => item.kind === "actor_signal"));
  assert.ok(summary.officerWarnings.some((item: string) => item.includes("analyst review")));
});

test("selected answer evidence restricts candidate documents", async () => {
  const { resolveAnswerCandidateDocumentIds } = await loadAnswerScopeHelpers();

  const out = resolveAnswerCandidateDocumentIds({
    retrievedDocumentIds: ["doc-1", "doc-2", "doc-3"],
    selectedDocumentIds: ["doc-2", "doc-3"],
  });

  assert.deepEqual(out.candidateDocumentIds, ["doc-2", "doc-3"]);
  assert.deepEqual(out.manualEvidenceSelection, {
    active: true,
    selectedDocumentIds: ["doc-2", "doc-3"],
    selectedDocumentCount: 2,
    retrievedDocumentCount: 3,
  });
});

test("omitted selected answer evidence preserves retrieved candidates", async () => {
  const { resolveAnswerCandidateDocumentIds } = await loadAnswerScopeHelpers();

  const out = resolveAnswerCandidateDocumentIds({
    retrievedDocumentIds: ["doc-1", "doc-2"],
    selectedDocumentIds: [],
  });

  assert.deepEqual(out.candidateDocumentIds, ["doc-1", "doc-2"]);
  assert.equal(out.manualEvidenceSelection, null);
});

test("selected answer evidence rejects documents outside retrieval or purpose scope", async () => {
  const { resolveAnswerCandidateDocumentIds } = await loadAnswerScopeHelpers();

  assert.throws(
    () =>
      resolveAnswerCandidateDocumentIds({
        retrievedDocumentIds: ["doc-1"],
        selectedDocumentIds: ["doc-2"],
      }),
    /no longer part of the retrieved document set/,
  );

  assert.throws(
    () =>
      resolveAnswerCandidateDocumentIds({
        retrievedDocumentIds: ["doc-1", "doc-2"],
        selectedDocumentIds: ["doc-2"],
        allowedDocumentIds: ["doc-1"],
      }),
    /outside the current purpose boundary/,
  );
});
