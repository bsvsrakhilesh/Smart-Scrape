CREATE TABLE IF NOT EXISTS "GovernanceAnswerSession" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "requestId" TEXT,
  "title" TEXT,
  "question" TEXT,
  "anchorDocumentIds" JSONB,
  "anchorUrlIds" JSONB,
  "sourceScope" TEXT NOT NULL DEFAULT 'all',
  "requestedWorkflowMode" TEXT,
  "resolvedWorkflowMode" TEXT,
  "selectedIssueId" TEXT,
  "selectedAgencyId" TEXT,
  "metadata" JSONB
);

CREATE TABLE IF NOT EXISTS "GovernanceAnswerRun" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "requestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'STARTED',
  "question" TEXT NOT NULL,
  "answer" TEXT,
  "citations" JSONB,
  "evidence" JSONB,
  "caveats" JSONB,
  "openQuestions" JSONB,
  "suggestedFollowUps" JSONB,
  "structuredAnswer" JSONB,
  "model" TEXT,
  "assistModel" TEXT,
  "openaiResponseId" TEXT,
  "previousResponseId" TEXT,
  "previousRunId" TEXT,
  "anchorDocumentIds" JSONB,
  "anchorUrlIds" JSONB,
  "sourceScope" TEXT NOT NULL DEFAULT 'all',
  "requestedWorkflowMode" TEXT,
  "resolvedWorkflowMode" TEXT,
  "selectedIssueId" TEXT,
  "selectedAgencyId" TEXT,
  "candidateDocumentIds" JSONB,
  "finalEvidenceChunkIds" JSONB,
  "sourceRevisionIds" JSONB,
  "documentRevisionIds" JSONB,
  "pipelineConfigIds" JSONB,
  "retrievalMetadata" JSONB,
  "groundingStatus" TEXT,
  "validation" JSONB,
  "error" TEXT,
  "latencyMs" INTEGER,
  CONSTRAINT "GovernanceAnswerRun_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "GovernanceAnswerSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GovernanceAnswerSession_updatedAt_idx" ON "GovernanceAnswerSession"("updatedAt");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerSession_selectedIssueId_idx" ON "GovernanceAnswerSession"("selectedIssueId");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerSession_selectedAgencyId_idx" ON "GovernanceAnswerSession"("selectedAgencyId");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerRun_sessionId_createdAt_idx" ON "GovernanceAnswerRun"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerRun_status_createdAt_idx" ON "GovernanceAnswerRun"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerRun_openaiResponseId_idx" ON "GovernanceAnswerRun"("openaiResponseId");
