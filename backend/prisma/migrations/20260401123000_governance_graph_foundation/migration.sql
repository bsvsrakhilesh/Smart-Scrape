-- CreateEnum
CREATE TYPE "AgencyCategory" AS ENUM (
    'REGULATOR',
    'JUDICIARY',
    'MINISTRY',
    'EXECUTIVE',
    'LOCAL_BODY',
    'RESEARCH_BODY',
    'CIVIL_SOCIETY',
    'PRIVATE_SECTOR',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "GovernanceIssueKind" AS ENUM (
    'GOVERNANCE_ISSUE',
    'CASE_FILE'
);

-- CreateEnum
CREATE TYPE "GovernanceIssueStatus" AS ENUM (
    'OPEN',
    'MONITORING',
    'RESOLVED',
    'CLOSED',
    'ARCHIVED'
);

-- CreateEnum
CREATE TYPE "MandateType" AS ENUM (
    'STATUTORY',
    'REGULATORY',
    'ADVISORY',
    'ENFORCEMENT',
    'OPERATIONAL',
    'COORDINATION',
    'REPORTING',
    'MONITORING',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "PositionPolarity" AS ENUM (
    'SUPPORT',
    'OPPOSE',
    'NEUTRAL',
    'MIXED',
    'UNKNOWN'
);

-- CreateEnum
CREATE TYPE "GovernanceGapType" AS ENUM (
    'OVERLAP',
    'AMBIGUITY',
    'ACCOUNTABILITY',
    'COORDINATION',
    'ENFORCEMENT',
    'DATA',
    'EVIDENCE',
    'COVERAGE',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "DocumentRelationType" AS ENUM (
    'CONTRADICTION',
    'TENSION',
    'OVERRIDE',
    'REINFORCEMENT',
    'ALIGNMENT',
    'DUPLICATION',
    'REFERENCE',
    'SUPERSEDES',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "EventDatePrecision" AS ENUM (
    'EXACT',
    'DAY',
    'MONTH',
    'YEAR',
    'RANGE',
    'APPROXIMATE',
    'UNKNOWN'
);

-- CreateTable
CREATE TABLE "ExtractionTrace" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "documentRevisionId" TEXT,
    "sourceRevisionId" TEXT,
    "pipelineConfigId" TEXT,
    "chunkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "evidenceText" TEXT,
    "evidenceLocator" JSONB,
    "confidence" DOUBLE PRECISION,
    "extractionModel" TEXT,
    "extractionVersion" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "category" "AgencyCategory",
    "jurisdiction" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "originTraceId" TEXT,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceIssue" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "kind" "GovernanceIssueKind" NOT NULL DEFAULT 'GOVERNANCE_ISSUE',
    "status" "GovernanceIssueStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "originTraceId" TEXT,

    CONSTRAINT "GovernanceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceIssueAgency" (
    "issueId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "roleLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceIssueAgency_pkey" PRIMARY KEY ("issueId","agencyId")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "issueId" TEXT,
    "traceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mandateType" "MandateType" NOT NULL DEFAULT 'OTHER',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentClaim" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "traceId" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "claimSummary" TEXT,
    "subjectAgencyId" TEXT,
    "polarity" "PositionPolarity" NOT NULL DEFAULT 'UNKNOWN',
    "scopeText" TEXT,
    "normalizedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "actorAgencyId" TEXT,
    "traceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "eventDate" TIMESTAMP(3),
    "eventDateText" TEXT,
    "eventDatePrecision" "EventDatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "sortDate" TIMESTAMP(3),
    "sortDateEnd" TIMESTAMP(3),
    "usedDocumentDateFallback" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActorPosition" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "claimId" TEXT,
    "traceId" TEXT NOT NULL,
    "stanceText" TEXT NOT NULL,
    "stanceSummary" TEXT,
    "polarity" "PositionPolarity" NOT NULL DEFAULT 'UNKNOWN',
    "effectiveDate" TIMESTAMP(3),
    "effectiveDateText" TEXT,
    "effectiveDatePrecision" "EventDatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActorPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceGap" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "primaryAgencyId" TEXT,
    "secondaryAgencyId" TEXT,
    "traceId" TEXT NOT NULL,
    "gapType" "GovernanceGapType" NOT NULL DEFAULT 'OTHER',
    "summary" TEXT NOT NULL,
    "severity" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRelation" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "fromClaimId" TEXT,
    "toClaimId" TEXT,
    "fromAgencyId" TEXT,
    "toAgencyId" TEXT,
    "traceId" TEXT NOT NULL,
    "relationType" "DocumentRelationType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueTimelineEntry" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "eventId" TEXT,
    "positionId" TEXT,
    "traceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT,
    "sortDate" TIMESTAMP(3),
    "sortDateEnd" TIMESTAMP(3),
    "sortPrecision" "EventDatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "actorAgencyId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceCluster" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "traceId" TEXT NOT NULL,
    "clusterKey" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceCluster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_slug_key" ON "Agency"("slug");
CREATE INDEX "Agency_name_idx" ON "Agency"("name");
CREATE INDEX "Agency_category_idx" ON "Agency"("category");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceIssue_slug_key" ON "GovernanceIssue"("slug");
CREATE INDEX "GovernanceIssue_kind_status_idx" ON "GovernanceIssue"("kind", "status");
CREATE INDEX "GovernanceIssue_title_idx" ON "GovernanceIssue"("title");

-- CreateIndex
CREATE INDEX "GovernanceIssueAgency_agencyId_idx" ON "GovernanceIssueAgency"("agencyId");

-- CreateIndex
CREATE INDEX "Mandate_agencyId_mandateType_idx" ON "Mandate"("agencyId", "mandateType");
CREATE INDEX "Mandate_issueId_idx" ON "Mandate"("issueId");
CREATE INDEX "Mandate_traceId_idx" ON "Mandate"("traceId");

-- CreateIndex
CREATE INDEX "DocumentClaim_issueId_idx" ON "DocumentClaim"("issueId");
CREATE INDEX "DocumentClaim_traceId_idx" ON "DocumentClaim"("traceId");
CREATE INDEX "DocumentClaim_subjectAgencyId_idx" ON "DocumentClaim"("subjectAgencyId");
CREATE INDEX "DocumentClaim_normalizedKey_idx" ON "DocumentClaim"("normalizedKey");

-- CreateIndex
CREATE INDEX "DocumentEvent_issueId_sortDate_idx" ON "DocumentEvent"("issueId", "sortDate");
CREATE INDEX "DocumentEvent_actorAgencyId_idx" ON "DocumentEvent"("actorAgencyId");
CREATE INDEX "DocumentEvent_traceId_idx" ON "DocumentEvent"("traceId");

-- CreateIndex
CREATE INDEX "ActorPosition_issueId_agencyId_idx" ON "ActorPosition"("issueId", "agencyId");
CREATE INDEX "ActorPosition_claimId_idx" ON "ActorPosition"("claimId");
CREATE INDEX "ActorPosition_traceId_idx" ON "ActorPosition"("traceId");

-- CreateIndex
CREATE INDEX "GovernanceGap_issueId_gapType_idx" ON "GovernanceGap"("issueId", "gapType");
CREATE INDEX "GovernanceGap_primaryAgencyId_idx" ON "GovernanceGap"("primaryAgencyId");
CREATE INDEX "GovernanceGap_secondaryAgencyId_idx" ON "GovernanceGap"("secondaryAgencyId");
CREATE INDEX "GovernanceGap_traceId_idx" ON "GovernanceGap"("traceId");

-- CreateIndex
CREATE INDEX "DocumentRelation_issueId_relationType_idx" ON "DocumentRelation"("issueId", "relationType");
CREATE INDEX "DocumentRelation_fromClaimId_idx" ON "DocumentRelation"("fromClaimId");
CREATE INDEX "DocumentRelation_toClaimId_idx" ON "DocumentRelation"("toClaimId");
CREATE INDEX "DocumentRelation_fromAgencyId_idx" ON "DocumentRelation"("fromAgencyId");
CREATE INDEX "DocumentRelation_toAgencyId_idx" ON "DocumentRelation"("toAgencyId");
CREATE INDEX "DocumentRelation_traceId_idx" ON "DocumentRelation"("traceId");

-- CreateIndex
CREATE INDEX "IssueTimelineEntry_issueId_sortDate_idx" ON "IssueTimelineEntry"("issueId", "sortDate");
CREATE INDEX "IssueTimelineEntry_eventId_idx" ON "IssueTimelineEntry"("eventId");
CREATE INDEX "IssueTimelineEntry_positionId_idx" ON "IssueTimelineEntry"("positionId");
CREATE INDEX "IssueTimelineEntry_actorAgencyId_idx" ON "IssueTimelineEntry"("actorAgencyId");
CREATE INDEX "IssueTimelineEntry_traceId_idx" ON "IssueTimelineEntry"("traceId");

-- CreateIndex
CREATE INDEX "EvidenceCluster_issueId_idx" ON "EvidenceCluster"("issueId");
CREATE INDEX "EvidenceCluster_traceId_idx" ON "EvidenceCluster"("traceId");
CREATE INDEX "EvidenceCluster_clusterKey_idx" ON "EvidenceCluster"("clusterKey");

-- CreateIndex
CREATE INDEX "ExtractionTrace_sourceDocumentId_createdAt_idx" ON "ExtractionTrace"("sourceDocumentId", "createdAt");
CREATE INDEX "ExtractionTrace_documentRevisionId_idx" ON "ExtractionTrace"("documentRevisionId");
CREATE INDEX "ExtractionTrace_sourceRevisionId_idx" ON "ExtractionTrace"("sourceRevisionId");
CREATE INDEX "ExtractionTrace_pipelineConfigId_idx" ON "ExtractionTrace"("pipelineConfigId");

-- AddForeignKey
ALTER TABLE "ExtractionTrace"
ADD CONSTRAINT "ExtractionTrace_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExtractionTrace"
ADD CONSTRAINT "ExtractionTrace_documentRevisionId_fkey"
FOREIGN KEY ("documentRevisionId") REFERENCES "DocumentRevision"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExtractionTrace"
ADD CONSTRAINT "ExtractionTrace_sourceRevisionId_fkey"
FOREIGN KEY ("sourceRevisionId") REFERENCES "SourceRevision"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExtractionTrace"
ADD CONSTRAINT "ExtractionTrace_pipelineConfigId_fkey"
FOREIGN KEY ("pipelineConfigId") REFERENCES "PipelineConfig"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Agency"
ADD CONSTRAINT "Agency_originTraceId_fkey"
FOREIGN KEY ("originTraceId") REFERENCES "ExtractionTrace"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GovernanceIssue"
ADD CONSTRAINT "GovernanceIssue_originTraceId_fkey"
FOREIGN KEY ("originTraceId") REFERENCES "ExtractionTrace"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GovernanceIssueAgency"
ADD CONSTRAINT "GovernanceIssueAgency_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GovernanceIssueAgency"
ADD CONSTRAINT "GovernanceIssueAgency_agencyId_fkey"
FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Mandate"
ADD CONSTRAINT "Mandate_agencyId_fkey"
FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Mandate"
ADD CONSTRAINT "Mandate_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Mandate"
ADD CONSTRAINT "Mandate_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentClaim"
ADD CONSTRAINT "DocumentClaim_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentClaim"
ADD CONSTRAINT "DocumentClaim_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentClaim"
ADD CONSTRAINT "DocumentClaim_subjectAgencyId_fkey"
FOREIGN KEY ("subjectAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentEvent"
ADD CONSTRAINT "DocumentEvent_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentEvent"
ADD CONSTRAINT "DocumentEvent_actorAgencyId_fkey"
FOREIGN KEY ("actorAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentEvent"
ADD CONSTRAINT "DocumentEvent_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActorPosition"
ADD CONSTRAINT "ActorPosition_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActorPosition"
ADD CONSTRAINT "ActorPosition_agencyId_fkey"
FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActorPosition"
ADD CONSTRAINT "ActorPosition_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "DocumentClaim"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActorPosition"
ADD CONSTRAINT "ActorPosition_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GovernanceGap"
ADD CONSTRAINT "GovernanceGap_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GovernanceGap"
ADD CONSTRAINT "GovernanceGap_primaryAgencyId_fkey"
FOREIGN KEY ("primaryAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GovernanceGap"
ADD CONSTRAINT "GovernanceGap_secondaryAgencyId_fkey"
FOREIGN KEY ("secondaryAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GovernanceGap"
ADD CONSTRAINT "GovernanceGap_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation"
ADD CONSTRAINT "DocumentRelation_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation"
ADD CONSTRAINT "DocumentRelation_fromClaimId_fkey"
FOREIGN KEY ("fromClaimId") REFERENCES "DocumentClaim"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation"
ADD CONSTRAINT "DocumentRelation_toClaimId_fkey"
FOREIGN KEY ("toClaimId") REFERENCES "DocumentClaim"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation"
ADD CONSTRAINT "DocumentRelation_fromAgencyId_fkey"
FOREIGN KEY ("fromAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation"
ADD CONSTRAINT "DocumentRelation_toAgencyId_fkey"
FOREIGN KEY ("toAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation"
ADD CONSTRAINT "DocumentRelation_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueTimelineEntry"
ADD CONSTRAINT "IssueTimelineEntry_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueTimelineEntry"
ADD CONSTRAINT "IssueTimelineEntry_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "DocumentEvent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IssueTimelineEntry"
ADD CONSTRAINT "IssueTimelineEntry_positionId_fkey"
FOREIGN KEY ("positionId") REFERENCES "ActorPosition"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IssueTimelineEntry"
ADD CONSTRAINT "IssueTimelineEntry_actorAgencyId_fkey"
FOREIGN KEY ("actorAgencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IssueTimelineEntry"
ADD CONSTRAINT "IssueTimelineEntry_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceCluster"
ADD CONSTRAINT "EvidenceCluster_issueId_fkey"
FOREIGN KEY ("issueId") REFERENCES "GovernanceIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceCluster"
ADD CONSTRAINT "EvidenceCluster_traceId_fkey"
FOREIGN KEY ("traceId") REFERENCES "ExtractionTrace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;