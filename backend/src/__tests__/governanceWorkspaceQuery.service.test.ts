import test from "node:test";
import assert from "node:assert/strict";

async function loadHooks() {
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
  const mod = await import("../services/governanceWorkspaceQuery.service");
  return mod.governanceWorkspaceQueryTestHooks;
}

test("resolveWorkflowPlan routes factor and why questions to question review", async () => {
  const hooks = await loadHooks();
  const factors = hooks.resolveWorkflowPlan({
    requestedMode: "auto",
    question:
      "What factors did the authority consider before taking action in previous years?",
    tokens: ["factors", "authority", "action", "previous"],
    anchorDocumentIds: [],
    anchorUrlIds: [],
  });

  assert.equal(factors.resolvedMode, "question_review");

  const why = hooks.resolveWorkflowPlan({
    requestedMode: "auto",
    question: "Why does one record say restricted and another say permitted?",
    tokens: ["restricted", "permitted"],
    anchorDocumentIds: [],
    anchorUrlIds: [],
  });

  assert.equal(why.resolvedMode, "question_review");
});

test("resolveWorkflowPlan keeps broad governance scoping in landscape mode", async () => {
  const hooks = await loadHooks();
  const out = hooks.resolveWorkflowPlan({
    requestedMode: "auto",
    question: "Map the active agencies, directions, and compliance gaps",
    tokens: ["map", "agencies", "directions", "compliance"],
    anchorDocumentIds: [],
    anchorUrlIds: [],
  });

  assert.equal(out.resolvedMode, "landscape");
});

test("resolveQueryType identifies question review independent of domain terms", async () => {
  const hooks = await loadHooks();
  const out = hooks.resolveQueryType({
    workflowMode: "question_review",
    question: "What evidence supports this action and who was responsible?",
  });

  assert.equal(out, "question_review");
});
