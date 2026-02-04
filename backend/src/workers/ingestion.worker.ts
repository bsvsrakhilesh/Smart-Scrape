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
    const { sourceId } = job.data as { sourceId: string };
    if (!sourceId) throw new Error("Missing sourceId");

    await prisma.ingestionJob.upsert({
      where: { sourceId },
      create: { sourceId, status: "RUNNING", attemptCount: 1 },
      update: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        error: null,
      },
    });

    const src = await prisma.notebookSource.findUnique({
      where: { id: sourceId },
      include: { url: true, file: true },
    });

    if (!src) throw new Error(`NotebookSource not found: ${sourceId}`);

    // ---------- URL ingestion ----------
    if (src.kind === "URL") {
      const u = src.url?.url;
      if (!u) throw new Error("URL source missing url.url");

      let fullTextRaw = "";
      let documentRevisionId: string | null = null;

      // Prefer latest URL_TEXT snapshot for traceability (avoids link rot/version drift)
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
          // Snapshot text is stored as a file; extract from disk (traceable)
          fullTextRaw = await extractTextFromFile(
            snap.storagePath,
            snap.mimeType,
          );

          const rev = await ensureDocumentRevisionForStoredFile(snap.id);
          documentRevisionId = rev.id;
        }
      }

      // Fallback: live fetch (still works, but not “paper standard”)
      if (!fullTextRaw) {
        fullTextRaw = await extractTextFromUrl(u);
      }

      const fullText = (fullTextRaw || "").replace(/\s+/g, " ").trim();

      const pc = await getOrCreatePipelineConfig("ingestion.url", {
        whitespaceNormalization: true,
        preferSnapshot: true,
        usedSnapshot: Boolean(documentRevisionId),
      });

      await createChunksForSource(sourceId, {
        fullText,
        documentRevisionId,
        pipelineConfigId: pc.id,
      });

      await prisma.ingestionJob.update({
        where: { sourceId },
        data: { status: "SUCCESS", error: null },
      });
      return;
    }

    // ---------- FILE ingestion ----------
    const f = src.file;
    if (!f) throw new Error("FILE source missing stored file");

    const docRev = await ensureDocumentRevisionForStoredFile(f.id);
    const documentRevisionId = docRev.id;

    if (isPdf(f.mimeType, f.fileName)) {
      const pages = await extractPdfPagesFromFile(f.storagePath);
      const scan = detectScannedPdf(pages);

      if (scan.isScannedLikely) {
        // Phase 3: no silent failure. Either OCR or a clean FAILED state.
        if (!env.OCR_ENABLED) {
          throw new Error(
            `PDF appears scanned (pageCount=${scan.pageCount}, totalChars=${scan.totalChars}, avgCharsPerPage=${scan.avgCharsPerPage.toFixed(
              1,
            )}). OCR is disabled (OCR_ENABLED=false).`,
          );
        }

        // OCR path will be implemented next; for now fail explicitly (no junk output)
        throw new Error(
          `PDF appears scanned (pageCount=${scan.pageCount}, totalChars=${scan.totalChars}, avgCharsPerPage=${scan.avgCharsPerPage.toFixed(
            1,
          )}). OCR_ENABLED=true but OCR pipeline is not implemented yet.`,
        );
      }

      // IMPORTANT: keep page separator to preserve global offsets for page mapping
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

      await createChunksForSource(sourceId, {
        fullText,
        pages,
        documentRevisionId,
        pipelineConfigId: pc.id,
      });

      await prisma.ingestionJob.update({
        where: { sourceId },
        data: { status: "SUCCESS", error: null },
      });
      return;
    }

    // Non-PDF files: blob extraction, normalize whitespace for quote stability
    const bodyRaw = await extractTextFromFile(f.storagePath, f.mimeType);
    const header = `FILE: ${f.fileName}\nMIME: ${f.mimeType}\n\n`;
    const fullText = (header + (bodyRaw || "")).replace(/\s+/g, " ").trim();

    const pc = await getOrCreatePipelineConfig("ingestion.file.generic", {
      whitespaceNormalization: true,
      headerInjected: true,
    });

    await createChunksForSource(sourceId, {
      fullText,
      documentRevisionId,
      pipelineConfigId: pc.id,
    });

    await prisma.ingestionJob.update({
      where: { sourceId },
      data: { status: "SUCCESS", error: null },
    });
  },
  {
    connection: bullConnection(),
    concurrency: env.INGESTION_QUEUE_CONCURRENCY,
  },
);

ingestionWorker.on("failed", async (job, err) => {
  const sourceId = (job?.data as any)?.sourceId;
  if (!sourceId) return;

  await prisma.ingestionJob.update({
    where: { sourceId },
    data: { status: "FAILED", error: err?.message ?? String(err) },
  });
});
