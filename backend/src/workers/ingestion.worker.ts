import { Worker, type ConnectionOptions } from "bullmq";
import prisma from "../config/database";
import { env } from "../config/env";
import {
  extractTextFromUrl,
  extractTextFromFile,
  extractPdfPagesFromFile,
  detectScannedPdf,
} from "../services/extract.service";
import { createChunksForSource } from "../services/notebook.service";
import { ensureDocumentRevisionForStoredFile } from "../services/document.service";
import { getOrCreatePipelineConfig } from "../services/provenance.service";
import { ocrPdfToPagesFromFile } from "../services/ocr.service";
import {
  markJobFailed,
  markJobProgress,
  markJobRunning,
  markJobSucceeded,
} from "../services/jobTelemetry.service";
import { log } from "../utils/logger";

function bullConnection(): ConnectionOptions {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || "6379"),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname ? Number(u.pathname.replace("/", "") || "0") : 0,
    maxRetriesPerRequest: null,
  };
}

function isPdf(mime?: string | null, fileName?: string | null) {
  if ((mime || "").toLowerCase().includes("pdf")) return true;
  if ((fileName || "").toLowerCase().endsWith(".pdf")) return true;
  return false;
}

export const ingestionWorker = new Worker(
  "ingestion",
  async (job) => {
    const { sourceId, forceOcr } = job.data as {
      sourceId: string;
      forceOcr?: boolean;
    };
    if (!sourceId) throw new Error("Missing sourceId");

    await markJobRunning(prisma, "ingestion", sourceId, {
      queueJobId: job.id,
      stage: "starting",
      progressPct: 2,
      statusMessage: "Worker picked up ingestion job",
      meta: { forceOcr: Boolean(forceOcr), bullJobName: job.name },
    });

    log.info("ingestion_job_started", {
      sourceId,
      queueJobId: job.id,
      forceOcr: Boolean(forceOcr),
    });

    const src = await prisma.notebookSource.findUnique({
      where: { id: sourceId },
      include: { url: true, file: true },
    });

    if (!src) throw new Error(`NotebookSource not found: ${sourceId}`);

    await markJobProgress(prisma, "ingestion", sourceId, {
      stage: "source_resolved",
      progressPct: 8,
      statusMessage: "Source metadata resolved",
      meta: {
        kind: src.kind,
        urlId: src.urlId ?? null,
        fileId: src.fileId ?? null,
      },
    });

    if (src.kind === "URL") {
      const u = src.url?.url;
      if (!u) throw new Error("URL source missing url.url");

      let fullTextRaw = "";
      let documentRevisionId: string | null = null;

      await markJobProgress(prisma, "ingestion", sourceId, {
        stage: "url_prepare",
        progressPct: 14,
        statusMessage: "Preparing URL ingestion",
      });

      if (src.urlId) {
        const snap = await prisma.storedFile.findFirst({
          where: {
            urlId: src.urlId,
            captureType: "URL_TEXT",
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
        });

        if (snap?.storagePath) {
          await markJobProgress(prisma, "ingestion", sourceId, {
            stage: "url_snapshot_extract",
            progressPct: 28,
            statusMessage: "Extracting latest saved URL snapshot",
            meta: { snapshotStoredFileId: snap.id },
          });

          fullTextRaw = await extractTextFromFile(
            snap.storagePath,
            snap.mimeType,
          );
          const rev = await ensureDocumentRevisionForStoredFile(snap.id);
          documentRevisionId = rev.id;
        }
      }

      if (!fullTextRaw) {
        await markJobProgress(prisma, "ingestion", sourceId, {
          stage: "url_live_fetch",
          progressPct: 35,
          statusMessage: "Fetching live URL text",
        });

        fullTextRaw = await extractTextFromUrl(u);
      }

      const fullText = (fullTextRaw || "").replace(/\s+/g, " ").trim();

      const pc = await getOrCreatePipelineConfig("ingestion.url", {
        whitespaceNormalization: true,
        preferSnapshot: true,
        usedSnapshot: Boolean(documentRevisionId),
      });

      await markJobProgress(prisma, "ingestion", sourceId, {
        stage: "chunking",
        progressPct: 82,
        statusMessage: "Creating chunks for notebook source",
      });

      await createChunksForSource(sourceId, {
        fullText,
        documentRevisionId,
        pipelineConfigId: pc.id,
      });

      await markJobSucceeded(prisma, "ingestion", sourceId, {
        stage: "completed",
        statusMessage: "URL ingestion completed",
        meta: { documentRevisionId, sourceKind: src.kind },
      });

      log.info("ingestion_job_succeeded", { sourceId, queueJobId: job.id });
      return;
    }

    const f = src.file;
    if (!f) throw new Error("FILE source missing stored file");

    const docRev = await ensureDocumentRevisionForStoredFile(f.id);
    const documentRevisionId = docRev.id;

    await markJobProgress(prisma, "ingestion", sourceId, {
      stage: "file_prepare",
      progressPct: 16,
      statusMessage: "Preparing file ingestion",
      meta: { storedFileId: f.id, mimeType: f.mimeType, fileName: f.fileName },
    });

    if (isPdf(f.mimeType, f.fileName)) {
      await markJobProgress(prisma, "ingestion", sourceId, {
        stage: "pdf_extract",
        progressPct: 24,
        statusMessage: "Extracting native PDF pages",
      });

      const pages = await extractPdfPagesFromFile(f.storagePath);
      const scan = detectScannedPdf(pages);

      await markJobProgress(prisma, "ingestion", sourceId, {
        stage: "pdf_scan_check",
        progressPct: 34,
        statusMessage: scan.isScannedLikely
          ? "PDF looks scanned; evaluating OCR path"
          : "PDF text extraction succeeded",
        meta: { scan },
      });

      const shouldOcr = Boolean(forceOcr) || scan.isScannedLikely;

      if (shouldOcr) {
        if (!env.OCR_ENABLED) {
          throw new Error(
            `PDF appears scanned or OCR was requested (pageCount=${scan.pageCount}, totalChars=${scan.totalChars}, avgCharsPerPage=${scan.avgCharsPerPage.toFixed(
              1,
            )}). OCR is disabled (OCR_ENABLED=false).`,
          );
        }

        const maxPages = Math.max(1, env.OCR_MAX_PAGES);
        const dpi = Math.max(72, env.OCR_DPI);

        await markJobProgress(prisma, "ingestion", sourceId, {
          stage: "ocr_extract",
          progressPct: 48,
          statusMessage: "Running OCR over scanned PDF",
          meta: { scan, maxPages, dpi },
        });

        const ocrPages = await ocrPdfToPagesFromFile(f.storagePath, {
          maxPages,
          dpi,
          langs: env.OCR_LANGS,
          renderTimeoutMs: env.OCR_RENDER_TIMEOUT_MS,
          pageTimeoutMs: env.OCR_PAGE_TIMEOUT_MS,
        });

        const fullText = ocrPages
          .map((p) => (p.text || "").trim())
          .join("\n\n")
          .trim();

        const pc = await getOrCreatePipelineConfig("ingestion.file.pdf.ocr", {
          scannedPdfDetection: true,
          ocrUsed: true,
          ocrEngine: "tesseract",
          ocrLangs: env.OCR_LANGS,
          ocrDpi: dpi,
          ocrMaxPages: maxPages,
          forceOcr: Boolean(forceOcr),
          scanMetrics: scan,
          pageSeparator: "\n\n",
        });

        await markJobProgress(prisma, "ingestion", sourceId, {
          stage: "chunking",
          progressPct: 82,
          statusMessage: "Creating OCR-derived chunks",
          meta: { pageCount: ocrPages.length },
        });

        await createChunksForSource(sourceId, {
          fullText,
          pages: ocrPages,
          documentRevisionId,
          pipelineConfigId: pc.id,
        });

        await markJobSucceeded(prisma, "ingestion", sourceId, {
          stage: "completed",
          statusMessage: "OCR ingestion completed",
          meta: { documentRevisionId, pageCount: ocrPages.length },
        });

        log.info("ingestion_job_succeeded", { sourceId, queueJobId: job.id });
        return;
      }

      const fullText = pages
        .map((p) => (p.text || "").trim())
        .join("\n\n")
        .trim();

      const pc = await getOrCreatePipelineConfig("ingestion.file.pdf", {
        scannedPdfDetection: true,
        ocrEnabled: env.OCR_ENABLED,
        pageSeparator: "\n\n",
        whitespaceNormalization: false,
      });

      await markJobProgress(prisma, "ingestion", sourceId, {
        stage: "chunking",
        progressPct: 82,
        statusMessage: "Creating page-aware chunks",
        meta: { pageCount: pages.length },
      });

      await createChunksForSource(sourceId, {
        fullText,
        pages,
        documentRevisionId,
        pipelineConfigId: pc.id,
      });

      await markJobSucceeded(prisma, "ingestion", sourceId, {
        stage: "completed",
        statusMessage: "PDF ingestion completed",
        meta: { documentRevisionId, pageCount: pages.length },
      });

      log.info("ingestion_job_succeeded", { sourceId, queueJobId: job.id });
      return;
    }

    await markJobProgress(prisma, "ingestion", sourceId, {
      stage: "file_extract",
      progressPct: 34,
      statusMessage: "Extracting file text",
    });

    const bodyRaw = await extractTextFromFile(f.storagePath, f.mimeType);
    const header = `FILE: ${f.fileName}\nMIME: ${f.mimeType}\n\n`;
    const fullText = (header + (bodyRaw || "")).replace(/\s+/g, " ").trim();

    const pc = await getOrCreatePipelineConfig("ingestion.file.generic", {
      whitespaceNormalization: true,
      headerInjected: true,
    });

    await markJobProgress(prisma, "ingestion", sourceId, {
      stage: "chunking",
      progressPct: 82,
      statusMessage: "Creating chunks",
    });

    await createChunksForSource(sourceId, {
      fullText,
      documentRevisionId,
      pipelineConfigId: pc.id,
    });

    await markJobSucceeded(prisma, "ingestion", sourceId, {
      stage: "completed",
      statusMessage: "File ingestion completed",
      meta: { documentRevisionId },
    });

    log.info("ingestion_job_succeeded", { sourceId, queueJobId: job.id });
  },
  {
    connection: bullConnection(),
    concurrency: env.INGESTION_QUEUE_CONCURRENCY,
  },
);

ingestionWorker.on("failed", async (job, err) => {
  const sourceId = (job?.data as any)?.sourceId;
  if (!sourceId) return;

  await markJobFailed(prisma, "ingestion", sourceId, {
    stage: "failed",
    statusMessage: "Ingestion failed",
    error: err?.message ?? String(err),
    meta: { queueJobId: job?.id ?? null },
  });

  log.error("ingestion_job_failed", {
    sourceId,
    queueJobId: job?.id ?? null,
    error: err?.message ?? String(err),
  });
});
