import type { NextFunction, Request, Response } from "express";
import prisma from "../config/database";
import { enqueueAiTagUrl } from "../queues/aiTagUrl.queue";
import { enqueueSavedUrlOperation } from "../queues/savedUrlOperation.queue";
import { crawlPdfHandler, crawlTextHandler } from "../controllers/crawl.controller";
import { extractUrlMetadata } from "./extract.service";
import { ensureDocumentRevisionForStoredFile } from "./document.service";
import { recordCaptureEvent } from "./provenance.service";

export const SAVED_URL_OPERATION_TYPES = [
  "saved_url_bulk_capture_text",
  "saved_url_bulk_capture_pdf",
  "saved_url_discovered_pdf_capture",
  "saved_url_bulk_ai_tag",
  "saved_url_metadata_refresh",
  "saved_url_bulk_delete",
  "saved_url_collection_assign",
] as const;

export type SavedUrlOperationType = (typeof SAVED_URL_OPERATION_TYPES)[number];
export type SavedUrlOperationStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceled";

export type SavedUrlOperationOptions = {
  folderId?: string | null;
  collectionId?: string;
  collectionMode?: "add" | "move";
  accessMode?: "public" | "institutional";
  force?: boolean;
};

const DISCOVERED_PDF_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.DISCOVERED_PDF_CAPTURE_MAX_ATTEMPTS || 3),
);

