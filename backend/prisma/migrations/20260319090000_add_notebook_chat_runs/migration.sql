-- CreateEnum
CREATE TYPE "public"."NotebookChatRunStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."NotebookChatRun" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "requestId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "answerMode" TEXT NOT NULL,
    "model" TEXT,
    "status" "public"."NotebookChatRunStatus" NOT NULL DEFAULT 'STARTED',
    "userMessage" TEXT NOT NULL,
    "history" JSONB,
    "scopedSourceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "retrievedChunkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "finalChunkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sourceRevisionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "documentRevisionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pipelineConfigIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "openaiResponseId" TEXT,
    "answer" TEXT,
    "citations" JSONB,
    "evidence" JSONB,
    "suggested" JSONB,
    "error" TEXT,
    "latencyMs" INTEGER,

    CONSTRAINT "NotebookChatRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotebookChatRun_notebookId_createdAt_idx"
ON "public"."NotebookChatRun"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "NotebookChatRun_status_createdAt_idx"
ON "public"."NotebookChatRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."NotebookChatRun"
ADD CONSTRAINT "NotebookChatRun_notebookId_fkey"
FOREIGN KEY ("notebookId") REFERENCES "public"."Notebook"("id")
ON DELETE CASCADE ON UPDATE CASCADE;