function asError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function cleanUrlIds(urlIds: number[]) {
  return Array.from(
    new Set((urlIds || []).map(Number).filter((id) => Number.isFinite(id))),
  );
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function serializeOperationRun(run: any) {
  return {
    id: run.id,
    ownerId: run.ownerId,
    type: run.type,
    status: run.status as SavedUrlOperationStatus,
    total: run.total,
    completed: run.completed,
    failed: run.failed,
    progressPct: run.progressPct,
    stage: run.stage ?? undefined,
    statusMessage: run.statusMessage ?? undefined,
    error: run.error ?? null,
    meta: run.meta ?? null,
    createdAt: run.createdAt?.toISOString?.() ?? run.createdAt,
    startedAt: run.startedAt?.toISOString?.() ?? run.startedAt ?? null,
    finishedAt: run.finishedAt?.toISOString?.() ?? run.finishedAt ?? null,
    updatedAt: run.updatedAt?.toISOString?.() ?? run.updatedAt,
    items: Array.isArray(run.items)
      ? run.items.map((item: any) => ({
          id: item.id,
          runId: item.runId,
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          resourceKey: item.resourceKey ?? null,
          status: item.status,
          error: item.error ?? null,
          result: item.result ?? null,
          attemptCount: item.attemptCount ?? 0,
          createdAt: item.createdAt?.toISOString?.() ?? item.createdAt,
          startedAt: item.startedAt?.toISOString?.() ?? item.startedAt ?? null,
          finishedAt:
            item.finishedAt?.toISOString?.() ?? item.finishedAt ?? null,
          updatedAt: item.updatedAt?.toISOString?.() ?? item.updatedAt,
        }))
      : undefined,
  };
}

export async function listSavedUrlOperations(ownerId: string, limit = 20) {
  const rows = await prisma.operationRun.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  return rows.map(serializeOperationRun);
}

export async function getSavedUrlOperation(ownerId: string, runId: string) {
  const run = await prisma.operationRun.findFirst({
    where: { id: runId, ownerId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!run) throw asError("Operation run not found.", 404);
  return serializeOperationRun(run);
}

export async function createSavedUrlOperation(args: {
  ownerId: string;
  type: SavedUrlOperationType;
  urlIds: number[];
  options?: SavedUrlOperationOptions;
}) {
  if (args.type === "saved_url_discovered_pdf_capture") {
    throw asError(
      "Use /api/urls/:id/discovered-documents/capture-run for discovered PDF capture.",
    );
  }

  const urlIds = cleanUrlIds(args.urlIds);
  if (!urlIds.length) throw asError("At least one URL id is required.");
  if (urlIds.length > 1000) throw asError("At most 1000 URL ids are allowed.");

  if (
    args.type === "saved_url_collection_assign" &&
    !args.options?.collectionId
  ) {
    throw asError("collectionId is required for collection assignment.");
  }

  const existing = await prisma.url.findMany({
    where: { id: { in: urlIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const missing = urlIds.filter((id) => !existingIds.has(id));
  if (missing.length) {
    throw asError(`Unknown URL id(s): ${missing.slice(0, 10).join(", ")}`);
  }

  if (args.options?.collectionId) {
    const collection = await prisma.collection.findUnique({
      where: { id: args.options.collectionId },
      select: { id: true },
    });
    if (!collection) throw asError("Collection not found.", 404);
  }

  const run = await prisma.operationRun.create({
    data: {
      ownerId: args.ownerId,
      type: args.type,
      status: "queued",
      total: urlIds.length,
      completed: 0,
      failed: 0,
      progressPct: 0,
      stage: "queued",
      statusMessage: "Queued",
      meta: {
        options: args.options ?? {},
      },
      items: {
        create: urlIds.map((urlId) => ({
          resourceType: "url",
          resourceId: urlId,
          status: "queued",
        })),
      },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  const queue = await enqueueSavedUrlOperation(run.id);
  await prisma.operationRun.update({
    where: { id: run.id },
    data: {
      meta: {
        options: args.options ?? {},
        queueJobId: queue.queueJobId,
      },
    },
  });

  return getSavedUrlOperation(args.ownerId, run.id);
}

function cleanStringIds(ids: string[]) {
  return Array.from(
    new Set(
      (ids || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
}

export async function createDiscoveredPdfCaptureOperation(args: {
  ownerId: string;
  sourceUrlId: number;
  discoveredDocumentIds: string[];
  options?: Pick<SavedUrlOperationOptions, "folderId" | "accessMode" | "force">;
}) {
  const sourceUrlId = Number(args.sourceUrlId);
  if (!Number.isFinite(sourceUrlId)) throw asError("Invalid source URL id.");

  const ids = cleanStringIds(args.discoveredDocumentIds);
  if (!ids.length) {
    throw asError("At least one discovered PDF id is required.");
  }
  if (ids.length > 1000) {
    throw asError("At most 1000 discovered PDFs are allowed.");
  }

  const source = await prisma.url.findUnique({
    where: { id: sourceUrlId },
    select: { id: true },
  });
  if (!source) throw asError("Saved URL not found.", 404);

  const rows = await prisma.urlDiscoveredDocument.findMany({
    where: { id: { in: ids } },
    select: { id: true, sourceUrlId: true },
  });

  const foundIds = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw asError(
      `Unknown discovered PDF id(s): ${missing.slice(0, 10).join(", ")}`,
      404,
    );
  }

  const crossSource = rows.filter((row) => row.sourceUrlId !== sourceUrlId);
  if (crossSource.length) {
    throw asError("All discovered PDFs must belong to the requested source URL.");
  }

  const run = await prisma.operationRun.create({
    data: {
      ownerId: args.ownerId,
      type: "saved_url_discovered_pdf_capture",
      status: "queued",
      total: ids.length,
      completed: 0,
      failed: 0,
      progressPct: 0,
      stage: "queued",
      statusMessage: "Queued discovered PDF capture",
      meta: {
        sourceUrlId,
        options: args.options ?? {},
      },
      items: {
        create: ids.map((id) => ({
          resourceType: "url_discovered_document",
          resourceKey: id,
          resourceId: null,
          status: "queued",
        })),
      },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  const queue = await enqueueSavedUrlOperation(run.id);
  await prisma.operationRun.update({
    where: { id: run.id },
    data: {
      meta: {
        sourceUrlId,
        options: args.options ?? {},
        queueJobId: queue.queueJobId,
      },
    },
  });

  return getSavedUrlOperation(args.ownerId, run.id);
}

export async function cancelSavedUrlOperation(ownerId: string, runId: string) {
  const run = await prisma.operationRun.findFirst({
    where: { id: runId, ownerId },
    select: { id: true, status: true, meta: true },
  });
  if (!run) throw asError("Operation run not found.", 404);

  if (["success", "failed", "canceled"].includes(run.status)) {
    return getSavedUrlOperation(ownerId, runId);
  }

  await prisma.$transaction([
    prisma.operationRun.update({
      where: { id: runId },
      data: {
        status: "canceled",
        stage: "canceled",
        statusMessage: "Cancellation requested",
        finishedAt: new Date(),
        meta: {
          ...((run.meta as any) ?? {}),
          cancelRequested: true,
        },
      },
    }),
    prisma.operationRunItem.updateMany({
      where: { runId, status: "queued" },
      data: {
        status: "canceled",
        error: "Operation canceled before this item started.",
        finishedAt: new Date(),
      },
    }),
  ]);

  return getSavedUrlOperation(ownerId, runId);
}

export async function retryFailedSavedUrlOperation(
  ownerId: string,
  runId: string,
) {
  const run = await prisma.operationRun.findFirst({
    where: { id: runId, ownerId },
    include: { items: true },
  });
  if (!run) throw asError("Operation run not found.", 404);

  const failedItems = run.items.filter((item) => item.status === "failed");

  if (!failedItems.length) {
    throw asError("This operation has no failed items to retry.");
  }

  const options = ((run.meta as any)?.options ?? {}) as SavedUrlOperationOptions;
  if (run.type === "saved_url_discovered_pdf_capture") {
    const sourceUrlId = Number((run.meta as any)?.sourceUrlId);
    const discoveredDocumentIds = failedItems
      .map((item) => item.resourceKey)
      .filter((id): id is string => Boolean(id));

    return createDiscoveredPdfCaptureOperation({
      ownerId,
      sourceUrlId,
      discoveredDocumentIds,
      options,
    });
  }

  const failedIds = failedItems
    .map((item) => item.resourceId)
    .filter((id): id is number => Number.isFinite(id));

  if (!failedIds.length) {
    throw asError("This operation has no retryable failed items.");
  }

  return createSavedUrlOperation({
    ownerId,
    type: run.type as SavedUrlOperationType,
    urlIds: failedIds,
    options,
  });
}

async function invokeCrawlHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<any>,
  body: Record<string, unknown>,
) {
  return new Promise<any>((resolve, reject) => {
    const req = {
      body,
      requestId: `operation-${Date.now()}`,
      timedout: false,
    } as unknown as Request;

    const resMock: any = {
      headersSent: false,
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.headersSent = true;
        if (this.statusCode >= 400) {
          const err: any = new Error(payload?.message || "Capture failed");
          err.status = this.statusCode;
          err.payload = payload;
          reject(err);
          return this;
        }
        resolve(payload);
        return this;
      },
      end() {
        this.headersSent = true;
        resolve(null);
        return this;
      },
    };
    const res = resMock as Response;

    const next: NextFunction = (err?: any) => {
      if (err) reject(err);
    };

    Promise.resolve(handler(req, res, next)).catch(reject);
  });
}

async function refreshMetadataForUrl(urlId: number) {
  const row = await prisma.url.findUnique({
    where: { id: urlId },
    select: { id: true, url: true },
  });
  if (!row) throw new Error("URL not found.");

  const meta = await extractUrlMetadata(row.url);
  const updatedUrl = await prisma.url.update({
    where: { id: urlId },
    data: {
      publishedAt: meta.publishedAt,
      authors: meta.authors ?? [],
    },
    select: { id: true, publishedAt: true, authors: true },
  });

  await prisma.storedFile.updateMany({
    where: {
      urlId,
      OR: [{ sourcePublishedAt: null }, { sourceAuthors: { equals: [] } }],
    },
    data: {
      sourcePublishedAt: meta.publishedAt ?? null,
      sourceAuthors: meta.authors ?? [],
    },
  });

  const latest = await prisma.storedFile.findFirst({
    where: { urlId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      captureType: true,
      urlId: true,
      sourceUrl: true,
      uploaderId: true,
      uploaderName: true,
    },
  });

  if (latest) {
    const docRev = await ensureDocumentRevisionForStoredFile(latest.id);
    await recordCaptureEvent({
      pipelineName: "metadata.refresh",
      pipelineConfig: { url: true },
      captureType: (latest.captureType as any) || "URL_TEXT",
      storedFileId: latest.id,
      documentRevisionId: docRev.id,
      urlId: latest.urlId ?? null,
      sourceUrl: latest.sourceUrl ?? null,
      actorId: latest.uploaderId ?? null,
      actorName: latest.uploaderName ?? null,
      requestId: null,
    });
  }

  return {
    id: updatedUrl.id,
    publishedAt: updatedUrl.publishedAt?.toISOString?.() ?? null,
    authors: updatedUrl.authors ?? [],
  };
}

async function assignUrlToCollection(
  urlId: number,
  collectionId: string,
  mode: "add" | "move" = "add",
) {
  await prisma.$transaction(async (tx) => {
    if (mode === "move") {
      await tx.collectionUrl.deleteMany({
        where: { urlId, collectionId: { not: collectionId } },
      });
    }

    await tx.collectionUrl.upsert({
      where: { collectionId_urlId: { collectionId, urlId } },
      create: { collectionId, urlId },
      update: {},
    });
  });

  return { collectionId, mode };
}

async function processOperationItem(args: {
  type: SavedUrlOperationType;
  item: any;
  options: SavedUrlOperationOptions;
}) {
  const urlId = Number(args.item.resourceId);
  if (args.type === "saved_url_discovered_pdf_capture") {
    return processDiscoveredPdfCaptureItem({
      discoveredDocumentId: String(args.item.resourceKey || ""),
      options: args.options,
    });
  }

  const row = await prisma.url.findUnique({
    where: { id: urlId },
    select: { id: true, url: true, title: true },
  });
  if (!row) throw new Error("URL not found.");

  if (args.type === "saved_url_bulk_ai_tag") {
    return enqueueAiTagUrl(row.id, { force: true });
  }

  if (args.type === "saved_url_metadata_refresh") {
    return refreshMetadataForUrl(row.id);
  }

  if (args.type === "saved_url_bulk_delete") {
    await prisma.url.delete({ where: { id: row.id } });
    return { deleted: true };
  }

  if (args.type === "saved_url_collection_assign") {
    if (!args.options.collectionId) {
      throw new Error("collectionId is required.");
    }

    return assignUrlToCollection(
      row.id,
      args.options.collectionId,
      args.options.collectionMode === "move" ? "move" : "add",
    );
  }

  if (args.type === "saved_url_bulk_capture_text") {
    return invokeCrawlHandler(crawlTextHandler, {
      url: row.url,
      folderId: args.options.folderId ?? undefined,
      urlId: row.id,
      accessMode: args.options.accessMode ?? "public",
    });
  }

  if (args.type === "saved_url_bulk_capture_pdf") {
    return invokeCrawlHandler(crawlPdfHandler, {
      url: row.url,
      folderId: args.options.folderId ?? undefined,
      fullPage: true,
      reader: true,
      urlId: row.id,
      accessMode: args.options.accessMode ?? "public",
    });
  }

  throw new Error(`Unsupported operation type: ${args.type}`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function processDiscoveredPdfCaptureItem(args: {
  discoveredDocumentId: string;
  options: SavedUrlOperationOptions;
}) {
  const id = String(args.discoveredDocumentId || "").trim();
  if (!id) throw new Error("Missing discovered PDF id.");

  const doc = await prisma.urlDiscoveredDocument.findUnique({
    where: { id },
    select: {
      id: true,
      sourceUrlId: true,
      url: true,
      title: true,
      fileNameHint: true,
      capturedFiles: {
        where: { deletedAt: null },
        select: { id: true },
        take: 1,
      },
      sourceUrl: {
        select: { url: true },
      },
    },
  });

  if (!doc) throw new Error("Discovered PDF not found.");

  if (!args.options.force && doc.capturedFiles.length > 0) {
    return {
      skipped: true,
      reason: "already_captured",
      discoveredDocumentId: doc.id,
      fileId: doc.capturedFiles[0].id,
    };
  }

  const fileName =
    doc.fileNameHint ||
    doc.title ||
    doc.url.split(/[/?#]/).filter(Boolean).pop() ||
    "document.pdf";

  return invokeCrawlHandler(crawlPdfHandler, {
    url: doc.url,
    folderId: args.options.folderId ?? undefined,
    fileName,
    fullPage: true,
    reader: true,
    urlId: doc.sourceUrlId,
    accessMode: args.options.accessMode ?? "public",
    discoveredDocumentId: doc.id,
    captureScope: "DISCOVERED_DOCUMENT",
    sourcePageUrl: doc.sourceUrl.url,
    originalSearchQuery: null,
  });
}

async function processOperationItemWithRetries(args: {
  type: SavedUrlOperationType;
  item: any;
  options: SavedUrlOperationOptions;
}) {
  const maxAttempts =
    args.type === "saved_url_discovered_pdf_capture"
      ? DISCOVERED_PDF_MAX_ATTEMPTS
      : 1;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await prisma.operationRunItem.update({
      where: { id: args.item.id },
      data: { attemptCount: attempt },
    });

    try {
      return await processOperationItem(args);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}

async function summarizeRun(runId: string) {
  const grouped = await prisma.operationRunItem.groupBy({
    by: ["status"],
    where: { runId },
    _count: { _all: true },
  });

  const counts = Object.fromEntries(
    grouped.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const failed = counts.failed ?? 0;
  const completed =
    (counts.success ?? 0) + failed + (counts.canceled ?? 0);

  return {
    total,
    completed,
    failed,
    progressPct: total ? clampProgress((completed / total) * 100) : 100,
  };
}

export async function processSavedUrlOperationRun(runId: string) {
  const run = await prisma.operationRun.findUnique({
    where: { id: runId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!run) throw new Error(`Operation run not found: ${runId}`);
  if (run.status === "canceled") return run;
  if (run.status === "success") return run;

  const options = ((run.meta as any)?.options ?? {}) as SavedUrlOperationOptions;

  await prisma.operationRun.update({
    where: { id: runId },
    data: {
      status: "running",
      stage: "running",
      statusMessage: "Operation worker started",
      startedAt: run.startedAt ?? new Date(),
      error: null,
    },
  });

  for (const item of run.items) {
    const currentRun = await prisma.operationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (currentRun?.status === "canceled") break;
    if (item.status !== "queued") continue;

    await prisma.operationRunItem.update({
      where: { id: item.id },
      data: { status: "running", startedAt: new Date(), error: null },
    });

    try {
      const result = await processOperationItemWithRetries({
        type: run.type as SavedUrlOperationType,
        item,
        options,
      });

      await prisma.operationRunItem.update({
        where: { id: item.id },
        data: {
          status: "success",
          result: result as any,
          finishedAt: new Date(),
        },
      });
    } catch (e: any) {
      await prisma.operationRunItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          error: String(e?.message || e || "Operation item failed").slice(
            0,
            1000,
          ),
          result: e?.payload ?? undefined,
          finishedAt: new Date(),
        },
      });
    }

    const summary = await summarizeRun(runId);
    await prisma.operationRun.update({
      where: { id: runId },
      data: {
        ...summary,
        statusMessage: `${summary.completed}/${summary.total} items processed`,
      },
    });
  }

  const latest = await prisma.operationRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  const summary = await summarizeRun(runId);

  if (latest?.status === "canceled") {
    return prisma.operationRun.update({
      where: { id: runId },
      data: {
        ...summary,
        stage: "canceled",
        statusMessage: "Operation canceled",
        finishedAt: new Date(),
      },
    });
  }

  const status = summary.failed > 0 ? "failed" : "success";
  return prisma.operationRun.update({
    where: { id: runId },
    data: {
      ...summary,
      status,
      stage: "completed",
      statusMessage:
        status === "success"
          ? "Operation completed"
          : "Operation completed with failures",
      finishedAt: new Date(),
    },
  });
}
